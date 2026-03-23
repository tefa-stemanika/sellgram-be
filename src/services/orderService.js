// src/services/orderService.js

import prisma from './db.js'

export function generateOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `ORD-${date}-${rand}`
}

/**
 * Simpan order baru ke database dengan status PAYMENT_PENDING.
 * paymentUrl dan qrString diisi setelah transaksi Midtrans dibuat.
 */
export async function saveOrder({
  telegramId,
  username,
  firstName,
  product,
  quantity,
}) {
  const orderId = generateOrderId()
  const totalPrice = product.price * quantity

  return prisma.order.create({
    data: {
      orderId,
      telegramId: BigInt(telegramId),
      username: username || null,
      firstName: firstName || null,
      totalPrice,
      status: 'PAYMENT_PENDING',
      orderItems: {
        create: {
          productId: product.id,
          quantity,
          unitPrice: product.price,
        },
      },
    },
    include: {
      orderItems: { include: { product: true } },
    },
  })
}

/**
 * Simpan payment URL dan token Midtrans ke order yang sudah ada.
 */
export async function updateOrderPayment(orderId, { paymentUrl, snapToken }) {
  return prisma.order.update({
    where: { orderId },
    data: {
      paymentUrl,
      midtransOrderId: orderId, // sama dengan orderId kita
    },
  })
}

export async function getOrdersByUser(telegramId, limit = 5) {
  return prisma.order.findMany({
    where: { telegramId: BigInt(telegramId) },
    include: { orderItems: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function getOrderByOrderId(orderId) {
  return prisma.order.findUnique({
    where: { orderId },
    include: { orderItems: { include: { product: true } } },
  })
}
