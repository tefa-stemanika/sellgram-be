// src/webhook.js
// Multi-tenant webhook server for Midtrans payment notifications

import http from 'http'
import prisma from './services/db.js'
import {
  verifyWebhookSignature,
  isPaymentSuccess,
  isPaymentFailed,
} from './services/midtrans.js'
import {
  notifyAdminOrderSuccessForUser,
  notifyAdminOrderFailedForUser,
} from './services/adminBot.js'
import { getBotForUser } from './services/botManager.js'

let botInstance = null // legacy backwards-compat

export function setBotInstance(bot) {
  botInstance = bot
}

export function startWebhookServer(port = 3000) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
      )
      return
    }

    if (req.method === 'POST' && req.url === '/webhook/midtrans') {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', async () => {
        try {
          const notification = JSON.parse(body)
          console.log(
            '[Webhook] Notifikasi Midtrans:',
            notification.order_id,
            notification.transaction_status,
          )

          if (!verifyWebhookSignature(notification)) {
            console.warn('[Webhook] Signature tidak valid!')
            res.writeHead(403)
            res.end('Forbidden')
            return
          }

          const orderId = notification.order_id

          // ── Query order by orderId using findFirst (not unique alone) ──────────────
          const order = await prisma.order.findFirst({
            where: { orderId },
            include: { orderItems: { include: { product: true } } },
          })

          if (!order) {
            console.warn('[Webhook] Order tidak ditemukan:', orderId)
            res.writeHead(404)
            res.end('Order not found')
            return
          }

          // ── Find tenant user dari order ────────────────────────────────────────
          const userId = order.userId
          if (!userId) {
            console.error('[Webhook] Order tidak memiliki userId:', orderId)
            res.writeHead(400)
            res.end('Invalid order: missing userId')
            return
          }

          if (isPaymentSuccess(notification)) {
            await prisma.order.update({
              where: { id: order.id },
              data: { status: 'COMPLETED', paidAt: new Date() },
            })

            console.log(
              '[Webhook] Pembayaran berhasil:',
              orderId,
              `(user ${userId})`,
            )

            // ── Get user's bot instance untuk notification ke pembeli ─────────────
            const userBot = getBotForUser(userId)
            if (userBot) {
              await sendPaymentSuccessNotification(userBot, order)
            } else if (botInstance) {
              // fallback ke global bot jika user bot tidak ditemukan
              await sendPaymentSuccessNotification(botInstance, order)
            }

            // ── Notifikasi ke admin user tersebut ──────────────────────────────────
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

            // ── Get user's bot instance untuk notification ke pembeli ─────────────
            const userBot = getBotForUser(userId)
            if (userBot) {
              await sendPaymentFailedNotification(userBot, order)
            } else if (botInstance) {
              // fallback ke global bot
              await sendPaymentFailedNotification(botInstance, order)
            }

            // ── Notifikasi ke admin user tersebut ──────────────────────────────────
            await notifyAdminOrderFailedForUser(userId, order)
          }

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok' }))
        } catch (error) {
          console.error('[Webhook] Error:', error.message)
          res.writeHead(500)
          res.end('Internal Server Error')
        }
      })
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  })

  server.listen(port, () => {
    console.log(`🌐 Webhook server berjalan di http://localhost:${port}`)
    console.log(
      `   Endpoint Midtrans: http://localhost:${port}/webhook/midtrans`,
    )
  })

  return server
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
