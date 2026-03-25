// src/services/botManager.js
// Mengelola spawn/stop instance bot per user (multi-tenant).
// Setiap user aktif mendapat satu instance bot yang berjalan dengan context userId-nya.

import TelegramBot from 'node-telegram-bot-api'
import { getUserById, canCreateNewBot } from './userService.js'
import { loadConfigForUser } from './configService.js'
import { getTelegramTokenForUser } from './configService.js'

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
    const token = getTelegramTokenForUser(userId)
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

    // Tentukan mode polling vs webhook
    const isPolling = options.botMode !== 'webhook'

    // Spawn bot instance
    const bot = new TelegramBot(token, { polling: isPolling })

    // Jika token revoke/salah, hentikan bot agar tidak flood log polling_error.
    bot.on('polling_error', async (err) => {
      const message = err?.message || ''
      console.error(`❌ Polling error user ${userId}:`, message)

      if (message.includes('401 Unauthorized')) {
        console.error(
          `⛔ Bot user ${userId} dihentikan otomatis karena token tidak valid.`,
        )
        setObservability(userId, {
          running: false,
          tokenStatus: 'invalid',
          reason: 'Polling 401 Unauthorized dari Telegram.',
        })
        await stopBotForUser(userId)
      }
    })

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
    if (botData.bot.isPolling()) {
      await botData.bot.stopPolling()
    }
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
    const botData = await spawnBotForUser(user.id, {
      botMode: user.botConfigs?.[0]?.botMode || 'polling',
    })

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

  const token = getTelegramTokenForUser(userId)
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
