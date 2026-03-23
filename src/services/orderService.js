// src/services/orderService.js
// Semua interaksi database untuk tabel orders dan order_items.

import prisma from './db.js'

/**
 * Generate nomor order unik. Format: ORD-YYYYMMDD-XXXX
 * @returns {string}
 */
export function generateOrderId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `ORD-${date}-${rand}`
}

/**
 * Simpan order yang sudah dikonfirmasi ke database.
 *
 * @param {object} params
 * @param {number}  params.telegramId  - ID user Telegram
 * @param {string}  params.username    - Username Telegram (opsional)
 * @param {string}  params.firstName   - Nama depan user
 * @param {object}  params.product     - Objek produk dari productService
 * @param {number}  params.quantity    - Jumlah yang dipesan
 * @returns {Promise<Order>}           - Order yang tersimpan (include orderItems)
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

  const order = await prisma.order.create({
    data: {
      orderId,
      telegramId: BigInt(telegramId),
      username: username || null,
      firstName: firstName || null,
      totalPrice,
      status: 'CONFIRMED',
      orderItems: {
        create: {
          productId: product.id,
          quantity,
          unitPrice: product.price, // snapshot harga saat order — penting!
        },
      },
    },
    include: {
      orderItems: {
        include: { product: true },
      },
    },
  })

  return order
}

/**
 * Ambil riwayat order user berdasarkan Telegram ID.
 * @param {number} telegramId
 * @param {number} limit - Jumlah order terakhir yang diambil
 * @returns {Promise<Order[]>}
 */
export async function getOrdersByUser(telegramId, limit = 5) {
  return prisma.order.findMany({
    where: { telegramId: BigInt(telegramId) },
    include: {
      orderItems: {
        include: { product: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Ambil satu order berdasarkan orderId string (misal: "ORD-20240101-1234").
 * @param {string} orderId
 * @returns {Promise<Order|null>}
 */
export async function getOrderByOrderId(orderId) {
  return prisma.order.findUnique({
    where: { orderId },
    include: {
      orderItems: {
        include: { product: true },
      },
    },
  })
}
