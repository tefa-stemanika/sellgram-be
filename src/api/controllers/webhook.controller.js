import prisma from '../../services/db.js'
import {
  verifyWebhookSignature,
  isPaymentSuccess,
  isPaymentFailed,
} from '../../services/midtrans.js'
import { notifQueue } from '../../services/queue.js'
import {
  processTelegramWebhookUpdateForUser,
  verifyTelegramWebhookSecretForUser,
} from '../../services/botManager.js'
import { verifyEvolutionWebhookSecret } from '../../services/evolution.js'
import { processEvolutionWebhookForUser } from '../../services/whatsappManager.js'
import { activateSubscription } from '../../services/subscriptionService.js'

export async function handleMidtransWebhook(req, res, next) {
  try {
    const notification = req.body || {}

    console.log(
      '[Webhook] Notifikasi Midtrans:',
      notification.order_id,
      notification.transaction_status,
    )

    const orderId = notification.order_id

    // Cek apakah ini payment untuk subscription (prefix SUB-) atau order biasa
    if (orderId.startsWith('SUB-')) {
      const paymentType = notification.payment_type || notification.va_numbers?.[0]?.bank || 'unknown'
      if (isPaymentSuccess(notification)) {
        await activateSubscription(orderId, paymentType)
      }
      // Tidak perlu handle failed — invoice otomatis expired setelah 24 jam via cron
      return res.status(200).json({ status: 'ok' })
    }

    const order = await prisma.order.findFirst({
      where: { orderId },
      include: { orderItems: { include: { product: true } } },
    })

    if (!order) {
      console.warn('[Webhook] Order tidak ditemukan:', orderId)
      return res
        .status(404)
        .json({ success: false, message: 'Order not found' })
    }

    if (order.status === 'COMPLETED') {
      console.log('[Webhook] Order sudah COMPLETED, skip duplikat:', orderId)
      return res.status(200).json({ status: 'ok', skipped: true })
    }

    const userId = order.userId
    if (!userId) {
      console.error('[Webhook] Order tidak memiliki userId:', orderId)
      return res
        .status(400)
        .json({ success: false, message: 'Invalid order: missing userId' })
    }

    if (!(await verifyWebhookSignature(userId, notification))) {
      console.warn('[Webhook] Signature tidak valid!', `(user ${userId})`)
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    if (isPaymentSuccess(notification)) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', paidAt: new Date() },
      })

      console.log('[Webhook] Pembayaran berhasil:', orderId, `(user ${userId})`)

      await notifQueue.add('payment-success', {
        userId,
        orderId: order.orderId,
        notification,
      })
    } else if (isPaymentFailed(notification)) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'PAYMENT_FAILED' },
      })

      console.log(
        '[Webhook] Pembayaran gagal/expired:',
        orderId,
        `(user ${userId})`,
      )

      await notifQueue.add('payment-failed', {
        userId,
        orderId: order.orderId,
      })
    }

    return res.status(200).json({ status: 'ok' })
  } catch (error) {
    console.error('[Webhook] Error:', error.message)
    return next(error)
  }
}

export async function handleTelegramWebhook(req, res, next) {
  try {
    console.log("[Webhook] Update Telegram diterima", { body: JSON.stringify(req.body, null, 2) })
    const userId = String(req.params.userId || '').trim()
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Invalid userId' })
    }

    const secretToken = req.headers['x-telegram-bot-api-secret-token']

    const isSecretValid = await verifyTelegramWebhookSecretForUser(
      userId,
      secretToken,
    )

    if (!isSecretValid) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    const result = await processTelegramWebhookUpdateForUser(userId, req.body)
    if (!result.success) {
      return res
        .status(503)
        .json({ success: false, message: result.reason || 'Bot not ready' })
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    return next(error)
  }
}

export async function handleWhatsAppWebhook(req, res, next) {
  try {
    console.log("[Webhook] Update WhatsApp diterima", { body: JSON.stringify(req.body, null, 2) })
    const userId = String(req.params.userId || '').trim()
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Invalid userId' })
    }

    const secret = req.headers['x-evolution-webhook-secret']
    if (!verifyEvolutionWebhookSecret(userId, secret)) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid payload' })
    }

    console.log(
      `[Webhook] Evolution event=${req.body.event} instance=${req.body.instance} user=${userId}`,
    )

    // ACK cepat agar Evolution tidak retry; pemrosesan dilakukan async.
    res.status(200).json({ ok: true })

    processEvolutionWebhookForUser(userId, req.body).catch((error) => {
      console.error(
        `[Webhook] Gagal proses WhatsApp user=${userId}: ${error.message}`,
      )
    })

    return
  } catch (error) {
    return next(error)
  }
}

