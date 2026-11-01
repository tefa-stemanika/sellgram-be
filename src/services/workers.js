import { Worker } from 'bullmq'
import { getBotForUser, configureTelegramWebhookForUser, scheduleTelegramWebhookReconcileForUser } from './botManager.js'
import { notifyAdminOrderSuccessForUser, notifyAdminOrderFailedForUser } from './adminBot.js'
import { createTicketFromOrder } from './ticketService.js'
import { upsertCustomerFromOrder } from './customerService.js'
import { safeEmoji, safePlainText } from './safeText.js'
import { deductStock, refundStock } from './stockService.js'
import { createTicketFulfillmentLog } from './fulfillmentService.js'
import { enqueueFulfillment } from './fulfillment/fulfillmentEngine.js'
import { createFulfillmentWorker } from '../workers/fulfillmentWorker.js'
import { incrementMonthlyOrderCount } from './planLimitService.js'
import { sendWhatsAppTextForUser } from './whatsappManager.js'
import prisma from './db.js'

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const connection = { url: REDIS_URL }

let notifWorker = null
let webhookWorker = null
let fulfillmentWorker = null

function resolveWhatsAppTarget(order) {
  if (order.whatsappId) return order.whatsappId
  const phone = String(order.customerPhone || '').replace(/\D/g, '')
  return phone || null
}

export function startWorkers() {
  if (notifWorker || webhookWorker) {
    console.warn('[Workers] Already started')
    return
  }

  notifWorker = new Worker('telegram-notifications', async (job) => {
    const { data } = job

    const order = await prisma.order.findFirst({
      where: { orderId: data.orderId, userId: data.userId },
      include: {
        orderItems: { include: { product: true } },
        customer: { select: { name: true, phone: true, email: true } },
      },
    })

    if (!order) {
      console.warn(`[Worker] Order ${data.orderId} not found, skipping`)
      return
    }

    const bot = getBotForUser(data.userId)

    if (job.name === 'payment-success') {
      const item = order.orderItems?.[0]
      const itemLabel = item
        ? `${safeEmoji(item.product.emoji)} ${safePlainText(item.product.name)} x${item.quantity}`
        : ''

      if (order.source === 'WHATSAPP') {
        const whatsappTarget = resolveWhatsAppTarget(order)
        if (whatsappTarget) {
          const text = `✅ *Pembayaran Berhasil!*\n\n🔖 Order: ${order.orderId}\n${itemLabel}\n💵 Total: Rp ${order.totalPrice.toLocaleString('id-ID')}\n\nTerima kasih! Pesananmu sedang kami proses. 🙏`

          try {
            await sendWhatsAppTextForUser(data.userId, whatsappTarget, text)
          } catch (err) {
            console.error('[Worker] Gagal kirim notif WhatsApp user:', err.message)
          }
        } else {
          console.warn(
            `[Worker] Order WhatsApp ${order.orderId} tidak punya whatsappId/customerPhone, notifikasi pembeli dilewati`,
          )
        }
      } else if (bot && order.source !== 'WEBSITE') {
        const telegramId = order.telegramId ? Number(order.telegramId) : null
        if (!telegramId) {
          console.warn(
            `[Worker] Order ${order.orderId} tanpa telegramId, notifikasi pembeli dilewati`,
          )
        } else {
          const text = `✅ *Pembayaran Berhasil!*\n\n🔖 Order: \`${order.orderId}\`\n${itemLabel}\n💵 Total: Rp ${order.totalPrice.toLocaleString('id-ID')}\n\nTerima kasih! Pesananmu sedang kami proses. 🙏`

          try {
            await bot.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
          } catch (err) {
            console.error('[Worker] Gagal kirim notif user:', err.message)
          }
        }
      }

      const ticket = await createTicketFromOrder(order, data.userId).catch(err => {
        console.error('[Worker] Gagal buat ticket:', err.message)
        return null
      })

      // Semua efek samping di bawah sini tidak idempoten, jadi setiap langkah
      // dicek dulu sudah pernah terjadi atau belum. Job ganda tetap mungkin
      // (jobId yang sudah di-prune dibuat ulang oleh webhook susulan).
      if (!order.customerId) {
        await upsertCustomerFromOrder(order, data.userId).catch(err => {
          console.error('[Worker] Gagal upsert customer:', err.message)
        })
      }

      const sudahPotongStok = await prisma.stockLog
        .findFirst({ where: { orderId: order.id, type: 'SALE' }, select: { id: true } })
        .catch(() => null)

      if (sudahPotongStok) {
        console.warn(
          `[Worker] Order ${order.orderId} sudah pernah memotong stok, deduct dilewati`,
        )
      } else {
        await deductStock(order.id, data.userId).catch(err => {
          console.error('[Worker] Gagal deduct stock:', err.message)
        })
      }

      await incrementMonthlyOrderCount(data.userId).catch(err => {
        console.error('[Worker] Gagal increment order counter:', err.message)
      })

      await enqueueFulfillment(order.id, data.userId).catch(err => {
        console.error('[Worker] Gagal enqueue fulfillment:', err.message)
      })

      await notifyAdminOrderSuccessForUser(data.userId, order, data.notification).catch(
        (err) => console.error('[Worker] Gagal kirim notif admin:', err.message),
      )

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
      // Notifikasi success bisa datang bersamaan dan sudah menuliskan
      // COMPLETED; jangan mengembalikan stok atau mengirim pesan "gagal" untuk
      // order yang ternyata lunas.
      if (order.status === 'COMPLETED' || order.paidAt) {
        console.warn(
          `[Worker] Order ${order.orderId} sudah COMPLETED, job payment-failed dilewati`,
        )
        return
      }

      if (order.source === 'WHATSAPP') {
        const whatsappTarget = resolveWhatsAppTarget(order)
        if (whatsappTarget) {
          const text = `❌ *Pembayaran Gagal/Expired*\n\n🔖 Order: ${order.orderId}\n\nPembayaran tidak berhasil atau sudah kadaluarsa.\nKetik /pesan untuk membuat order baru.`

          try {
            await sendWhatsAppTextForUser(data.userId, whatsappTarget, text)
          } catch (err) {
            console.error('[Worker] Gagal kirim notif gagal WhatsApp user:', err.message)
          }
        } else {
          console.warn(
            `[Worker] Order WhatsApp ${order.orderId} tidak punya whatsappId/customerPhone, notifikasi pembeli dilewati`,
          )
        }
      } else if (bot && order.source !== 'WEBSITE') {
        const telegramId = order.telegramId ? Number(order.telegramId) : null
        if (!telegramId) {
          console.warn(
            `[Worker] Order ${order.orderId} tanpa telegramId, notifikasi pembeli dilewati`,
          )
        } else {
          const text = `❌ *Pembayaran Gagal/Expired*\n\n🔖 Order: \`${order.orderId}\`\n\nPembayaran tidak berhasil atau sudah kadaluarsa.\nKetik /pesan untuk membuat order baru.`

          try {
            await bot.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
          } catch (err) {
            console.error('[Worker] Gagal kirim notif gagal user:', err.message)
          }
        }
      }

      // Dibaca ulang tepat sebelum stok kembali: notifikasi settlement yang
      // datang bersamaan bisa menandai order ini COMPLETED setelah guard di
      // atas, dan mengembalikan stok untuk order yang lunas itu salah.
      const statusTerbaru = await prisma.order
        .findUnique({ where: { id: order.id }, select: { status: true, paidAt: true } })
        .catch(() => null)

      if (statusTerbaru?.status === 'COMPLETED' || statusTerbaru?.paidAt) {
        console.warn(
          `[Worker] Order ${order.orderId} ternyata sudah dibayar, job payment-failed dihentikan`,
        )
        return
      }

      // Stok hanya dipotong pada payment-success, jadi order expired yang tidak
      // pernah lunas tidak punya apa pun untuk dikembalikan — merefundnya
      // justru menaikkan stok di atas harga sebenarnya. REFUND juga cuma sekali.
      const logStok = await prisma.stockLog
        .findMany({
          where: { orderId: order.id, type: { in: ['SALE', 'REFUND'] } },
          select: { type: true },
        })
        .catch(() => null)

      const pernahPotong = logStok?.some((log) => log.type === 'SALE')
      const sudahRefund = logStok?.some((log) => log.type === 'REFUND')

      if (!pernahPotong) {
        console.warn(
          `[Worker] Order ${order.orderId} tidak pernah memotong stok, refund dilewati`,
        )
      } else if (sudahRefund) {
        console.warn(
          `[Worker] Order ${order.orderId} sudah pernah direfund, refund stok dilewati`,
        )
      } else {
        await refundStock(order.id, data.userId).catch(err => {
          console.error('[Worker] Gagal refund stock:', err.message)
        })
      }

      await notifyAdminOrderFailedForUser(data.userId, order).catch((err) =>
        console.error('[Worker] Gagal kirim notif admin gagal:', err.message),
      )

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
