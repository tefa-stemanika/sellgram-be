// src/services/evolution.js
// Client untuk Evolution API v2.x (WhatsApp).
// Credential diambil per tenant dari bot_credentials, dengan fallback ke environment.

import crypto from 'crypto'
import { loadCredsForUser } from './configService.js'

const DEFAULT_TIMEOUT_MS = 15_000
const WEBHOOK_SECRET_NAMESPACE = 'evolution-webhook'
const INSTANCE_PREFIX = 'tenant'

/**
 * Nama instance WhatsApp milik tenant. Selalu diturunkan dari userId,
 * tidak pernah diambil dari client maupun environment.
 */
export function buildTenantInstanceName(userId) {
  const compact = String(userId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()

  if (!compact) return null
  return `${INSTANCE_PREFIX}-${compact}`.slice(0, 60)
}

export class EvolutionApiError extends Error {
  constructor(message, { status = null, body = null, transient = false } = {}) {
    super(message)
    this.name = 'EvolutionApiError'
    this.status = status
    this.body = body
    this.transient = transient
  }
}

function normalizeBaseUrl(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '')
}

function normalizeConfig({ apiUrl, apiKey, instance }) {
  const normalizedUrl = normalizeBaseUrl(apiUrl)
  const normalizedKey = String(apiKey || '').trim()
  const normalizedInstance = String(instance || '').trim()

  if (!normalizedUrl || !normalizedKey || !normalizedInstance) return null

  return {
    apiUrl: normalizedUrl,
    apiKey: normalizedKey,
    instance: normalizedInstance,
  }
}

async function loadEvolutionCreds(userId) {
  try {
    return await loadCredsForUser(userId)
  } catch (err) {
    console.warn(
      `[Evolution] Gagal memuat credentials user=${userId}, fallback ke env: ${err.message}`,
    )
    return null
  }
}

function resolveServerConfig(creds) {
  return {
    apiUrl: normalizeBaseUrl(
      creds?.EVOLUTION_API_URL || process.env.EVOLUTION_API_URL,
    ),
    apiKey: String(
      creds?.EVOLUTION_API_KEY || process.env.EVOLUTION_API_KEY || '',
    ).trim(),
  }
}

/**
 * Konfigurasi server Evolution (tanpa instance) untuk operasi lifecycle,
 * mis. membuat instance baru.
 */
export async function getEvolutionServerConfigForUser(userId) {
  const creds = await loadEvolutionCreds(userId)
  const server = resolveServerConfig(creds)
  if (!server.apiUrl || !server.apiKey) return null
  return server
}

/**
 * Ambil konfigurasi Evolution untuk user.
 * URL/API key bisa dari bot_credentials (terenkripsi) atau environment.
 * Instance SELALU diturunkan dari userId — tidak ada fallback EVOLUTION_INSTANCE.
 */
export async function getWhatsAppConfigForUser(userId) {
  const creds = await loadEvolutionCreds(userId)
  const server = resolveServerConfig(creds)
  if (!server.apiUrl || !server.apiKey) return null

  return normalizeConfig({
    ...server,
    instance: buildTenantInstanceName(userId),
  })
}

export async function getWhatsAppClientForUser(userId) {
  const config = await getWhatsAppConfigForUser(userId)
  if (!config) return null
  return { client: createEvolutionClient(config), config }
}

const SENSITIVE_KEY_PATTERN = /(apikey|secret|token|password|authorization)/i

// Pesan error Evolution ikut ditulis ke log; body-nya bisa mengandung apikey
// atau secret webhook, jadi nilai key sensitif disamarkan sebelum di-serialize.
function safeErrorDump(data) {
  try {
    return JSON.stringify(data, (key, value) =>
      SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : value,
    ).slice(0, 500)
  } catch {
    return String(data).slice(0, 500)
  }
}

function extractErrorMessage(data, status) {
  if (!data) return `HTTP ${status}`
  if (typeof data === 'string') return data.slice(0, 500)

  const candidate =
    data.message ||
    data.response?.message ||
    (typeof data.error === 'string' ? data.error : null) ||
    (typeof data.response?.error === 'string' ? data.response.error : null) ||
    safeErrorDump(data)

  return String(candidate).slice(0, 500)
}

/**
 * Factory client Evolution API.
 * Semua request memakai header `apikey` sesuai dokumentasi v2.3.
 */
export function createEvolutionClient(config, options = {}) {
  const { apiUrl, apiKey, instance } = config
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS

  function instancePath(path) {
    return `${path}/${encodeURIComponent(instance)}`
  }

  async function request(method, path, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          apikey: apiKey,
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: controller.signal,
      })

      const raw = await response.text()
      let data = null
      if (raw) {
        try {
          data = JSON.parse(raw)
        } catch {
          data = raw
        }
      }

      if (!response.ok) {
        throw new EvolutionApiError(
          `Evolution API ${method} ${path} gagal (${response.status}): ${extractErrorMessage(data, response.status)}`,
          {
            status: response.status,
            body: data,
            transient: response.status >= 500 || response.status === 429,
          },
        )
      }

      // Sebagian endpoint Evolution membalas 200 dengan body error.
      if (
        data &&
        typeof data === 'object' &&
        (data.error || data.response?.error)
      ) {
        throw new EvolutionApiError(
          `Evolution API ${method} ${path} gagal: ${extractErrorMessage(data, response.status)}`,
          { status: response.status, body: data },
        )
      }

      return data
    } catch (err) {
      if (err instanceof EvolutionApiError) throw err

      const message =
        err?.name === 'AbortError'
          ? `Evolution API timeout ${timeoutMs}ms (${method} ${path})`
          : `Evolution API tidak dapat dihubungi (${method} ${path}): ${err?.message || err}`

      throw new EvolutionApiError(message, { transient: true })
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    config,

    createInstance(payload = {}) {
      const instanceName = String(payload.instanceName || instance || '').trim()
      if (!instanceName) {
        throw new EvolutionApiError('Nama instance Evolution wajib diisi.')
      }

      return request('POST', '/instance/create', {
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        ...payload,
        instanceName,
      })
    },

    fetchInstances() {
      return request('GET', '/instance/fetchInstances')
    },

    findContacts(where = {}) {
      return request('POST', instancePath('/chat/findContacts'), { where })
    },

    sendText(number, text, sendOptions = {}) {
      const target = String(number || '').trim()
      const content = String(text || '')
      if (!target) throw new EvolutionApiError('Nomor tujuan WhatsApp kosong.')
      if (!content) throw new EvolutionApiError('Teks WhatsApp kosong.')

      return request('POST', instancePath('/message/sendText'), {
        number: target,
        text: content,
        ...(sendOptions.delay !== undefined && { delay: sendOptions.delay }),
        ...(sendOptions.linkPreview !== undefined && {
          linkPreview: sendOptions.linkPreview,
        }),
        ...(sendOptions.quoted && { quoted: sendOptions.quoted }),
      })
    },

    setWebhook(webhook) {
      return request('POST', instancePath('/webhook/set'), {
        webhook: {
          enabled: true,
          byEvents: false,
          base64: false,
          ...webhook,
        },
      })
    },

    findWebhook() {
      return request('GET', instancePath('/webhook/find'))
    },

    connectionState() {
      return request('GET', instancePath('/instance/connectionState'))
    },

    connect(number) {
      const normalizedNumber = String(number || '').trim()
      const query = normalizedNumber
        ? `?number=${encodeURIComponent(normalizedNumber)}`
        : ''
      return request('GET', `${instancePath('/instance/connect')}${query}`)
    },

    async restart() {
      try {
        return await request('POST', instancePath('/instance/restart'))
      } catch (error) {
        // Sebagian versi Evolution memakai PUT untuk restart.
        if (
          error instanceof EvolutionApiError &&
          (error.status === 404 || error.status === 405)
        ) {
          return request('PUT', instancePath('/instance/restart'))
        }
        throw error
      }
    },
  }
}

export function buildEvolutionWebhookSecret(userId) {
  const key = process.env.EVOLUTION_WEBHOOK_SECRET || process.env.ENCRYPTION_KEY
  if (!key) return null
  return crypto
    .createHmac('sha256', key)
    .update(`${WEBHOOK_SECRET_NAMESPACE}:${userId}`)
    .digest('hex')
}

export function verifyEvolutionWebhookSecret(userId, providedSecret) {
  const expected = buildEvolutionWebhookSecret(userId)
  if (!expected || !providedSecret) return false

  const provided = Buffer.from(String(providedSecret))
  const target = Buffer.from(expected)
  return (
    provided.length === target.length && crypto.timingSafeEqual(provided, target)
  )
}

export function buildEvolutionWebhookUrl(userId, publicBaseUrl) {
  const base = normalizeBaseUrl(publicBaseUrl)
  if (!base) return null

  try {
    const parsed = new URL(base)
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
  } catch {
    return null
  }

  return `${base}/api/webhook/whatsapp/${encodeURIComponent(userId)}`
}
