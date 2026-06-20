import { Worker } from 'bullmq'
import { getBotForUser, configureTelegramWebhookForUser, scheduleTelegramWebhookReconcileForUser } from './botManager.js'
import { notifyAdminOrderSuccessForUser, notifyAdminOrderFailedForUser } from './adminBot.js'
import { createTicketFromOrder } from './ticketService.js'
import { upsertCustomerFromOrder } from './customerService.js'
import { deductStock, refundStock } from './stockService.js'
import { createTicketFulfillmentLog } from './fulfillmentService.js'
import { enqueueFulfillment } from './fulfillment/fulfillmentEngine.js'
import { createFulfillmentWorker } from '../workers/fulfillmentWorker.js'
import { incrementMonthlyOrderCount } from './planLimitService.js'
import prisma from './db.js'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = { url: REDIS_URL }

let notifWorker = null
let webhookWorker = null
let fulfillmentWorker = null

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

      const ticket = await createTicketFromOrder(order, data.userId).catch(err => {
        console.error('[Worker] Gagal buat ticket:', err.message)
        return null
      })

      await upsertCustomerFromOrder(order, data.userId).catch(err => {
        console.error('[Worker] Gagal upsert customer:', err.message)
      })

      await deductStock(order.id, data.userId).catch(err => {
        console.error('[Worker] Gagal deduct stock:', err.message)
      })

      await incrementMonthlyOrderCount(data.userId).catch(err => {
        console.error('[Worker] Gagal increment order counter:', err.message)
      })

      await enqueueFulfillment(order.id, data.userId).catch(err => {
        console.error('[Worker] Gagal enqueue fulfillment:', err.message)
      })

      await notifyAdminOrderSuccessForUser(data.userId, order, data.notification)

      if (ticket) {
        await createTicketFulfillmentLog({
          userId: data.userId,
          ticketId: ticket.id,
          operation: 'PAYMENT_COMPLETED',
          description: `Pembayaran berhasil untuk order ${order.orderId}`,
          metadata: { orderId: order.orderId, totalPrice: order.totalPrice, source: order.source },
        }).catch(err => console.error('[Worker] Gagal log fulfillment:', err.message))
      }
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

      await refundStock(order.id, data.userId).catch(err => {
        console.error('[Worker] Gagal refund stock:', err.message)
      })

      await notifyAdminOrderFailedForUser(data.userId, order)

      const failedTicket = await prisma.ticket.findFirst({ where: { orderId: order.id } })
      if (failedTicket) {
        await createTicketFulfillmentLog({
          userId: data.userId,
          ticketId: failedTicket.id,
          operation: 'PAYMENT_FAILED',
          description: `Pembayaran gagal/expired untuk order ${order.orderId}`,
          metadata: { orderId: order.orderId },
        }).catch(err => console.error('[Worker] Gagal log fulfillment:', err.message))
      }
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

  fulfillmentWorker = createFulfillmentWorker(connection)

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
  if (fulfillmentWorker) {
    await fulfillmentWorker.close()
    fulfillmentWorker = null
  }
  console.log('[Workers] Stopped')
}
