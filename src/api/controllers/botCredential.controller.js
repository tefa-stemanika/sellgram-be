import prisma from '../../services/db.js'
import { encrypt, decrypt } from '../../utils/encryption.js'
import {
  getTelegramTokenForUser,
  reloadConfigForUser,
} from '../../services/configService.js'
import { refreshTenantMap } from '../../services/tenantResolver.js'
import {
  configureTelegramWebhookForUser,
  isBotActive,
  restartBotForUser,
  scheduleTelegramWebhookReconcileForUser,
  spawnBotForUser,
  stopBotForUser,
} from '../../services/botManager.js'
import { initAdminBotForUser } from '../../services/adminBot.js'
import { ok, fail } from '../utils/response.js'

function maskCredential(encryptedValue) {
  if (!encryptedValue) return null
  try {
    const plain = decrypt(encryptedValue)
    if (!plain) return null
  } catch {}
  return '***encrypted***'
}

function normalizeCredentialKey(key) {
  return String(key || '')
    .trim()
    .toUpperCase()
}

function getPublicBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
  const forwardedHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim()

  const proto = forwardedProto || req.protocol || 'https'
  const host = forwardedHost || req.headers.host
  if (!host) return null

  return `${proto}://${host}`
}

async function syncMainBotRuntime(userId) {
  const token = getTelegramTokenForUser(userId)

  // Jika token belum ada/hilang, bot tidak bisa aktif.
  if (!token) {
    if (isBotActive(userId)) {
      await stopBotForUser(userId)
    }
    return
  }

  if (isBotActive(userId)) {
    await restartBotForUser(userId)
    return
  }

  await spawnBotForUser(userId)
}

async function refreshRuntimeIfNeeded(userId, key, req) {
  await reloadConfigForUser(userId)
  const normalizedKey = normalizeCredentialKey(key)

  if (normalizedKey === 'TELEGRAM_BOT_TOKEN') {
    await refreshTenantMap()
    await syncMainBotRuntime(userId)

    const publicBaseUrl =
      String(process.env.PUBLIC_BASE_URL || '').trim() || getPublicBaseUrl(req)
    console.log(`[BotCredential] publicBaseUrl: "${publicBaseUrl}"`)
    const webhookSync = await configureTelegramWebhookForUser(
      userId,
      publicBaseUrl,
    )
    if (!webhookSync.success) {
      console.warn(
        `[BotCredential] Gagal sinkronisasi webhook user ${userId}: ${webhookSync.reason}`,
      )

      if (webhookSync.transient) {
        console.warn(
          `[BotCredential] Menjadwalkan background webhook reconcile untuk user ${userId} karena error transient.`,
        )
        scheduleTelegramWebhookReconcileForUser(userId, publicBaseUrl)
      }
    }
  }

  if (
    normalizedKey === 'ADMIN_BOT_TOKEN' ||
    normalizedKey === 'ADMIN_CHAT_ID'
  ) {
    initAdminBotForUser(userId)
  }

  // Tetap sinkronkan bot utama pada perubahan credential apa pun.
  // Ini membuat flow register -> set config -> set credentials tetap jalan
  // meskipun urutan key dari frontend berubah.
  if (normalizedKey !== 'TELEGRAM_BOT_TOKEN') {
    await syncMainBotRuntime(userId)
  }
}

async function handleCredentialDeleteRuntime(userId, key) {
  await reloadConfigForUser(userId)
  const normalizedKey = normalizeCredentialKey(key)

  if (normalizedKey === 'TELEGRAM_BOT_TOKEN') {
    await stopBotForUser(userId)
    await refreshTenantMap()
    return
  }

  await syncMainBotRuntime(userId)

  if (
    normalizedKey === 'ADMIN_BOT_TOKEN' ||
    normalizedKey === 'ADMIN_CHAT_ID'
  ) {
    initAdminBotForUser(userId)
  }
}

export async function getBotCredentials(req, res, next) {
  try {
    const rows = await prisma.botCredential.findMany({
      where: { userId: req.auth.userId },
      orderBy: { key: 'asc' },
    })

    const data = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      key: row.key,
      value: maskCredential(row.value),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))

    return ok(res, data, 'Get bot credentials success')
  } catch (error) {
    return next(error)
  }
}

export async function updateBotCredential(req, res, next) {
  try {
    const userId = req.auth.userId
    const id = String(req.params.id || '').trim()
    if (!id) {
      return fail(res, 'Invalid credential id', 400)
    }

    const existing = await prisma.botCredential.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return fail(res, 'Bot credential tidak ditemukan', 404)
    }

    const patch = {}
    if (req.body?.key !== undefined) {
      patch.key = normalizeCredentialKey(req.body.key)
    }
    if (req.body?.value !== undefined) {
      patch.value = encrypt(String(req.body.value))
    }

    const updated = await prisma.botCredential.update({
      where: { id },
      data: patch,
    })

    await refreshRuntimeIfNeeded(userId, updated.key, req)

    return ok(
      res,
      {
        id: updated.id,
        userId: updated.userId,
        key: updated.key,
        value: maskCredential(updated.value),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
      'Update bot credential success',
    )
  } catch (error) {
    if (error.code === 'P2002') {
      return fail(res, 'credential key sudah ada untuk user ini', 409)
    }
    return next(error)
  }
}

export async function deleteBotCredential(req, res, next) {
  try {
    const userId = req.auth.userId
    const id = String(req.params.id || '').trim()
    if (!id) {
      return fail(res, 'Invalid credential id', 400)
    }

    const existing = await prisma.botCredential.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return fail(res, 'Bot credential tidak ditemukan', 404)
    }

    await prisma.botCredential.delete({ where: { id } })
    await handleCredentialDeleteRuntime(userId, existing.key)

    return ok(res, null, 'Delete bot credential success')
  } catch (error) {
    return next(error)
  }
}
