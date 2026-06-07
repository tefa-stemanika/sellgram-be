import prisma from '../../services/db.js'
import { reloadConfigForUser } from '../../services/configService.js'
import {
  isBotActive,
  restartBotForUser,
  stopBotForUser,
} from '../../services/botManager.js'
import { ok, fail } from '../utils/response.js'

async function syncBotAfterConfigChange(userId) {
  const config = await reloadConfigForUser(userId)

  if (!config || !config.isActive) {
    if (isBotActive(userId)) {
      await stopBotForUser(userId)
    }
    return
  }

  if (isBotActive(userId)) {
    await restartBotForUser(userId)
  }
}

export async function getBotConfig(req, res, next) {
  try {
    const config = await prisma.botConfig.findFirst({
      where: { userId: req.auth.userId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    })

    return ok(res, config, 'Get bot config success')
  } catch (error) {
    return next(error)
  }
}

export async function createBotConfig(req, res, next) {
  try {
    const userId = req.auth.userId
    const data = {
      midtransIsProduction: req.body?.midtransIsProduction ?? false,
      mode: (req.body?.mode && ['AI', 'BUTTON'].includes(req.body.mode))
        ? req.body.mode
        : 'BUTTON',
      isActive: true,
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.botConfig.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      })

      return tx.botConfig.create({
        data: { userId, ...data },
      })
    })

    await syncBotAfterConfigChange(userId)
    return ok(res, created, 'Create bot config success', 201)
  } catch (error) {
    return next(error)
  }
}

export async function updateBotConfig(req, res, next) {
  try {
    const userId = req.auth.userId
    const id = String(req.params.id || '').trim()
    if (!id) {
      return fail(res, 'Invalid config id', 400)
    }

    const existing = await prisma.botConfig.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail(res, 'Bot config tidak ditemukan', 404)
    }

    const patch = {
      ...(req.body?.midtransIsProduction !== undefined && {
        midtransIsProduction: req.body.midtransIsProduction,
      }),
      ...(req.body?.mode && ['AI', 'BUTTON'].includes(req.body.mode) && {
        mode: req.body.mode,
      }),
      ...(req.body?.isActive !== undefined && { isActive: req.body.isActive }),
    }

    let updated
    if (patch.isActive === true) {
      updated = await prisma.$transaction(async (tx) => {
        await tx.botConfig.updateMany({
          where: { userId, isActive: true, id: { not: id } },
          data: { isActive: false },
        })

        return tx.botConfig.update({
          where: { id },
          data: patch,
        })
      })
    } else {
      updated = await prisma.botConfig.update({
        where: { id },
        data: patch,
      })
    }

    await syncBotAfterConfigChange(userId)
    return ok(res, updated, 'Update bot config success')
  } catch (error) {
    return next(error)
  }
}

export async function deleteBotConfig(req, res, next) {
  try {
    const userId = req.auth.userId
    const id = String(req.params.id || '').trim()
    if (!id) {
      return fail(res, 'Invalid config id', 400)
    }

    const existing = await prisma.botConfig.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail(res, 'Bot config tidak ditemukan', 404)
    }

    const deleted = await prisma.botConfig.update({
      where: { id },
      data: { isActive: false },
    })

    await syncBotAfterConfigChange(userId)
    return ok(res, deleted, 'Delete bot config success')
  } catch (error) {
    return next(error)
  }
}
