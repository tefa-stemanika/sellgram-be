// src/webhook.js

import http from 'http'
import prisma from './services/db.js'
import {
  verifyWebhookSignature,
  isPaymentSuccess,
  isPaymentFailed,
} from './services/midtrans.js'
import {
  notifyAdminOrderSuccess,
  notifyAdminOrderFailed,
} from './services/adminBot.js'

let botInstance = null

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

          const order = await prisma.order.findUnique({
            where: { orderId },
            include: { orderItems: { include: { product: true } } },
          })

          if (!order) {
            console.warn('[Webhook] Order tidak ditemukan:', orderId)
            res.writeHead(404)
            res.end('Order not found')
            return
          }

          if (isPaymentSuccess(notification)) {
            await prisma.order.update({
              where: { orderId },
              data: { status: 'COMPLETED', paidAt: new Date() },
            })

            console.log('[Webhook] Pembayaran berhasil:', orderId)

            // Notifikasi ke user pembeli
            if (botInstance) await sendPaymentSuccessNotification(order)

            // Notifikasi ke admin (bot terpisah)
            await notifyAdminOrderSuccess(order, notification)
          } else if (isPaymentFailed(notification)) {
            await prisma.order.update({
              where: { orderId },
              data: { status: 'PAYMENT_FAILED' },
            })

            console.log('[Webhook] Pembayaran gagal/expired:', orderId)

            if (botInstance) await sendPaymentFailedNotification(order)
            await notifyAdminOrderFailed(order)
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

async function sendPaymentSuccessNotification(order) {
  const telegramId = Number(order.telegramId)
  const item = order.orderItems[0]

  const text = `✅ *Pembayaran Berhasil!*

🔖 Order: \`${order.orderId}\`
${item ? `${item.product.emoji} ${item.product.name} x${item.quantity}` : ''}
💵 Total: Rp ${order.totalPrice.toLocaleString('id-ID')}

Terima kasih! Pesananmu sedang kami proses. 🙏`

  try {
    await botInstance.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[Webhook] Gagal kirim notif user:', err.message)
  }
}

async function sendPaymentFailedNotification(order) {
  const telegramId = Number(order.telegramId)

  const text = `❌ *Pembayaran Gagal/Expired*

🔖 Order: \`${order.orderId}\`

Pembayaran tidak berhasil atau sudah kadaluarsa.
Ketik /pesan untuk membuat order baru.`

  try {
    await botInstance.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[Webhook] Gagal kirim notif gagal user:', err.message)
  }
}
