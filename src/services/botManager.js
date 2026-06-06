// src/services/botManager.js
// Mengelola spawn/stop instance bot per user (multi-tenant).
// Setiap user aktif mendapat satu instance bot yang berjalan dengan context userId-nya.

import TelegramBot from 'node-telegram-bot-api'
import crypto from 'crypto'
import { getUserById, canCreateNewBot } from './userService.js'
import { loadConfigForUser } from './configService.js'
import { getTelegramTokenForUser } from './configService.js'
import { redisSetNx, redisLpush, redisRpop, redisDel } from './redis.js'

const TELEGRAM_API_TIMEOUT_MS = 15_000
const WEBHOOK_RETRY_DELAYS_MS = [0, 1_500, 4_000, 9_000]
const WEBHOOK_BACKGROUND_RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000]

const webhookReconcileTimers = new Map()

async function validateTelegramToken(token) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      return {
        valid: false,
        reason: body.description || `HTTP ${response.status}`,
      }
    }

    const body = await response.json().catch(() => ({}))
    return {
      valid: Boolean(body.ok),
      reason: body.ok ? null : body.description || 'Unknown Telegram error',
    }
  } catch (err) {
    return { valid: false, reason: err.message }
  }
}

/**
 * Map<userId, { botInstance, config, user }>
 */
const activeBots = new Map()

/**
 * Map<userId, {
 *   running: boolean,
 *   tokenStatus: 'unknown' | 'missing' | 'valid' | 'invalid',
 *   lastSpawnAttemptAt: string | null,
 *   lastSpawnAttemptSuccess: boolean | null,
 *   reason: string | null,
 *   updatedAt: string
 * }>
 */
const botObservability = new Map()

function toIsoNow() {
  return new Date().toISOString()
}

function getDefaultObservabilityState() {
  return {
    running: false,
    tokenStatus: 'unknown',
    lastSpawnAttemptAt: null,
    lastSpawnAttemptSuccess: null,
    reason: 'Belum ada percobaan spawn.',
    updatedAt: toIsoNow(),
  }
}

function getOrInitObservability(userId) {
  if (!botObservability.has(userId)) {
    botObservability.set(userId, getDefaultObservabilityState())
  }

  return botObservability.get(userId)
}

function setObservability(userId, patch) {
  const current = getOrInitObservability(userId)
  const next = {
    ...current,
    ...patch,
    updatedAt: toIsoNow(),
  }

  botObservability.set(userId, next)
  return next
}

function buildWebhookSecretFromToken(token) {
  // Telegram secret_token max 256 chars; keep short and deterministic.
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function buildTelegramApiUrl(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`
}

function isTransientWebhookError(reason) {
  const text = String(reason || '')
  return /Failed to resolve host|name resolution|ENOTFOUND|EAI_AGAIN|fetch failed|timed out|timeout|ECONNRESET|ECONNREFUSED|TLS|502|503|504/i.test(
    text,
  )
}

function getRetryDelayMs(attemptIndex, delays) {
  const fallback = delays[delays.length - 1] || 0
  return delays[attemptIndex] ?? fallback
}

async function callTelegramApi(token, method, payload) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_API_TIMEOUT_MS)

  try {
    const response = await fetch(buildTelegramApiUrl(token, method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    })

    const body = await response.json().catch(() => ({}))
    const ok = response.ok && body.ok !== false

    return {
      ok,
      status: response.status,
      body,
      reason: ok
        ? null
        : body.description || `HTTP ${response.status} (${method})`,
      transient:
        !ok &&
        (response.status >= 500 || isTransientWebhookError(body.description)),
    }
  } catch (err) {
    const reason =
      err?.name === 'AbortError'
        ? `Request timeout ${TELEGRAM_API_TIMEOUT_MS}ms (${method})`
        : err?.message || `Unknown network error (${method})`

    return {
      ok: false,
      status: null,
      body: null,
      reason,
      transient: true,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function sanitizeBaseUrl(baseUrl) {
  return String(baseUrl || '')
    .trim()
    .replace(/^['\"]|['\"]$/g, '')
    .replace(/\/$/, '')
}

function validateAndNormalizeBaseUrl(baseUrl) {
  const sanitized = sanitizeBaseUrl(baseUrl)
  if (!sanitized) {
    return {
      ok: false,
      reason: 'Public base URL backend tidak tersedia untuk set webhook.',
    }
  }

  let parsed
  try {
    parsed = new URL(sanitized)
  } catch {
    return {
      ok: false,
      reason: `PUBLIC_BASE_URL tidak valid: "${sanitized}"`,
    }
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: 'PUBLIC_BASE_URL harus https untuk webhook Telegram.',
    }
  }

  return { ok: true, baseUrl: `${parsed.origin}` }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function configureTelegramWebhookForUser(userId, publicBaseUrl) {
  await loadConfigForUser(userId)

  const token = await getTelegramTokenForUser(userId)
  if (!token) {
    setObservability(userId, {
      running: false,
      tokenStatus: 'missing',
      reason: 'TELEGRAM_BOT_TOKEN belum diisi.',
    })
    return { success: false, reason: 'TELEGRAM_BOT_TOKEN belum diisi.' }
  }

  const tokenCheck = await validateTelegramToken(token)
  if (!tokenCheck.valid) {
    setObservability(userId, {
      running: false,
      tokenStatus: 'invalid',
      reason: tokenCheck.reason || 'Token Telegram tidak valid.',
    })
    return {
      success: false,
      reason: tokenCheck.reason || 'Token Telegram tidak valid.',
    }
  }

  const normalized = validateAndNormalizeBaseUrl(publicBaseUrl)
  if (!normalized.ok) {
    return { success: false, reason: normalized.reason }
  }

  const baseUrl = normalized.baseUrl

  const webhookUrl = `${baseUrl}/api/webhook/telegram/${encodeURIComponent(
    userId,
  )}`
  const secretToken = buildWebhookSecretFromToken(token)

  let deleteWebhookError = null
  let deleteWebhookTransient = false

  for (let i = 0; i < WEBHOOK_RETRY_DELAYS_MS.length; i++) {
    const attempt = i + 1
    if (i > 0) {
      await sleep(getRetryDelayMs(i, WEBHOOK_RETRY_DELAYS_MS))
    }

    const deleteResult = await callTelegramApi(token, 'deleteWebhook', {
      drop_pending_updates: false,
    })

    if (deleteResult.ok) {
      deleteWebhookError = null
      deleteWebhookTransient = false
      break
    }

    deleteWebhookError = deleteResult.reason
    deleteWebhookTransient = Boolean(deleteResult.transient)

    console.warn(
      `[BotManager] deleteWebhook gagal percobaan ke-${attempt} user=${userId}: ${deleteWebhookError}`,
    )

    if (!deleteWebhookTransient || attempt >= WEBHOOK_RETRY_DELAYS_MS.length) {
      break
    }
  }

  if (deleteWebhookError) {
    setObservability(userId, {
      tokenStatus: deleteWebhookTransient ? 'unknown' : 'invalid',
      reason: `Gagal delete webhook: ${deleteWebhookError}`,
    })
    return {
      success: false,
      reason: `Gagal delete webhook: ${deleteWebhookError}`,
      transient: deleteWebhookTransient,
    }
  }

  let setWebhookError = null
  let setWebhookTransient = false

  for (let i = 0; i < WEBHOOK_RETRY_DELAYS_MS.length; i++) {
    const attempt = i + 1
    if (i > 0) {
      await sleep(getRetryDelayMs(i, WEBHOOK_RETRY_DELAYS_MS))
    }

    console.log(
      `[BotManager] setWebhook percobaan ke-${attempt} user=${userId}: ${webhookUrl}`,
    )

    const setResult = await callTelegramApi(token, 'setWebhook', {
      url: webhookUrl,
      secret_token: secretToken,
      drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query'],
    })

    if (setResult.ok) {
      setWebhookError = null
      setWebhookTransient = false
      break
    }

    setWebhookError = setResult.reason
    setWebhookTransient = Boolean(setResult.transient)

    console.warn(
      `[BotManager] setWebhook gagal percobaan ke-${attempt} user=${userId}: ${setWebhookError}`,
    )

    if (!setWebhookTransient || attempt >= WEBHOOK_RETRY_DELAYS_MS.length) {
      break
    }
  }

  if (setWebhookError) {
    setObservability(userId, {
      tokenStatus: setWebhookTransient ? 'unknown' : 'invalid',
      reason: `Gagal set webhook: ${setWebhookError}`,
    })
    return {
      success: false,
      reason: `Gagal set webhook: ${setWebhookError}`,
      transient: setWebhookTransient,
    }
  }

  setObservability(userId, {
    tokenStatus: 'valid',
    reason: `Webhook aktif di ${webhookUrl}`,
  })

  return {
    success: true,
    webhookUrl,
    transient: false,
  }
}

export function scheduleTelegramWebhookReconcileForUser(userId, publicBaseUrl) {
  const normalized = validateAndNormalizeBaseUrl(publicBaseUrl)
  if (!normalized.ok) {
    return
  }

  const existingTimer = webhookReconcileTimers.get(userId)
  if (existingTimer) {
    clearTimeout(existingTimer)
    webhookReconcileTimers.delete(userId)
  }

  let currentAttempt = 0

  const run = async () => {
    if (currentAttempt >= WEBHOOK_BACKGROUND_RETRY_DELAYS_MS.length) {
      webhookReconcileTimers.delete(userId)
      console.warn(
        `[BotManager] webhook reconcile berhenti user=${userId} (retry habis).`,
      )
      return
    }

    const delay = WEBHOOK_BACKGROUND_RETRY_DELAYS_MS[currentAttempt]
    currentAttempt += 1

    const timer = setTimeout(async () => {
      try {
        console.log(
          `[BotManager] webhook reconcile background user=${userId} percobaan ke-${currentAttempt}`,
        )

        const result = await configureTelegramWebhookForUser(
          userId,
          normalized.baseUrl,
        )

        if (result.success) {
          webhookReconcileTimers.delete(userId)
          console.log(
            `[BotManager] webhook reconcile sukses user=${userId} di percobaan ke-${currentAttempt}.`,
          )
          return
        }

        if (!result.transient) {
          webhookReconcileTimers.delete(userId)
          console.warn(
            `[BotManager] webhook reconcile dihentikan user=${userId} (error permanen): ${result.reason}`,
          )
          return
        }

        run()
      } catch (err) {
        console.warn(
          `[BotManager] webhook reconcile error user=${userId}: ${err?.message || err}`,
        )
        run()
      }
    }, delay)

    webhookReconcileTimers.set(userId, timer)
  }

  run()
}

/**
 * Spawn bot instance untuk user tertentu.
 * Return: { botInstance, config, user } atau null jika gagal.
 */
export async function spawnBotForUser(userId, options = {}) {
  try {
    setObservability(userId, {
      lastSpawnAttemptAt: toIsoNow(),
      lastSpawnAttemptSuccess: null,
      reason: 'Mencoba spawn bot...',
      running: activeBots.has(userId),
    })

    // Cek apakah user sudah punya bot running
    if (activeBots.has(userId)) {
      console.warn(`⚠️  Bot untuk user ${userId} sudah running.`)
      setObservability(userId, {
        running: true,
        lastSpawnAttemptSuccess: true,
        reason: 'Bot sudah running.',
      })
      return activeBots.get(userId)
    }

    // Load user data
    const user = await getUserById(userId)
    if (!user || !user.isActive) {
      console.error(`❌ User ${userId} tidak ditemukan atau tidak aktif.`)
      setObservability(userId, {
        running: false,
        tokenStatus: 'unknown',
        lastSpawnAttemptSuccess: false,
        reason: 'User tidak ditemukan atau tidak aktif.',
      })
      return null
    }

    // Load config user
    const config = await loadConfigForUser(userId)
    if (!config) {
      console.error({ config })
      console.error(`❌ Config tidak ditemukan untuk user ${userId}.`)
      setObservability(userId, {
        running: false,
        tokenStatus: 'unknown',
        lastSpawnAttemptSuccess: false,
        reason: 'Bot config aktif tidak ditemukan.',
      })
      return null
    }

    // Ambil token bot
    const token = await getTelegramTokenForUser(userId)
    if (!token) {
      console.error(
        `❌ TELEGRAM_BOT_TOKEN tidak ditemukan untuk user ${userId}.`,
      )
      setObservability(userId, {
        running: false,
        tokenStatus: 'missing',
        lastSpawnAttemptSuccess: false,
        reason: 'TELEGRAM_BOT_TOKEN belum diisi.',
      })
      return null
    }

    // Validasi token sebelum memulai polling agar tidak spam 401 Unauthorized.
    const tokenCheck = await validateTelegramToken(token)
    if (!tokenCheck.valid) {
      console.error(
        `❌ Token Telegram tidak valid untuk user ${userId}: ${tokenCheck.reason}`,
      )
      setObservability(userId, {
        running: false,
        tokenStatus: 'invalid',
        lastSpawnAttemptSuccess: false,
        reason: tokenCheck.reason || 'Token Telegram tidak valid.',
      })
      return null
    }

    // Webhook-only mode: jangan gunakan polling.
    const bot = new TelegramBot(token, { polling: false })

    const { registerHandlersForUser } = await import('../handlers/index.js')
    registerHandlersForUser(bot, userId, config)

    // Simpan ke map
    const botData = { bot, config, user, userId }
    activeBots.set(userId, botData)

    setObservability(userId, {
      running: true,
      tokenStatus: 'valid',
      lastSpawnAttemptSuccess: true,
      reason: null,
    })

    console.log(`✅ Bot untuk user "${user.name}" (ID: ${userId}) spawned.`)
    return botData
  } catch (err) {
    console.error(`❌ Gagal spawn bot untuk user ${userId}:`, err.message)
    setObservability(userId, {
      running: false,
      lastSpawnAttemptSuccess: false,
      reason: err.message,
    })
    return null
  }
}

/**
 * Stop bot instance user tertentu.
 */
export async function stopBotForUser(userId) {
  const botData = activeBots.get(userId)
  if (!botData) {
    console.warn(`⚠️  Bot untuk user ${userId} tidak ditemukan.`)
    setObservability(userId, {
      running: false,
      reason: 'Bot tidak ditemukan dalam active runtime.',
    })
    return false
  }

  try {
    activeBots.delete(userId)
    setObservability(userId, {
      running: false,
      reason: 'Bot dihentikan.',
    })
    console.log(`✅ Bot untuk user ${userId} dihentikan.`)
    return true
  } catch (err) {
    console.error(`❌ Gagal stop bot untuk user ${userId}:`, err.message)
    setObservability(userId, {
      running: Boolean(activeBots.has(userId)),
      reason: err.message,
    })
    return false
  }
}

/**
 * Restart bot user (stop + spawn).
 */
export async function restartBotForUser(userId, options = {}) {
  await stopBotForUser(userId)
  return spawnBotForUser(userId, options)
}

/**
 * Dapatkan bot instance user (sudah spawned).
 */
export function getBotForUser(userId) {
  const botData = activeBots.get(userId)
  return botData ? botData.bot : null
}

/**
 * Dapatkan semua info bot user.
 */
export function getBotDataForUser(userId) {
  return activeBots.get(userId) || null
}

/**
 * Cek apakah bot user aktif.
 */
export function isBotActive(userId) {
  return activeBots.has(userId)
}

/**
 * Spawn semua bot dari user yang active (saat startup).
 */
export async function spawnAllActiveBots() {
  const { getAllActiveUsers } = await import('./userService.js')
  const users = await getAllActiveUsers()

  console.log(`\n📊 Memulai ${users.length} bot instance...`)

  const results = {
    success: 0,
    failed: 0,
  }

  for (const user of users) {
    // Cek limit bot user
    const limit = canCreateNewBot(user)
    const botCount = user.botConfigs?.length || 0

    if (botCount > limit) {
      console.warn(
        `⚠️  User "${user.name}" sudah melebihi limit bot (${botCount}/${limit}).`,
      )
      results.failed++
      continue
    }

    // Spawn bot
    const botData = await spawnBotForUser(user.id)

    if (botData) {
      results.success++
    } else {
      results.failed++
    }
  }

  console.log(
    `✅ Bot startup selesai: ${results.success} berhasil, ${results.failed} gagal\n`,
  )
  return results
}

/**
 * Stop semua bot (saat shutdown).
 */
export async function stopAllBots() {
  console.log('\n⏹️  Menghentikan semua bot instances...')

  const userIds = Array.from(activeBots.keys())
  let stopped = 0

  for (const userId of userIds) {
    const success = await stopBotForUser(userId)
    if (success) stopped++
  }

  console.log(`✅ ${stopped} bot dihentikan.\n`)
  return stopped
}

/**
 * Dapatkan statistik active bots.
 */
export function getBotsStatistics() {
  return {
    totalActiveBots: activeBots.size,
    userIds: Array.from(activeBots.keys()),
  }
}

/**
 * Get the activeBots Map<userId, botData> untuk registration purposes.
 */
export function getActiveBots() {
  return activeBots
}

export async function getBotObservabilityStatusForUser(
  userId,
  options = { validateToken: true },
) {
  await loadConfigForUser(userId)

  const token = await getTelegramTokenForUser(userId)
  const running = isBotActive(userId)

  const current = setObservability(userId, { running })

  if (!token) {
    return setObservability(userId, {
      running,
      tokenStatus: 'missing',
      reason: 'TELEGRAM_BOT_TOKEN belum diisi.',
    })
  }

  if (options.validateToken) {
    const tokenCheck = await validateTelegramToken(token)
    return setObservability(userId, {
      running,
      tokenStatus: tokenCheck.valid ? 'valid' : 'invalid',
      reason: tokenCheck.valid ? current.reason : tokenCheck.reason,
    })
  }

  return current
}

export async function verifyTelegramWebhookSecretForUser(userId, secretToken) {
  await loadConfigForUser(userId)
  const token = await getTelegramTokenForUser(userId)
  if (!token) return false

  const expected = buildWebhookSecretFromToken(token)
  return String(secretToken || '') === expected
}

export async function processTelegramWebhookUpdateForUser(userId, update) {
  const telegramId = update.message?.from?.id || update.callback_query?.from?.id
  if (!telegramId) {
    return { success: false, reason: 'No telegramId in update.' }
  }

  const queueKey = `webhook_queue:${userId}:${telegramId}`
  await redisLpush(queueKey, update)

  const lockKey = `webhook_lock:${userId}:${telegramId}`
  const acquired = await redisSetNx(lockKey, '1', 30)
  if (!acquired) {
    return { success: true }
  }

  try {
    let botData = getBotDataForUser(userId)
    if (!botData) {
      botData = await spawnBotForUser(userId)
    }
    if (!botData?.bot) {
      return { success: false, reason: 'Bot runtime belum siap.' }
    }

    while (true) {
      const item = await redisRpop(queueKey)
      if (item === null) break
      botData.bot.processUpdate(item)
    }
  } finally {
    await redisDel(lockKey)
  }

  return { success: true }
}
