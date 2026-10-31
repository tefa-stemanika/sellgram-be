import { Worker } from 'bullmq'
import prisma from '../services/db.js'
import { execute as stockPool } from '../services/fulfillment/strategies/stockPoolStrategy.js'
import { execute as slotAssign } from '../services/fulfillment/strategies/slotAssignStrategy.js'
import { execute as apiExternal } from '../services/fulfillment/strategies/apiExternalStrategy.js'
import { execute as manual } from '../services/fulfillment/strategies/manualStrategy.js'
import { sendDeliveryToCustomer, notifyFulfillmentFailed } from '../services/fulfillment/fulfillmentNotifier.js'

const strategies = {
  STOCK_POOL: stockPool,
  SLOT_ASSIGN: slotAssign,
  API_EXTERNAL: apiExternal,
  MANUAL: manual,
}

export function createFulfillmentWorker(connection) {
  const worker = new Worker(
    'fulfillment-jobs',
    async (job) => {
      const { orderId, userId, productId } = job.data

      const order = await prisma.order.findFirst({
        where: { id: orderId, userId },
        include: {
          orderItems: { include: { product: true } },
          fulfillmentLog: true,
          customer: true,
        },
      })

      if (!order) {
        console.warn(`[FulfillmentWorker] Order ${orderId} not found`)
        return
      }

      if (order.status !== 'COMPLETED') {
        console.warn(`[FulfillmentWorker] Order ${order.orderId} status is ${order.status}, not COMPLETED, skipping`)
        return
      }

      const log = order.fulfillmentLog
      if (log && (log.status === 'SUCCESS' || log.status === 'SKIPPED')) {
        console.log(`[FulfillmentWorker] Order ${order.orderId} already fulfilled, skipping`)
        return
      }

      const config = await prisma.fulfillmentConfig.findUnique({
        where: { productId },
      })

      if (!config || !config.isActive) {
        return
      }

      const strategy = strategies[config.type]
      if (!strategy) {
        throw new Error(`Unknown fulfillment type: ${config.type}`)
      }

      let result
      try {
        result = await strategy({ userId, order, config })
      } catch (err) {
        const attempts = (log?.attempts || 0) + 1
        await prisma.fulfillmentLog.upsert({
          where: { orderId: orderId },
          create: {
            userId,
            orderId,
            productId,
            type: config.type,
            status: 'FAILED',
            attempts,
            maxAttempts: 3,
            lastError: err.message,
            lastAttemptAt: new Date(),
          },
          update: {
            status: attempts >= 3 ? 'FAILED' : 'PENDING',
            attempts,
            lastError: err.message,
            lastAttemptAt: new Date(),
          },
        })

        if (attempts >= 3) {
          const productName = order.orderItems?.[0]?.product?.name || productId
          await notifyFulfillmentFailed({ userId, order, productName, error: err.message })
        }

        throw err
      }

      const deliveryMessage = config.deliveryMessage
        ? config.deliveryMessage
            .replace(/\{\{order_id\}\}/g, order.orderId)
            .replace(/\{\{product_name\}\}/g, order.orderItems?.[0]?.product?.name || '')
            .replace(/\{\{customer_name\}\}/g, order.customerName || order.firstName || '')
            .replace(/\{\{customer_phone\}\}/g, order.customerPhone || order.customer?.phone || '')
            .replace(/\{\{result\}\}/g, result.delivery || '')
        : result.delivery || 'Pesanan telah diproses'

      const deliveredContent = deliveryMessage
      const metadata = result.metadata || null

      await prisma.fulfillmentLog.upsert({
        where: { orderId },
        create: {
          userId,
          orderId,
          productId,
          type: config.type,
          status: 'SUCCESS',
          attempts: 1,
          maxAttempts: 3,
          deliveredContent,
          deliveredAt: new Date(),
          metadata,
        },
        update: {
          status: 'SUCCESS',
          attempts: { increment: 1 },
          deliveredContent,
          deliveredAt: new Date(),
          metadata,
          lastError: null,
        },
      })

      const orderForDelivery = { 
        ...order, 
        telegramId: order.telegramId ? Number(order.telegramId) : null, 
        orderId: order.orderId 
      }
      await sendDeliveryToCustomer({ userId, order: orderForDelivery, delivery: deliveredContent })
    },
    {
      connection,
      concurrency: 5,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  )

  worker.on('failed', (job, err) => {
    console.error(`[FulfillmentWorker] Job ${job.id} failed:`, err.message)
  })

  return worker
}
