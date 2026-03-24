// src/services/orderService.js
// Multi-tenant: semua operasi order memerlukan userId.

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
  userId,
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
      userId,
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
 * Update payment URL dan token Midtrans ke order yang sudah ada.
 */
export async function updateOrderPayment(
  userId,
  orderId,
  { paymentUrl, snapToken },
) {
  return prisma.order.update({
    where: {
      // Gunakan composite unique (userId, orderId)
      userId_orderId: { userId, orderId },
    },
    data: {
      paymentUrl,
      midtransOrderId: orderId, // sama dengan orderId kita
    },
  })
}

/**
 * Ambil riwayat order user berdasarkan telegram ID.
 * CATATAN: Perlu userId untuk scoping, jadi parameter berubah.
 */
export async function getOrdersByTelegramId(userId, telegramId, limit = 5) {
  return prisma.order.findMany({
    where: { userId, telegramId: BigInt(telegramId) },
    include: { orderItems: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Ambil order berdasarkan order ID (sudah scoped ke user).
 */
export async function getOrderByOrderId(userId, orderId) {
  return prisma.order.findUnique({
    where: {
      userId_orderId: { userId, orderId },
    },
    include: { orderItems: { include: { product: true } } },
  })
}

/**
 * Ambil semua order user (untuk admin dashboard).
 */
export async function getAllOrdersForUser(userId, limit = 50) {
  return prisma.order.findMany({
    where: { userId },
    include: { orderItems: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Update status order (dari webhook Midtrans).
 */
export async function updateOrderStatus(
  userId,
  orderId,
  status,
  paidAt = null,
) {
  return prisma.order.update({
    where: {
      userId_orderId: { userId, orderId },
    },
    data: {
      status,
      ...(paidAt && { paidAt }),
    },
  })
}
