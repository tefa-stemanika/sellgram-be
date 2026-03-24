import prisma from '../../services/db.js'
import { encrypt } from '../../utils/encryption.js'
import { reloadConfigForUser } from '../../services/configService.js'
import { refreshTenantMap } from '../../services/tenantResolver.js'
import { ok, fail } from '../utils/response.js'

function maskCredential(value) {
  if (!value) return null
  return '***encrypted***'
}

async function refreshRuntimeIfNeeded(userId, key) {
  await reloadConfigForUser(userId)
  if (key === 'TELEGRAM_BOT_TOKEN') {
    await refreshTenantMap()
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
    const key = String(req.body?.key || '').trim()
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
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
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
      patch.key = String(req.body.key).trim()
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
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
      return fail(res, 'Invalid credential id', 400)
    }

    const existing = await prisma.botCredential.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      return fail(res, 'Bot credential tidak ditemukan', 404)
    }

    await prisma.botCredential.delete({ where: { id } })
    await refreshRuntimeIfNeeded(userId, existing.key)

    return ok(res, null, 'Delete bot credential success')
  } catch (error) {
    return next(error)
  }
}
