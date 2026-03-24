import prisma from '../../services/db.js'
import { reloadConfigForUser } from '../../services/configService.js'
import { ok, fail } from '../utils/response.js'

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
      botMode: req.body?.botMode || 'polling',
      aiEnabled: req.body?.aiEnabled ?? true,
      geminiModel: req.body?.geminiModel || 'gemini-2.0-flash',
      midtransIsProduction: req.body?.midtransIsProduction ?? false,
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

    await reloadConfigForUser(userId)
    return ok(res, created, 'Create bot config success', 201)
  } catch (error) {
    return next(error)
  }
}

export async function updateBotConfig(req, res, next) {
  try {
    const userId = req.auth.userId
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
      return fail(res, 'Invalid config id', 400)
    }

    const existing = await prisma.botConfig.findFirst({ where: { id, userId } })
    if (!existing) {
      return fail(res, 'Bot config tidak ditemukan', 404)
    }

    const patch = {
      ...(req.body?.botMode !== undefined && { botMode: req.body.botMode }),
      ...(req.body?.aiEnabled !== undefined && {
        aiEnabled: req.body.aiEnabled,
      }),
      ...(req.body?.geminiModel !== undefined && {
        geminiModel: req.body.geminiModel,
      }),
      ...(req.body?.midtransIsProduction !== undefined && {
        midtransIsProduction: req.body.midtransIsProduction,
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

    await reloadConfigForUser(userId)
    return ok(res, updated, 'Update bot config success')
  } catch (error) {
    return next(error)
  }
}

export async function deleteBotConfig(req, res, next) {
  try {
    const userId = req.auth.userId
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
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

    await reloadConfigForUser(userId)
    return ok(res, deleted, 'Delete bot config success')
  } catch (error) {
    return next(error)
  }
}
