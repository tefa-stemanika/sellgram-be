import prisma from '../../services/db.js'
import { encrypt } from '../../utils/encryption.js'
import {
  getTelegramTokenForUser,
  reloadConfigForUser,
} from '../../services/configService.js'
import { refreshTenantMap } from '../../services/tenantResolver.js'
import {
  isBotActive,
  restartBotForUser,
  spawnBotForUser,
  stopBotForUser,
} from '../../services/botManager.js'
import { initAdminBotForUser } from '../../services/adminBot.js'
import { ok, fail } from '../utils/response.js'

function maskCredential(value) {
  if (!value) return null
  return '***encrypted***'
}

function normalizeCredentialKey(key) {
  return String(key || '').trim().toUpperCase()
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
  } else {
    await spawnBotForUser(userId)
  }
}

async function refreshRuntimeIfNeeded(userId, key) {
  await reloadConfigForUser(userId)
  const normalizedKey = normalizeCredentialKey(key)

  if (normalizedKey === 'TELEGRAM_BOT_TOKEN') {
    await refreshTenantMap()
    await syncMainBotRuntime(userId)
  }

  if (normalizedKey === 'ADMIN_BOT_TOKEN' || normalizedKey === 'ADMIN_CHAT_ID') {
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

  if (normalizedKey === 'ADMIN_BOT_TOKEN' || normalizedKey === 'ADMIN_CHAT_ID') {
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

export async function createBotCredential(req, res, next) {
  try {
    const userId = req.auth.userId
    const key = normalizeCredentialKey(req.body?.key)
    const rawValue = String(req.body?.value || '')

    if (!key || !rawValue) {
      return fail(res, 'key dan value wajib diisi', 400)
    }

    const encryptedValue = encrypt(rawValue)

    const created = await prisma.botCredential.create({
      data: {
        userId,
        key,
        value: encryptedValue,
      },
    })

    await refreshRuntimeIfNeeded(userId, key)

    return ok(
      res,
      {
        id: created.id,
        userId: created.userId,
        key: created.key,
        value: maskCredential(created.value),
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      'Create bot credential success',
      201,
    )
  } catch (error) {
    if (error.code === 'P2002') {
      return fail(res, 'credential key sudah ada untuk user ini', 409)
    }
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

    await refreshRuntimeIfNeeded(userId, updated.key)

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
