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
import { getBotForUser } from '../../services/botManager.js'
import { getBotInstance } from '../../runtime/botRuntime.js'

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
      return res.status(404).json({ success: false, message: 'Order not found' })
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
      } else {
        const botInstance = getBotInstance()
        if (botInstance) {
          await sendPaymentSuccessNotification(botInstance, order)
        }
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
      } else {
        const botInstance = getBotInstance()
        if (botInstance) {
          await sendPaymentFailedNotification(botInstance, order)
        }
      }

      await notifyAdminOrderFailedForUser(userId, order)
    }

    return res.status(200).json({ status: 'ok' })
  } catch (error) {
    console.error('[Webhook] Error:', error.message)
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
