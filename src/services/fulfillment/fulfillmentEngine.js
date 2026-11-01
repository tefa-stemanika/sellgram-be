import prisma from '../db.js'
import { fulfillmentQueue } from '../queue.js'

export async function enqueueFulfillment(orderId, userId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { orderItems: { include: { product: true } } },
  })

  if (!order) {
    console.warn(`[Fulfillment] Order ${orderId} not found, skipping`)
    return
  }

  let hasConfig = false
  for (const item of order.orderItems) {
    const config = await prisma.fulfillmentConfig.findUnique({
      where: { productId: item.productId },
    })

    if (config?.isActive) {
      hasConfig = true
      await fulfillmentQueue.add('fulfill', {
        orderId: order.id,
        userId,
        productId: item.productId,
      })
    }
  }

  if (!hasConfig) {
    console.log(`[Fulfillment] No active config for order ${order.orderId}, skipping`)
  }
}
