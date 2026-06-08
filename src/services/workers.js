import { Worker } from 'bullmq'
import { getBotForUser, configureTelegramWebhookForUser, scheduleTelegramWebhookReconcileForUser } from './botManager.js'
import { notifyAdminOrderSuccessForUser, notifyAdminOrderFailedForUser } from './adminBot.js'
import { createTicketFromOrder } from './ticketService.js'
import prisma from './db.js'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = { url: REDIS_URL }

let notifWorker = null
let webhookWorker = null

export function startWorkers() {
  if (notifWorker || webhookWorker) {
    console.warn('[Workers] Already started')
    return
  }

  notifWorker = new Worker('telegram-notifications', async (job) => {
    const { data } = job

    const order = await prisma.order.findFirst({
      where: { orderId: data.orderId },
      include: { orderItems: { include: { product: true } } },
    })

    if (!order) {
      console.warn(`[Worker] Order ${data.orderId} not found, skipping`)
      return
    }

    const bot = getBotForUser(data.userId)

    if (job.name === 'payment-success') {
      if (bot && order.source !== 'WEBSITE') {
        const telegramId = Number(order.telegramId)
        const item = order.orderItems?.[0]
        const text = `✅ *Pembayaran Berhasil!*\n\n🔖 Order: \`${order.orderId}\`\n${item ? `${item.product.emoji} ${item.product.name} x${item.quantity}` : ''}\n💵 Total: Rp ${order.totalPrice.toLocaleString('id-ID')}\n\nTerima kasih! Pesananmu sedang kami proses. 🙏`

        try {
          await bot.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
        } catch (err) {
          console.error('[Worker] Gagal kirim notif user:', err.message)
        }
      }

      await createTicketFromOrder(order, data.userId).catch(err => {
        console.error('[Worker] Gagal buat ticket:', err.message)
      })

      await notifyAdminOrderSuccessForUser(data.userId, order, data.notification)
    } else if (job.name === 'payment-failed') {
      if (bot && order.source !== 'WEBSITE') {
        const telegramId = Number(order.telegramId)
        const text = `❌ *Pembayaran Gagal/Expired*\n\n🔖 Order: \`${order.orderId}\`\n\nPembayaran tidak berhasil atau sudah kadaluarsa.\nKetik /pesan untuk membuat order baru.`

        try {
          await bot.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
        } catch (err) {
          console.error('[Worker] Gagal kirim notif gagal user:', err.message)
        }
      }

      await notifyAdminOrderFailedForUser(data.userId, order)
    }
  }, { connection, concurrency: 5 })

  webhookWorker = new Worker('telegram-webhooks', async (job) => {
    const { userId, publicBaseUrl } = job.data
    const result = await configureTelegramWebhookForUser(userId, publicBaseUrl)

    if (!result.success) {
      console.warn(`[Worker] setWebhook failed user=${userId}: ${result.reason}`)
      if (result.transient) {
        throw new Error(result.reason)
      }
    }
  }, { connection })

  webhookWorker.on('failed', async (job, err) => {
    if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
      const { userId, publicBaseUrl } = job.data
      console.warn(`[Worker] setWebhook exhausted retries for user=${userId}, scheduling reconcile`)
      if (publicBaseUrl) {
        scheduleTelegramWebhookReconcileForUser(userId, publicBaseUrl)
      }
    }
  })

  notifWorker.on('completed', (job) => {
    console.log(`[Worker] Notif ${job.id} completed: ${job.name}`)
  })

  notifWorker.on('failed', (job, err) => {
    console.error(`[Worker] Notif ${job?.id} failed:`, err.message)
  })

  webhookWorker.on('completed', (job) => {
    console.log(`[Worker] Webhook ${job.id} completed`)
  })

  console.log('[Workers] Started')
}

export async function stopWorkers() {
  if (notifWorker) {
    await notifWorker.close()
    notifWorker = null
  }
  if (webhookWorker) {
    await webhookWorker.close()
    webhookWorker = null
  }
  console.log('[Workers] Stopped')
}
