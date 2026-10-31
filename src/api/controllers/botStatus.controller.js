import { getBotObservabilityStatusForUser, restartBotForUser, configureTelegramWebhookForUser } from '../../services/botManager.js'
import { getBotHealthForUser } from '../../services/botHealthService.js'
import {
  getWhatsAppStatusForUser,
  reconnectWhatsAppForUser,
  createWhatsAppInstanceForUser,
  connectWhatsAppForUser,
  restartWhatsAppForUser,
} from '../../services/whatsappManager.js'
import { reloadConfigForUser, getTelegramTokenForUser } from '../../services/configService.js'
import { refreshTenantMap } from '../../services/tenantResolver.js'
import { PLAN_LIMITS } from '../../services/planLimitService.js'
import { ok } from '../utils/response.js'
import prisma from '../../services/db.js'

export async function getMyBotStatus(req, res, next) {
  try {
    const userId = req.auth.userId
    const validateToken = String(req.query.validateToken || 'true') !== 'false'

    const status = await getBotObservabilityStatusForUser(userId, {
      validateToken,
    })

    return ok(
      res,
      {
        userId,
        running: status.running,
        tokenStatus: status.tokenStatus,
        lastSpawnAttemptAt: status.lastSpawnAttemptAt,
        lastSpawnAttemptSuccess: status.lastSpawnAttemptSuccess,
        reason: status.reason,
        updatedAt: status.updatedAt,
      },
      'Get bot status success',
    )
  } catch (error) {
    return next(error)
  }
}

export async function getMyBotHealth(req, res, next) {
  try {
    const userId = req.auth.userId
    const refresh = String(req.query.refresh || 'false') === 'true'
    const baseUrl =
      String(process.env.PUBLIC_BASE_URL || '').trim() || getPublicBaseUrl(req)

    const result = await getBotHealthForUser(userId, { refresh, baseUrl })

    return ok(res, result, 'Bot health retrieved')
  } catch (error) {
    return next(error)
  }
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

export async function reconnectBot(req, res, next) {
  try {
    const userId = req.auth.userId

    const token = await getTelegramTokenForUser(userId)
    if (!token) {
      return res.status(400).json({ success: false, message: 'TELEGRAM_BOT_TOKEN belum diisi.' })
    }

    await reloadConfigForUser(userId)
    await refreshTenantMap()
    await restartBotForUser(userId)

    const publicBaseUrl =
      String(process.env.PUBLIC_BASE_URL || '').trim() || getPublicBaseUrl(req)
    if (!publicBaseUrl) {
      return res.status(400).json({ success: false, message: 'PUBLIC_BASE_URL tidak dapat ditentukan.' })
    }

    const result = await configureTelegramWebhookForUser(userId, publicBaseUrl)

    if (!result.success) {
      return res.status(400).json({ success: false, message: result.reason || 'Gagal konfigurasi webhook.' })
    }

    return ok(res, { userId, webhookUrl: `${publicBaseUrl}/api/webhook/telegram/${userId}` }, 'Bot berhasil direconnect')
  } catch (error) {
    return next(error)
  }
}

export async function getMyWhatsAppStatus(req, res, next) {
  try {
    const userId = req.auth.userId
    const status = await getWhatsAppStatusForUser(userId, {
      publicBaseUrl: resolvePublicBaseUrl(req),
    })
    return ok(res, { userId, ...status }, 'Get WhatsApp status success')
  } catch (error) {
    return next(error)
  }
}

export async function reconnectWhatsApp(req, res, next) {
  try {
    const userId = req.auth.userId
    const publicBaseUrl =
      String(process.env.PUBLIC_BASE_URL || '').trim() || getPublicBaseUrl(req)

    if (!publicBaseUrl) {
      return res
        .status(400)
        .json({ success: false, message: 'PUBLIC_BASE_URL tidak dapat ditentukan.' })
    }

    const result = await reconnectWhatsAppForUser(userId, publicBaseUrl)

    if (!result.success) {
      return res.status(whatsAppErrorStatus(result)).json({
        success: false,
        code: result.code || null,
        message: result.reason || 'Gagal konfigurasi WhatsApp.',
      })
    }

    return ok(res, { userId, ...result }, 'WhatsApp berhasil direconnect')
  } catch (error) {
    return next(error)
  }
}

function whatsAppErrorStatus(result) {
  switch (result?.code) {
    case 'instance_missing':
      return 404
    case 'instance_limit_reached':
      return 409
    case 'webhook_secret_missing':
      return 500
    case 'server_unreachable':
    case 'create_failed':
    case 'connect_failed':
      return result.transient ? 503 : 502
    default:
      return 400
  }
}

function resolvePublicBaseUrl(req) {
  return String(process.env.PUBLIC_BASE_URL || '').trim() || getPublicBaseUrl(req)
}

export async function createMyWhatsAppInstance(req, res, next) {
  try {
    const userId = req.auth.userId
    const publicBaseUrl = resolvePublicBaseUrl(req)

    const result = await createWhatsAppInstanceForUser(userId, {
      publicBaseUrl,
      number: req.body?.number,
    })

    if (!result.success) {
      return res.status(whatsAppErrorStatus(result)).json({
        success: false,
        code: result.code || null,
        message: result.reason || 'Gagal membuat instance WhatsApp.',
        instance: result.instance || null,
      })
    }

    return ok(
      res,
      { userId, ...result },
      result.created
        ? 'Instance WhatsApp berhasil dibuat'
        : 'Instance WhatsApp sudah tersedia',
      result.created ? 201 : 200,
    )
  } catch (error) {
    return next(error)
  }
}

export async function connectMyWhatsApp(req, res, next) {
  try {
    const userId = req.auth.userId
    const number = req.query?.number ?? req.body?.number

    const result = await connectWhatsAppForUser(userId, {
      number,
      publicBaseUrl: resolvePublicBaseUrl(req),
    })

    if (!result.success) {
      return res.status(whatsAppErrorStatus(result)).json({
        success: false,
        code: result.code || null,
        message: result.reason || 'Gagal mengambil QR WhatsApp.',
        instance: result.instance || null,
      })
    }

    return ok(
      res,
      { userId, ...result },
      result.connected
        ? 'WhatsApp sudah terhubung'
        : 'QR WhatsApp berhasil dibuat, silakan scan',
    )
  } catch (error) {
    return next(error)
  }
}

export async function restartWhatsApp(req, res, next) {
  try {
    const userId = req.auth.userId
    const publicBaseUrl = resolvePublicBaseUrl(req)

    if (!publicBaseUrl) {
      return res
        .status(400)
        .json({ success: false, message: 'PUBLIC_BASE_URL tidak dapat ditentukan.' })
    }

    const result = await restartWhatsAppForUser(userId, publicBaseUrl)

    if (!result.success) {
      return res.status(whatsAppErrorStatus(result)).json({
        success: false,
        code: result.code || null,
        message: result.reason || 'Gagal restart WhatsApp.',
        instance: result.instance || null,
      })
    }

    return ok(res, { userId, ...result }, 'WhatsApp berhasil direstart')
  } catch (error) {
    return next(error)
  }
}

export async function getUserQuota(req, res, next) {
  try {
    const userId = req.auth.userId

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, plan: true } })
    if (!user) return res.status(404).json({ success: false, message: 'User not found' })

    const limits = PLAN_LIMITS[user.plan]

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [productCount, templateCount, broadcastCount, orderCount] = await Promise.all([
      prisma.product.count({ where: { userId, deletedAt: null } }),
      prisma.campaignTemplate.count({ where: { userId } }),
      prisma.broadcast.count({ where: { userId, status: 'SENT', createdAt: { gte: startOfMonth } } }),
      prisma.order.count({ where: { userId, status: 'COMPLETED', paidAt: { gte: startOfMonth } } }),
    ])

    return ok(res, {
      plan: user.plan,
      products: {
        used: productCount,
        total: limits.products === Infinity ? 'Unlimited' : limits.products,
      },
      templates: {
        used: templateCount,
        total: limits.templates === Infinity ? 'Unlimited' : limits.templates,
      },
      broadcastsPerMonth: {
        used: broadcastCount,
        total: limits.maxBroadcastsPerMonth === Infinity ? 'Unlimited' : limits.maxBroadcastsPerMonth,
      },
      ordersPerMonth: {
        used: orderCount,
        total: limits.maxOrdersPerMonth === Infinity ? 'Unlimited' : limits.maxOrdersPerMonth,
      },
    }, 'User quota retrieved')
  } catch (error) {
    return next(error)
  }
}
