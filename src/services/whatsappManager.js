// src/services/whatsappManager.js
// Transport layer WhatsApp (Evolution API): webhook, queue, status, dan pesan keluar.

import { randomUUID } from 'node:crypto'
import prisma from './db.js'
import {
  getRedisClient,
  redisSetNx,
  redisGet,
  redisSet,
  redisLpush,
  redisRpop,
  redisRpush,
  redisLrange,
  redisExpire,
  redisReleaseLock,
  redisRefreshLock,
} from './redis.js'
import { getAllActiveUsers } from './userService.js'
import {
  normalizePhoneJid,
  normalizeWhatsAppJid,
  maskChatId,
} from './whatsappJid.js'
import {
  getWhatsAppConfigForUser,
  getWhatsAppClientForUser,
  getEvolutionServerConfigForUser,
  createEvolutionClient,
  buildEvolutionWebhookSecret,
  buildEvolutionWebhookUrl,
  buildTenantInstanceName,
} from './evolution.js'
import { handleIncomingWhatsAppMessage } from '../handlers/whatsappHandler.js'

export { buildTenantInstanceName }

const WEBHOOK_EVENTS = ['MESSAGES_UPSERT']
const DEDUP_TTL_SECONDS = 600
const LOCK_TTL_SECONDS = 60
const QUEUE_TTL_SECONDS = 300
// Batas antrean per chat. Tanpa ini, satu chat yang drainer-nya sedang sibuk
// (satu giliran AI bisa puluhan detik) bisa menumpuk payload tanpa batas.
const MAX_QUEUED_MESSAGES = 50
// Pesan yang tertahan di queue lebih dari ini tidak dijawab lagi: konteks
// percakapan sudah berubah dan reply telat membingungkan pelanggan.
const MAX_QUEUED_MESSAGE_AGE_SECONDS = 900
const LID_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30
const LID_MISS_TTL_SECONDS = 60 * 5
const LID_MISS_VALUE = '-'
export const MAX_WHATSAPP_INSTANCES_PER_USER = 1

/**
 * Nomor untuk pairing code: hanya digit, 8-15 karakter (E.164 tanpa '+').
 */
export function validateWhatsAppNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

function normalizeQrImage(value) {
  const text = String(value || '').trim()
  if (!text) return null

  const commaIndex = text.indexOf(',')
  const payload =
    text.startsWith('data:') && commaIndex >= 0
      ? text.slice(commaIndex + 1)
      : text

  return payload.trim().length >= 100 ? text : null
}

/**
 * Normalisasi respons QR dari /instance/create atau /instance/connect.
 * Evolution dapat membungkusnya di `qrcode` atau `instance.qrcode`.
 */
export function normalizeQrPayload(payload) {
  if (!payload || typeof payload !== 'object') return null

  const candidates = [
    payload.qrcode,
    payload.instance?.qrcode,
    payload.instance,
    payload,
  ]
  const source = candidates.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      (candidate.base64 || candidate.code || candidate.pairingCode),
  )
  if (!source) return null

  const base64 = normalizeQrImage(source.base64)
  const code =
    typeof source.code === 'string' && source.code.trim()
      ? source.code.trim()
      : null
  const pairingCode =
    typeof source.pairingCode === 'string' && source.pairingCode.trim()
      ? source.pairingCode.trim()
      : null
  const countValue = Number(source.count)
  const count = Number.isFinite(countValue) ? countValue : null

  if (!base64 && !code && !pairingCode) return null
  return { base64, code, pairingCode, count }
}

export function normalizeInstanceState(response) {
  return (
    response?.instance?.state ||
    response?.state ||
    response?.connectionStatus ||
    null
  )
}

function extractInstanceList(response) {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.data)) return response.data
  return []
}

function getInstanceName(item) {
  return item?.name || item?.instance?.instanceName || item?.instanceName || null
}

async function listInstances(client) {
  return extractInstanceList(await client.fetchInstances())
}

function extractWebhookConfig(response) {
  const data = response?.webhook || response
  if (!data || typeof data !== 'object') return null

  return {
    url: data.url || null,
    enabled: Boolean(data.enabled),
    events: Array.isArray(data.events)
      ? data.events
      : Array.isArray(data.webhook?.events)
        ? data.webhook.events
        : [],
  }
}

function isWebhookSynced(webhook, expectedUrl) {
  return Boolean(
    webhook &&
      expectedUrl &&
      webhook.enabled &&
      webhook.url === expectedUrl &&
      WEBHOOK_EVENTS.every((event) => webhook.events.includes(event)),
  )
}

export function shouldProcessWhatsAppItem(item) {
  const key = item?.key
  if (!key?.remoteJid || !key?.id) return false
  if (key.fromMe) return false

  const jid = normalizeWhatsAppJid(key.remoteJid)
  if (!jid) return false
  if (jid === 'status@broadcast') return false
  if (
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@newsletter')
  ) {
    return false
  }

  return true
}

export async function sendWhatsAppTextForUser(userId, to, text, options = {}) {
  const ctx = await getWhatsAppClientForUser(userId)
  if (!ctx) {
    throw new Error('Kredensial Evolution API belum dikonfigurasi.')
  }

  const target = await resolveOutboundJid(userId, to, ctx.client)
  if (!target) {
    throw new Error('Nomor tujuan WhatsApp tidak valid.')
  }

  return ctx.client.sendText(target, text, options)
}

export async function configureWhatsAppWebhookForUser(
  userId,
  publicBaseUrl,
  ctxOverride = null,
) {
  const ctx = ctxOverride || (await getWhatsAppClientForUser(userId))
  if (!ctx) {
    return {
      success: false,
      reason:
        'EVOLUTION_API_URL dan EVOLUTION_API_KEY belum dikonfigurasi.',
    }
  }

  const webhookUrl = buildEvolutionWebhookUrl(userId, publicBaseUrl)
  if (!webhookUrl) {
    return {
      success: false,
      reason: 'PUBLIC_BASE_URL tidak tersedia atau bukan URL http(s) yang valid.',
    }
  }

  const secret = buildEvolutionWebhookSecret(userId)
  if (!secret) {
    return {
      success: false,
      reason:
        'ENCRYPTION_KEY atau EVOLUTION_WEBHOOK_SECRET belum diisi untuk mengamankan webhook.',
    }
  }

  try {
    await ctx.client.setWebhook({
      url: webhookUrl,
      headers: {
        'Content-Type': 'application/json',
        'x-evolution-webhook-secret': secret,
      },
      events: WEBHOOK_EVENTS,
    })

    return {
      success: true,
      instance: ctx.config.instance,
      webhookUrl,
      events: WEBHOOK_EVENTS,
    }
  } catch (error) {
    return {
      success: false,
      reason: error.message,
      transient: Boolean(error.transient),
    }
  }
}

/**
 * Pastikan webhook instance sudah menunjuk ke endpoint tenant.
 * Hanya memanggil /webhook/set bila belum ada atau tidak sesuai.
 */
export async function ensureWhatsAppWebhookForUser(
  userId,
  publicBaseUrl,
  ctxOverride = null,
  options = {},
) {
  const ctx = ctxOverride || (await getWhatsAppClientForUser(userId))
  if (!ctx) {
    return {
      success: false,
      code: 'not_configured',
      reason:
        'EVOLUTION_API_URL dan EVOLUTION_API_KEY belum dikonfigurasi.',
    }
  }

  const webhookUrl = buildEvolutionWebhookUrl(userId, publicBaseUrl)
  if (!webhookUrl) {
    return {
      success: false,
      code: 'public_base_url_missing',
      reason: 'PUBLIC_BASE_URL tidak tersedia atau bukan URL http(s) yang valid.',
    }
  }

  const secret = buildEvolutionWebhookSecret(userId)
  if (!secret) {
    return {
      success: false,
      code: 'webhook_secret_missing',
      reason:
        'ENCRYPTION_KEY atau EVOLUTION_WEBHOOK_SECRET belum diisi untuk mengamankan webhook.',
    }
  }

  let current = null
  let lookupError = null
  try {
    current = extractWebhookConfig(await ctx.client.findWebhook())
  } catch (error) {
    if (error?.status !== 404) {
      lookupError = error.message
    }
  }

  if (!options.force && isWebhookSynced(current, webhookUrl)) {
    return {
      success: true,
      action: 'unchanged',
      instance: ctx.config.instance,
      webhookUrl,
      events: WEBHOOK_EVENTS,
      previousUrl: current.url,
    }
  }

  const result = await configureWhatsAppWebhookForUser(
    userId,
    publicBaseUrl,
    ctx,
  )

  return {
    ...result,
    code: result.success ? null : 'webhook_set_failed',
    action: result.success ? (current ? 'updated' : 'created') : null,
    previousUrl: current?.url || null,
    lookupError,
  }
}

export async function getWhatsAppStatusForUser(userId, options = {}) {
  const { publicBaseUrl } = options
  const ctx = await getWhatsAppClientForUser(userId)
  if (!ctx) {
    return {
      configured: false,
      reason: 'EVOLUTION_API_URL dan EVOLUTION_API_KEY belum dikonfigurasi.',
    }
  }

  const expectedWebhookUrl = publicBaseUrl
    ? buildEvolutionWebhookUrl(userId, publicBaseUrl)
    : null
  const errors = []
  let state = null
  let instanceExists = null
  let webhook = null

  try {
    state = normalizeInstanceState(await ctx.client.connectionState())
    instanceExists = true
  } catch (error) {
    if (error?.status === 404) {
      instanceExists = false
    } else {
      errors.push(`connectionState: ${error.message}`)
    }
  }

  if (instanceExists !== false) {
    try {
      const webhookConfig = extractWebhookConfig(
        await ctx.client.findWebhook(),
      )

      if (webhookConfig) {
        webhook = {
          ...webhookConfig,
          expectedUrl: expectedWebhookUrl,
          synced: isWebhookSynced(webhookConfig, expectedWebhookUrl),
        }
      }
    } catch (error) {
      errors.push(`findWebhook: ${error.message}`)
    }
  }

  return {
    configured: true,
    instance: ctx.config.instance,
    instanceExists,
    needsCreate: instanceExists === false,
    instanceLimit: MAX_WHATSAPP_INSTANCES_PER_USER,
    apiUrl: ctx.config.apiUrl,
    state,
    connected: state === 'open',
    webhook,
    errors,
  }
}

async function getTenantLifecycleContext(userId) {
  const server = await getEvolutionServerConfigForUser(userId)
  if (!server) return { error: 'not_configured' }

  const instance = buildTenantInstanceName(userId)
  if (!instance) return { error: 'invalid_user' }

  return {
    server,
    instance,
    client: createEvolutionClient({ ...server, instance }),
  }
}

/**
 * Pastikan tenant punya instance Evolution sendiri.
 * Idempotent: instance yang sudah ada tidak dibuat ulang.
 */
export async function createWhatsAppInstanceForUser(userId, options = {}) {
  const { publicBaseUrl, number } = options
  const context = await getTenantLifecycleContext(userId)

  if (context.error === 'not_configured') {
    return {
      success: false,
      code: 'not_configured',
      reason: 'EVOLUTION_API_URL dan EVOLUTION_API_KEY belum dikonfigurasi.',
    }
  }
  if (context.error) {
    return {
      success: false,
      code: context.error,
      reason: 'User tidak valid untuk membuat instance WhatsApp.',
    }
  }

  let normalizedNumber = null
  if (number !== undefined && number !== null && String(number).trim() !== '') {
    normalizedNumber = validateWhatsAppNumber(number)
    if (!normalizedNumber) {
      return {
        success: false,
        code: 'invalid_number',
        reason: 'Nomor WhatsApp tidak valid (8-15 digit, tanpa awalan +).',
      }
    }
  }

  let instances = []
  try {
    instances = await listInstances(context.client)
  } catch (error) {
    return {
      success: false,
      code: 'server_unreachable',
      reason: error.message,
      transient: Boolean(error.transient),
    }
  }

  const ownedInstances = instances.filter(
    (item) => getInstanceName(item) === context.instance,
  )

  if (ownedInstances.length > MAX_WHATSAPP_INSTANCES_PER_USER) {
    return {
      success: false,
      code: 'instance_limit_reached',
      instance: context.instance,
      instances: ownedInstances.map(getInstanceName),
      instanceLimit: MAX_WHATSAPP_INSTANCES_PER_USER,
      reason: `Maksimal ${MAX_WHATSAPP_INSTANCES_PER_USER} instance WhatsApp per user.`,
    }
  }

  let created = false
  let createResponse = null

  if (ownedInstances.length === 0) {
    try {
      createResponse = await context.client.createInstance({
        instanceName: context.instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        ...(normalizedNumber && { number: normalizedNumber }),
      })
      created = true
    } catch (error) {
      const alreadyExists =
        error?.status === 409 ||
        /already (in use|exists)|instance.*already/i.test(error.message)
      if (!alreadyExists) {
        return {
          success: false,
          code: 'create_failed',
          instance: context.instance,
          reason: error.message,
          transient: Boolean(error.transient),
        }
      }
    }
  }

  const webhook = await ensureWhatsAppWebhookForUser(userId, publicBaseUrl)

  let state = null
  try {
    state = normalizeInstanceState(await context.client.connectionState())
  } catch {}

  const qr = normalizeQrPayload(createResponse)

  return {
    success: true,
    code: null,
    created,
    instance: context.instance,
    instanceLimit: MAX_WHATSAPP_INSTANCES_PER_USER,
    apiUrl: context.server.apiUrl,
    state,
    connected: state === 'open',
    qr,
    webhook,
  }
}

/**
 * Ambil QR/pairing code untuk menghubungkan WhatsApp seperti WhatsApp Web.
 */
export async function connectWhatsAppForUser(userId, options = {}) {
  const { number, publicBaseUrl } = options
  const config = await getWhatsAppConfigForUser(userId)
  if (!config) {
    return {
      success: false,
      code: 'not_configured',
      reason:
        'EVOLUTION_API_URL dan EVOLUTION_API_KEY belum dikonfigurasi.',
    }
  }

  let normalizedNumber = null
  if (number !== undefined && number !== null && String(number).trim() !== '') {
    normalizedNumber = validateWhatsAppNumber(number)
    if (!normalizedNumber) {
      return {
        success: false,
        code: 'invalid_number',
        instance: config.instance,
        reason: 'Nomor WhatsApp tidak valid (8-15 digit, tanpa awalan +).',
      }
    }
  }

  const client = createEvolutionClient(config)

  let response = null
  try {
    response = await client.connect(normalizedNumber)
  } catch (error) {
    const missing = error?.status === 404
    return {
      success: false,
      code: missing ? 'instance_missing' : 'connect_failed',
      instance: config.instance,
      reason: missing
        ? 'Instance WhatsApp belum dibuat. Panggil endpoint create instance terlebih dahulu.'
        : error.message,
      transient: Boolean(error.transient),
    }
  }

  const qr = normalizeQrPayload(response)
  let state = normalizeInstanceState(response)

  if (!state) {
    try {
      state = normalizeInstanceState(await client.connectionState())
    } catch {}
  }

  const webhook = await ensureWhatsAppWebhookForUser(userId, publicBaseUrl)

  return {
    success: true,
    instance: config.instance,
    state,
    connected: state === 'open',
    base64: qr?.base64 || null,
    code: qr?.code || null,
    pairingCode: qr?.pairingCode || null,
    count: qr?.count ?? null,
    webhook,
  }
}

/**
 * Restart instance lalu sinkronkan webhook dan kembalikan status terbaru.
 */
export async function restartWhatsAppForUser(
  userId,
  publicBaseUrl,
  ctxOverride = null,
) {
  const ctx = ctxOverride || (await getWhatsAppClientForUser(userId))
  if (!ctx) {
    return {
      success: false,
      code: 'not_configured',
      reason:
        'EVOLUTION_API_URL dan EVOLUTION_API_KEY belum dikonfigurasi.',
    }
  }

  let restarted = false
  let restartError = null
  let restartTransient = false
  try {
    await ctx.client.restart()
    restarted = true
  } catch (error) {
    restartError = error.message
    restartTransient = Boolean(error?.transient)

    if (error?.status === 404) {
      return {
        success: false,
        code: 'instance_missing',
        instance: ctx.config.instance,
        restarted: false,
        restartError,
        reason:
          'Instance WhatsApp belum dibuat. Panggil endpoint create instance terlebih dahulu.',
      }
    }
  }

  const webhookResult = await ensureWhatsAppWebhookForUser(
    userId,
    publicBaseUrl,
    ctx,
    { force: true },
  )
  const status = await getWhatsAppStatusForUser(userId, { publicBaseUrl })

  // Restart yang gagal harus terlihat oleh tenant walaupun webhook berhasil;
  // kalau tidak, dashboard menampilkan "sukses" untuk instance yang masih mati.
  const success = restarted && webhookResult.success

  return {
    success,
    code: success
      ? null
      : restarted
        ? 'webhook_failed'
        : 'restart_failed',
    instance: ctx.config.instance,
    restarted,
    restartError,
    transient: restarted
      ? Boolean(webhookResult.transient)
      : restartTransient,
    reason: success
      ? null
      : restarted
        ? webhookResult.reason
        : restartError || 'Gagal me-restart instance WhatsApp.',
    webhookUrl: webhookResult.webhookUrl || null,
    webhook: webhookResult,
    status,
  }
}

export async function reconnectWhatsAppForUser(userId, publicBaseUrl) {
  return restartWhatsAppForUser(userId, publicBaseUrl)
}

export async function initializeWhatsAppWebhooksForActiveUsers(publicBaseUrl) {
  const baseUrl = String(publicBaseUrl || '').trim()
  if (!baseUrl) {
    console.warn(
      '[WhatsApp] PUBLIC_BASE_URL belum diisi — sinkronisasi webhook dilewati.',
    )
    return { configured: 0, skipped: 0, failed: 0 }
  }

  let users = []
  try {
    users = await getAllActiveUsers()
  } catch (error) {
    console.error(
      `[WhatsApp] Gagal memuat active users untuk sinkronisasi webhook: ${error.message}`,
    )
    return { configured: 0, skipped: 0, failed: 0 }
  }

  const summary = { configured: 0, skipped: 0, failed: 0 }

  for (const user of users) {
    const config = await getWhatsAppConfigForUser(user.id)
    if (!config) {
      summary.skipped++
      continue
    }

    try {
      await createEvolutionClient(config).connectionState()
    } catch (error) {
      if (error?.status === 404) {
        // Instance belum dibuat tenant; jangan set webhook.
        summary.skipped++
        continue
      }
      summary.failed++
      console.warn(
        `[WhatsApp] Gagal cek instance user=${user.id}: ${error.message}`,
      )
      continue
    }

    // Idempotent: hanya panggil /webhook/set bila URL/event memang berubah,
    // supaya boot tidak menimpa konfigurasi webhook tenant yang sudah benar.
    const result = await ensureWhatsAppWebhookForUser(user.id, baseUrl)
    if (result.success) {
      summary.configured++
      if (result.action !== 'unchanged') {
        console.log(
          `[WhatsApp] Webhook user=${user.id} instance="${result.instance}" → ${result.webhookUrl}`,
        )
      }
    } else {
      summary.failed++
      console.warn(
        `[WhatsApp] Gagal set webhook user=${user.id}: ${result.reason}`,
      )
    }
  }

  console.log(
    `[WhatsApp] Sinkronisasi webhook selesai: ${summary.configured} berhasil, ${summary.failed} gagal, ${summary.skipped} dilewati.`,
  )

  return summary
}

/**
 * JID telepon alternatif dari webhook Evolution 2.3+.
 * Untuk pesan ber-addressing LID, field ini memetakan @lid ke nomor asli
 * sehingga balasan tidak dikirim ke JID @lid (tidak didukung v2.2.x).
 */
export function extractAlternativeJid(key) {
  return (
    normalizePhoneJid(key?.remoteJidAlt) ||
    normalizePhoneJid(key?.senderPn) ||
    normalizePhoneJid(key?.participantAlt) ||
    null
  )
}

function lidCacheKey(userId, lid) {
  return `whatsapp_lid:${userId}:${lid}`
}

function extractContactList(response) {
  if (Array.isArray(response)) return response
  if (Array.isArray(response?.data)) return response.data
  return []
}

/**
 * Fallback untuk Evolution 2.2.x yang belum mengirim remoteJidAlt:
 * petakan @lid ke nomor telepon lewat kontak dengan profile picture yang sama.
 * Hanya dipakai bila kandidatnya tunggal agar tidak salah kirim.
 */
export function matchContactByLid(contacts, remoteJid) {
  const lid = normalizeWhatsAppJid(remoteJid)
  const list = Array.isArray(contacts) ? contacts : []
  const target = list.find(
    (contact) => normalizeWhatsAppJid(contact?.remoteJid) === lid,
  )
  const picture = String(target?.profilePicUrl || '').trim()
  if (!picture) return null

  const targetName = String(target?.pushName || '').trim()
  const candidates = list.filter((contact) => {
    const phoneJid = normalizePhoneJid(contact?.remoteJid)
    if (!phoneJid) return false
    if (String(contact?.profilePicUrl || '').trim() !== picture) return false
    if (
      targetName &&
      contact?.pushName &&
      String(contact.pushName).trim() !== targetName
    ) {
      return false
    }
    return true
  })

  const unique = [...new Set(candidates.map((c) => normalizePhoneJid(c.remoteJid)))]
  return unique.length === 1 ? unique[0] : null
}

async function resolveLidViaContacts(client, remoteJid) {
  const contacts = extractContactList(await client.findContacts())
  return matchContactByLid(contacts, remoteJid)
}

/**
 * Resolusi JID tujuan pesan keluar. Order lama bisa menyimpan @lid
 * sebelum upgrade Evolution, jadi petakan dulu ke nomor telepon.
 */
async function resolveOutboundJid(userId, to, client) {
  const remoteJid = normalizeWhatsAppJid(to)
  if (!remoteJid) return null
  if (!remoteJid.endsWith('@lid')) return remoteJid

  const cacheKey = lidCacheKey(userId, remoteJid)
  const cached = await redisGet(cacheKey).catch(() => null)
  if (cached === LID_MISS_VALUE) return remoteJid
  if (cached) return cached

  let resolved = null
  try {
    resolved = await resolveLidViaContacts(client, remoteJid)
  } catch (error) {
    console.warn(
      `[WhatsApp] Gagal memetakan ${maskChatId(remoteJid)} lewat kontak: ${error.message}`,
    )
  }

  if (resolved) {
    await redisSet(cacheKey, resolved, LID_CACHE_TTL_SECONDS).catch(() => {})
    return resolved
  }

  await redisSet(cacheKey, LID_MISS_VALUE, LID_MISS_TTL_SECONDS).catch(
    () => {},
  )
  console.warn(
    `[WhatsApp] Tujuan ${maskChatId(remoteJid)} belum bisa dipetakan ke nomor telepon; ` +
      'pesan tetap dikirim ke JID @lid dan bisa gagal di Evolution < 2.3.',
  )
  return remoteJid
}

const CHAT_STATE_PREFIXES = ['order', 'session', 'welcome_sent', 'whatsapp_queue']

/**
 * Chat ID bisa berubah dari `@lid` ke nomor telepon beberapa pesan setelah
 * pemetaan berhasil (Evolution 2.2.x). State order/session yang sudah ditulis
 * di kunci lama harus ikut pindah, kalau tidak order yang sedang CONFIRMING
 * menggantung di kunci yang tidak pernah dipakai lagi.
 */
export async function migrateChatState(userId, fromChatId, toChatId) {
  if (!fromChatId || !toChatId || fromChatId === toChatId) return

  const client = getRedisClient()

  for (const prefix of CHAT_STATE_PREFIXES) {
    const fromKey = `${prefix}:${userId}:${fromChatId}`
    const toKey = `${prefix}:${userId}:${toChatId}`

    try {
      if ((await client.exists(fromKey)) === 0) continue
      const moved = await client.renamenx(fromKey, toKey)
      // Kunci tujuan sudah ada (mis. state @lid masih dipakai drainer lain,
      // atau state nomor telepon yang lebih baru). Jangan menimpa maupun
      // membuang sumbernya: biarkan TTL yang membersihkan supaya state yang
      // sedang aktif tidak hilang.
      if (!moved) {
        console.warn(
          `[WhatsApp] State ${prefix} tidak dipindahkan (tujuan sudah ada) user=${userId} chat=${maskChatId(toChatId)}`,
        )
      }
    } catch (error) {
      console.warn(
        `[WhatsApp] Gagal memindahkan state ${prefix} user=${userId}: ${error.message}`,
      )
    }
  }
}

async function resolveIncomingChat(userId, key, client) {
  const remoteJid = normalizeWhatsAppJid(key?.remoteJid)
  if (!remoteJid) return null
  if (!remoteJid.endsWith('@lid')) return remoteJid

  const alternative = extractAlternativeJid(key)
  if (alternative) {
    await redisSet(
      lidCacheKey(userId, remoteJid),
      alternative,
      LID_CACHE_TTL_SECONDS,
    ).catch(() => {})
    await migrateChatState(userId, remoteJid, alternative)
    return alternative
  }

  const cacheKey = lidCacheKey(userId, remoteJid)
  const cached = await redisGet(cacheKey).catch(() => null)
  if (cached === LID_MISS_VALUE) return remoteJid
  if (cached) return cached

  let resolved = null
  try {
    resolved = await resolveLidViaContacts(client, remoteJid)
  } catch (error) {
    console.warn(
      `[WhatsApp] Gagal memetakan ${maskChatId(remoteJid)} lewat kontak: ${error.message}`,
    )
  }

  if (resolved) {
    await redisSet(cacheKey, resolved, LID_CACHE_TTL_SECONDS).catch(() => {})
    await migrateChatState(userId, remoteJid, resolved)
    return resolved
  }

  await redisSet(cacheKey, LID_MISS_VALUE, LID_MISS_TTL_SECONDS).catch(
    () => {},
  )
  console.warn(
    `[WhatsApp] JID ${maskChatId(remoteJid)} belum bisa dipetakan ke nomor telepon. ` +
      'Upgrade Evolution API ke >= 2.3.x agar webhook menyertakan remoteJidAlt.',
  )
  return remoteJid
}

export function isStaleQueuedMessage(item) {
  const raw = Number(item?.messageTimestamp)
  if (!Number.isFinite(raw) || raw <= 0) return false
  // Evolution ada yang mengirim detik, ada yang milidetik tergantung versi.
  const timestampSeconds = raw > 1e11 ? Math.floor(raw / 1000) : raw
  return Math.floor(Date.now() / 1000) - timestampSeconds > MAX_QUEUED_MESSAGE_AGE_SECONDS
}

async function drainQueue({ userId, chatId, queueKey, lockKey, lockToken }) {
  let ownsLock = true

  try {
    while (true) {
      const item = await redisRpop(queueKey)

      if (item === null) {
        // Lepas lock dulu, lalu cek apakah ada pesan yang masuk di sela terakhir.
        await redisReleaseLock(lockKey, lockToken)
        ownsLock = false

        const pending = await redisLrange(queueKey, 0, 0).catch(() => [])
        if (pending.length === 0) return

        const reacquired = await redisSetNx(lockKey, lockToken, LOCK_TTL_SECONDS)
        if (!reacquired) return

        ownsLock = true
        continue
      }

      // Perpanjangi TTL sebelum memproses: satu giliran bisa memakan waktu
      // panjang (AI + beberapa kirim pesan) dan lock tidak boleh kedaluwarsa.
      // Kalau refresh menolak, lock sudah pindah tangan — pesan dikembalikan
      // ke ekor queue supaya drainer yang sah yang memproses duluan, bukan
      // dua-duanya. Fail-closed: kegagalan refresh diperlakukan sebagai
      // kehilangan lock; kalau pengembalian ke queue juga gagal (Redis mati),
      // pesan diproses saja daripada hilang — state-nya toh tidak akan kebaca.
      const masihMemegang = await redisRefreshLock(
        lockKey,
        lockToken,
        LOCK_TTL_SECONDS,
      ).catch(() => false)

      if (!masihMemegang) {
        const dikembalikan = await redisRpush(queueKey, item)
          .then(() => true)
          .catch(() => false)

        if (dikembalikan) {
          ownsLock = false
          await redisExpire(queueKey, QUEUE_TTL_SECONDS).catch(() => {})
          console.warn(
            `[WhatsApp] Lock chat ${maskChatId(chatId)} user=${userId} sudah pindah tangan, pesan dikembalikan ke queue`,
          )
          return
        }

        console.error(
          `[WhatsApp] Lock chat ${maskChatId(chatId)} user=${userId} hilang dan pesan tidak bisa dikembalikan — diproses di sini`,
        )
      }

      if (isStaleQueuedMessage(item)) {
        console.warn(
          `[WhatsApp] Pesan kadaluarsa di queue dilewati user=${userId} chat=${maskChatId(chatId)}`,
        )
        continue
      }

      // Satu giliran bisa lebih lama dari TTL lock (AI + beberapa kirim pesan),
      // jadi lock dipanjangkan selama pemrosesan agar drainer lain tidak masuk.
      const heartbeat = setInterval(() => {
        redisRefreshLock(lockKey, lockToken, LOCK_TTL_SECONDS)
          .then((masihMilikKita) => {
            if (!masihMilikKita) clearInterval(heartbeat)
          })
          .catch(() => {})
      }, Math.max(1000, Math.floor((LOCK_TTL_SECONDS * 1000) / 3)))

      try {
        await handleIncomingWhatsAppMessage({
          userId,
          chatId,
          data: item,
        })
      } catch (error) {
        console.error(
          `[WhatsApp] Gagal memproses pesan user=${userId} chat=${maskChatId(chatId)}: ${error.message}`,
        )
      } finally {
        clearInterval(heartbeat)
      }
    }
  } finally {
    if (ownsLock) {
      await redisReleaseLock(lockKey, lockToken).catch(() => {})
    }
  }
}

/**
 * Proses payload webhook Evolution. Hanya event messages.upsert yang diproses.
 * Pesan dari chat yang sama diserialisasi dengan lock Redis agar state order tidak bentrok.
 */
export async function processEvolutionWebhookForUser(userId, payload) {
  const event = String(payload?.event || '').toLowerCase()
  if (event !== 'messages.upsert') {
    return { success: true, ignored: true, reason: `event ${payload?.event}` }
  }

  const ctx = await getWhatsAppClientForUser(userId)
  if (!ctx) {
    return {
      success: false,
      ignored: true,
      reason: 'Kredensial Evolution API belum dikonfigurasi.',
    }
  }
  const config = ctx.config

  if (
    payload?.instance &&
    config.instance &&
    String(payload.instance).trim() !== config.instance
  ) {
    return {
      success: false,
      ignored: true,
      reason: `Instance tidak cocok: payload="${payload.instance}" config="${config.instance}".`,
    }
  }

  const items = Array.isArray(payload?.data) ? payload.data : [payload?.data]
  const fallbackProcessed = new Set()

  for (const item of items) {
    if (!shouldProcessWhatsAppItem(item)) continue

    const chatId = await resolveIncomingChat(userId, item.key, ctx.client)
    if (!chatId) continue

    const messageId = String(item.key.id)
    const dedupKey = `whatsapp_msg:${userId}:${messageId}`
    const queueKey = `whatsapp_queue:${userId}:${chatId}`
    const lockKey = `whatsapp_lock:${userId}:${chatId}`

    let masukAntrean = false

    try {
      const fresh = await redisSetNx(
        dedupKey,
        '1',
        DEDUP_TTL_SECONDS,
      )
      if (!fresh) continue

      const queuedLength = await redisLpush(queueKey, item)
      masukAntrean = true
      await redisExpire(queueKey, QUEUE_TTL_SECONDS).catch(() => {})

      if (queuedLength > MAX_QUEUED_MESSAGES) {
        // Buang pesan tertua yang belum terjawab, antrean tidak boleh tumbuh
        // tanpa batas saat satu chat sedang tersumbat.
        await redisRpop(queueKey).catch(() => null)
        console.warn(
          `[WhatsApp] Antrean chat ${maskChatId(chatId)} penuh (${queuedLength}), pesan tertua dibuang`,
        )
      }

      const lockToken = randomUUID()
      const acquired = await redisSetNx(lockKey, lockToken, LOCK_TTL_SECONDS)
      if (!acquired) continue

      await drainQueue({ userId, chatId, queueKey, lockKey, lockToken })
    } catch (error) {
      console.error(
        `[WhatsApp] Redis bermasalah untuk user=${userId} chat=${maskChatId(chatId)}: ${error.message}`,
      )

      if (masukAntrean) {
        // Pesannya sudah tersimpan di antrean — diproses di sini juga akan
        // menghasilkan balasan ganda begitu drainer berikutnya jalan.
        console.warn(
          `[WhatsApp] Pesan chat ${maskChatId(chatId)} tetap di antrean, dikuras pada webhook berikutnya`,
        )
        continue
      }

      if (fallbackProcessed.has(messageId)) continue
      fallbackProcessed.add(messageId)

      await handleIncomingWhatsAppMessage({ userId, chatId, data: item }).catch(
        (err) => {
          console.error(
            `[WhatsApp] Fallback proses pesan gagal user=${userId} chat=${maskChatId(chatId)}: ${err.message}`,
          )
        },
      )
    }
  }

  return { success: true }
}

/**
 * User yang punya konfigurasi WhatsApp (kredensial per tenant atau fallback env).
 * Dipakai health monitor agar tenant tanpa bot Telegram tetap diperiksa.
 */
export async function getWhatsAppConfiguredUserIds() {
  const userIds = new Set()

  const rows = await prisma.botCredential.findMany({
    where: { key: { in: ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY'] } },
    select: { userId: true },
  })
  for (const row of rows) userIds.add(row.userId)

  const envUrl = String(process.env.EVOLUTION_API_URL || '').trim()
  const envKey = String(process.env.EVOLUTION_API_KEY || '').trim()
  if (envUrl && envKey) {
    const users = await getAllActiveUsers()
    for (const user of users) userIds.add(user.id)
  }

  return [...userIds]
}
