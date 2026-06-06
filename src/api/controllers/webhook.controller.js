import prisma from '../../services/db.js'
import {
  verifyWebhookSignature,
  isPaymentSuccess,
  isPaymentFailed,
} from '../../services/midtrans.js'
import {
  notifyAdminOrderSuccessForUser,
  notifyAdminOrderFailedForUser,
} from '../../services/adminBot.js'
import {
  getBotForUser,
  processTelegramWebhookUpdateForUser,
  verifyTelegramWebhookSecretForUser,
} from '../../services/botManager.js'

export async function handleMidtransWebhook(req, res, next) {
  try {
    const notification = req.body || {}

    console.log(
      '[Webhook] Notifikasi Midtrans:',
      notification.order_id,
      notification.transaction_status,
    )

    const orderId = notification.order_id

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

      const userBot = getBotForUser(userId)
      if (userBot) {
        await sendPaymentSuccessNotification(userBot, order)
      }

      await notifyAdminOrderSuccessForUser(userId, order, notification)
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

      const userBot = getBotForUser(userId)
      if (userBot) {
        await sendPaymentFailedNotification(userBot, order)
      }

      await notifyAdminOrderFailedForUser(userId, order)
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

async function sendPaymentSuccessNotification(bot, order) {
  const telegramId = Number(order.telegramId)
  const item = order.orderItems?.[0]

  const text = `✅ *Pembayaran Berhasil!*

🔖 Order: \`${order.orderId}\`
${item ? `${item.product.emoji} ${item.product.name} x${item.quantity}` : ''}
💵 Total: Rp ${order.totalPrice.toLocaleString('id-ID')}

Terima kasih! Pesananmu sedang kami proses. 🙏`

  try {
    await bot.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[Webhook] Gagal kirim notif user:', err.message)
  }
}

async function sendPaymentFailedNotification(bot, order) {
  const telegramId = Number(order.telegramId)

  const text = `❌ *Pembayaran Gagal/Expired*

🔖 Order: \`${order.orderId}\`

Pembayaran tidak berhasil atau sudah kadaluarsa.
Ketik /pesan untuk membuat order baru.`

  try {
    await bot.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[Webhook] Gagal kirim notif gagal user:', err.message)
  }
}
