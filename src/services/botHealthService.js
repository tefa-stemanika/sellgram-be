import {
  callTelegramApi,
  isBotActive,
  getActiveBots,
  getBotObservabilitySnapshot,
} from './botManager.js'
import { loadConfigForUser, getTelegramTokenForUser } from './configService.js'
import {
  getWhatsAppConfiguredUserIds,
  getWhatsAppStatusForUser,
} from './whatsappManager.js'
import { redisGet, redisSet } from './redis.js'

const PENDING_BACKLOG_LIMIT = 50
const LAST_ERROR_WINDOW_MS = 15 * 60 * 1000
const WEBHOOK_PATH_PREFIX = '/api/webhook/telegram/'

function parseIntEnv(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const HEALTH_CACHE_TTL_SECONDS = Math.max(
  parseIntEnv(process.env.BOT_HEALTH_CACHE_TTL_SECONDS, 60),
  1,
)
const MONITOR_INTERVAL_MS = parseIntEnv(
  process.env.BOT_HEALTH_MONITOR_INTERVAL_MS,
  300_000,
)

const inFlight = new Map()
const lastLoggedStatus = new Map()
let monitorTimer = null
let monitorRunning = false
let monitorStopped = false

function cacheKey(userId) {
  return `bot_health:${userId}`
}

function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim().replace(/\/$/, '')
  return raw || null
}

function normalizeUnixMs(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return num > 1e12 ? num : num * 1000
}

function aggregateStatus(issues, tokenStatus) {
  if (issues.some((issue) => issue.severity === 'critical')) return 'unhealthy'
  if (tokenStatus === 'unknown') return 'unknown'
  if (issues.some((issue) => issue.severity === 'warning')) return 'degraded'
  return 'healthy'
}

async function checkWebhook({ token, userId, baseUrl, checks, issues }) {
  const info = await callTelegramApi(token, 'getWebhookInfo', {})

  if (!info.ok || !info.body?.result || typeof info.body.result !== 'object') {
    checks.webhook.status = 'error'
    checks.webhook.error = info.reason || 'Gagal mengambil info webhook.'
    issues.push({
      code: 'WEBHOOK_CHECK_FAILED',
      severity: 'warning',
      message: checks.webhook.error,
    })
    return
  }

  const result = info.body.result
  const url = typeof result.url === 'string' ? result.url : ''
  const lastErrorMs = normalizeUnixMs(result.last_error_date)

  checks.webhook.url = url || null
  checks.webhook.pendingUpdateCount = Number.isFinite(result.pending_update_count)
    ? result.pending_update_count
    : null
  checks.webhook.lastErrorAt = lastErrorMs
    ? new Date(lastErrorMs).toISOString()
    : null
  checks.webhook.lastErrorMessage = result.last_error_message || null

  if (!url) {
    checks.webhook.status = 'missing'
    issues.push({
      code: 'WEBHOOK_URL_MISSING',
      severity: 'critical',
      message: 'Webhook belum terdaftar — bot tidak akan menerima pesan.',
    })
    return
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    checks.webhook.status = 'invalid_url'
    issues.push({
      code: 'WEBHOOK_URL_INVALID',
      severity: 'critical',
      message: `URL webhook tidak valid: ${url}`,
    })
    return
  }

  const expectedPath = `${WEBHOOK_PATH_PREFIX}${userId}`
  if (parsed.pathname !== expectedPath) {
    checks.webhook.status = 'url_mismatch'
    issues.push({
      code: 'WEBHOOK_URL_MISMATCH',
      severity: 'critical',
      message: `Path webhook tidak sesuai (${parsed.pathname}), seharusnya ${expectedPath}.`,
    })
    return
  }

  if (baseUrl) {
    try {
      const expectedHost = new URL(baseUrl).host
      if (parsed.host !== expectedHost) {
        // Info-only: host bisa berbeda saat dev di balik ngrok/proxy.
        issues.push({
          code: 'WEBHOOK_HOST_MISMATCH',
          severity: 'info',
          message: `Webhook terdaftar di host ${parsed.host}, sedangkan PUBLIC_BASE_URL mengarah ke ${expectedHost}.`,
        })
      }
    } catch {
      // baseUrl tidak valid; abaikan perbandingan host.
    }
  }

  checks.webhook.status = 'ok'

  if (lastErrorMs && Math.abs(Date.now() - lastErrorMs) <= LAST_ERROR_WINDOW_MS) {
    issues.push({
      code: 'WEBHOOK_LAST_ERROR_RECENT',
      severity: 'warning',
      message: `Telegram mencatat error pengiriman update: ${checks.webhook.lastErrorMessage || 'tidak diketahui'}.`,
    })
  }

  if (
    checks.webhook.pendingUpdateCount !== null &&
    checks.webhook.pendingUpdateCount > PENDING_BACKLOG_LIMIT
  ) {
    issues.push({
      code: 'WEBHOOK_PENDING_BACKLOG',
      severity: 'warning',
      message: `Ada ${checks.webhook.pendingUpdateCount} update tertunda di antrean Telegram (> ${PENDING_BACKLOG_LIMIT}).`,
    })
  }
}

async function checkWhatsApp({ userId, baseUrl, checks, issues }) {
  const status = await getWhatsAppStatusForUser(userId, { publicBaseUrl: baseUrl })

  if (!status.configured) {
    checks.whatsapp.status = 'not_configured'
    return
  }

  checks.whatsapp.instance = status.instance ?? null
  checks.whatsapp.instanceExists = status.instanceExists ?? null
  checks.whatsapp.state = status.state ?? null
  checks.whatsapp.connected = Boolean(status.connected)
  checks.whatsapp.webhookSynced = status.webhook
    ? Boolean(status.webhook.synced)
    : null

  if (status.instanceExists === false) {
    // Tenant yang belum pernah membuat instance memang belum pakai WhatsApp.
    checks.whatsapp.status = 'not_configured'
    return
  }

  if (status.errors?.length) {
    checks.whatsapp.status = 'error'
    checks.whatsapp.error = status.errors.join('; ')
    issues.push({
      code: 'WHATSAPP_CHECK_FAILED',
      severity: 'warning',
      message: `Tidak dapat memeriksa WhatsApp: ${checks.whatsapp.error}`,
    })
    return
  }

  checks.whatsapp.status = status.connected ? 'ok' : 'disconnected'

  if (!status.connected) {
    issues.push({
      code: 'WHATSAPP_NOT_CONNECTED',
      severity: 'warning',
      message: `Instance "${checks.whatsapp.instance}" belum terhubung ke WhatsApp (state: ${checks.whatsapp.state || 'tidak diketahui'}).`,
    })
  }

  if (checks.whatsapp.webhookSynced === false && status.webhook?.expectedUrl) {
    issues.push({
      code: 'WHATSAPP_WEBHOOK_NOT_SYNCED',
      severity: 'critical',
      message:
        'Webhook Evolution belum menunjuk ke endpoint tenant — pesan WhatsApp tidak akan diproses.',
    })
  }
}

export async function checkBotHealthForUser(userId, options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const checkedAt = new Date().toISOString()

  const issues = []
  const checks = {
    token: {
      status: 'unknown',
      botId: null,
      username: null,
      firstName: null,
      error: null,
    },
    webhook: {
      status: 'skipped',
      url: null,
      expectedUrl: baseUrl ? `${baseUrl}${WEBHOOK_PATH_PREFIX}${userId}` : null,
      pendingUpdateCount: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      error: null,
    },
    runtime: { active: false },
    activity: { lastUpdateAt: null },
    whatsapp: {
      status: 'skipped',
      instance: null,
      instanceExists: null,
      state: null,
      connected: false,
      webhookSynced: null,
      error: null,
    },
  }

  let token = null
  let configError = null

  try {
    await loadConfigForUser(userId)
    token = await getTelegramTokenForUser(userId)
  } catch (err) {
    configError = err
  }

  checks.runtime.active = isBotActive(userId)
  checks.activity.lastUpdateAt = getBotObservabilitySnapshot(userId).lastUpdateAt

  if (configError) {
    checks.token.status = 'unknown'
    checks.token.error = `Gagal memuat konfigurasi bot: ${configError.message}`
    issues.push({
      code: 'CONFIG_UNAVAILABLE',
      severity: 'warning',
      message: checks.token.error,
    })
  } else if (!token) {
    checks.token.status = 'missing'
    issues.push({
      code: 'TOKEN_MISSING',
      severity: 'critical',
      message: 'TELEGRAM_BOT_TOKEN belum diisi.',
    })
    issues.push({
      code: 'WEBHOOK_CHECK_SKIPPED',
      severity: 'info',
      message: 'Pengecekan webhook dilewati karena token belum tersedia.',
    })
  } else {
    const me = await callTelegramApi(token, 'getMe', {})

    if (me.ok && me.body?.result && typeof me.body.result === 'object') {
      checks.token.status = 'ok'
      checks.token.botId = me.body.result.id ?? null
      checks.token.username = me.body.result.username ?? null
      checks.token.firstName = me.body.result.first_name ?? null
    } else if (me.status === 401 || me.status === 403 || me.status === 404) {
      checks.token.status = 'invalid'
      checks.token.error = me.reason || `HTTP ${me.status}`
      issues.push({
        code: 'TOKEN_INVALID',
        severity: 'critical',
        message: `Token Telegram ditolak: ${checks.token.error}`,
      })
    } else {
      checks.token.status = 'unknown'
      checks.token.error = me.reason || 'Tidak dapat menghubungi Telegram.'
      issues.push({
        code: 'TELEGRAM_API_UNREACHABLE',
        severity: 'warning',
        message: checks.token.error,
      })
    }

    if (checks.token.status === 'ok') {
      await checkWebhook({ token, userId, baseUrl, checks, issues })
    } else {
      issues.push({
        code: 'WEBHOOK_CHECK_SKIPPED',
        severity: 'info',
        message: 'Pengecekan webhook dilewati karena token tidak dapat diverifikasi.',
      })
    }
  }

  if (checks.token.status === 'ok' && !checks.runtime.active) {
    issues.push({
      code: 'BOT_NOT_SPAWNED',
      severity: 'warning',
      message: 'Token valid tetapi bot tidak berjalan di proses ini.',
    })
  }

  try {
    await checkWhatsApp({ userId, baseUrl, checks, issues })
  } catch (err) {
    checks.whatsapp.status = 'error'
    checks.whatsapp.error = err.message
    issues.push({
      code: 'WHATSAPP_CHECK_FAILED',
      severity: 'warning',
      message: `Tidak dapat memeriksa WhatsApp: ${err.message}`,
    })
  }

  const result = {
    userId,
    status: aggregateStatus(issues, checks.token.status),
    cached: false,
    checkedAt,
    cacheTtlSeconds: HEALTH_CACHE_TTL_SECONDS,
    checks,
    issues,
  }

  try {
    await redisSet(cacheKey(userId), result, HEALTH_CACHE_TTL_SECONDS)
  } catch (err) {
    console.warn(`[BotHealth] gagal menyimpan cache user=${userId}: ${err.message}`)
  }

  return result
}

export async function getBotHealthForUser(userId, options = {}) {
  const { refresh = false, baseUrl = null } = options

  if (inFlight.has(userId)) return inFlight.get(userId)

  const job = (async () => {
    if (!refresh) {
      const cached = await redisGet(cacheKey(userId)).catch(() => null)
      if (cached && typeof cached === 'object') {
        return { ...cached, cached: true }
      }
    }

    return checkBotHealthForUser(userId, { baseUrl })
  })()

  inFlight.set(userId, job)

  try {
    return await job
  } finally {
    inFlight.delete(userId)
  }
}

export function startBotHealthMonitor() {
  if (monitorTimer) return

  if (MONITOR_INTERVAL_MS <= 0) {
    console.log('[BotHealth] Monitor dinonaktifkan (BOT_HEALTH_MONITOR_INTERVAL_MS <= 0).')
    return
  }

  monitorStopped = false
  monitorTimer = setInterval(() => {
    void runHealthMonitorCycle()
  }, MONITOR_INTERVAL_MS)
  monitorTimer.unref?.()

  console.log(
    `[BotHealth] Monitor aktif tiap ${Math.round(MONITOR_INTERVAL_MS / 1000)}s.`,
  )
}

export function stopBotHealthMonitor() {
  monitorStopped = true
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
  lastLoggedStatus.clear()
}

function logStatusTransition(userId, result) {
  const previous = lastLoggedStatus.get(userId)
  if (previous === result.status) return

  lastLoggedStatus.set(userId, result.status)

  if (result.status === 'healthy') {
    if (previous) console.log(`[BotHealth] user=${userId} kembali healthy.`)
    return
  }

  const detail = result.issues
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join(' | ')
  console.warn(`[BotHealth] user=${userId} status=${result.status} ${detail}`)
}

async function runHealthMonitorCycle() {
  if (monitorRunning || monitorStopped) return

  monitorRunning = true
  const summary = {
    checked: 0,
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unknown: 0,
  }

  try {
    const userIds = new Set(Array.from(getActiveBots().keys()))
    try {
      for (const id of await getWhatsAppConfiguredUserIds()) userIds.add(id)
    } catch (err) {
      console.warn(`[BotHealth] gagal daftar user WhatsApp: ${err.message}`)
    }
    const baseUrl = String(process.env.PUBLIC_BASE_URL || '').trim() || null

    for (const userId of userIds) {
      if (monitorStopped) break

      try {
        const result = await getBotHealthForUser(userId, {
          refresh: true,
          baseUrl,
        })
        summary.checked++
        summary[result.status]++
        logStatusTransition(userId, result)
      } catch (err) {
        console.error(`[BotHealth] gagal cek user=${userId}: ${err.message}`)
      }
    }

    console.log(
      `[BotHealth] checked=${summary.checked} healthy=${summary.healthy} degraded=${summary.degraded} unhealthy=${summary.unhealthy} unknown=${summary.unknown}`,
    )
  } finally {
    monitorRunning = false
  }
}
