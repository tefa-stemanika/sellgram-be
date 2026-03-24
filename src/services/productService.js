// src/services/productService.js
// Semua interaksi database untuk tabel products.
// Multi-tenant: semua query menggunakan userId.

import prisma from './db.js'

/**
 * Ambil semua produk user yang tersedia (isAvailable = true).
 * @param {number} userId
 * @returns {Promise<Product[]>}
 */
export async function getAllProducts(userId) {
  return prisma.product.findMany({
    where: { userId, isAvailable: true },
    orderBy: { id: 'asc' },
  })
}

/**
 * Ambil satu produk user berdasarkan ID.
 * @param {number} userId
 * @param {number} id
 * @returns {Promise<Product|null>}
 */
export async function getProductById(userId, id) {
  return prisma.product.findFirst({
    where: { userId, id, isAvailable: true },
  })
}

/**
 * Ambil semua produk user (termasuk tidak available).
 * Untuk admin dashboard.
 * @param {number} userId
 * @returns {Promise<Product[]>}
 */
export async function getAllProductsAdmin(userId) {
  return prisma.product.findMany({
    where: { userId },
    orderBy: { id: 'asc' },
  })
}

/**
 * Buat produk baru untuk user.
 * @param {number} userId
 * @param {object} data
 * @returns {Promise<Product>}
 */
export async function createProduct(
  userId,
  { name, description, price, emoji = '🛍️' },
) {
  return prisma.product.create({
    data: {
      userId,
      name,
      description,
      price,
      emoji,
      isAvailable: true,
    },
  })
}

/**
 * Update produk user.
 * @param {number} userId
 * @param {number} id
 * @param {object} data
 * @returns {Promise<Product>}
 */
export async function updateProduct(userId, id, data) {
  return prisma.product.updateMany({
    where: { userId, id },
    data,
  })
}

/**
 * Hapus produk user (soft delete).
 * @param {number} userId
 * @param {number} id
 * @returns {Promise<Product>}
 */
export async function deleteProduct(userId, id) {
  return prisma.product.update({
    where: { id },
    data: { isAvailable: false },
  })
}

/**
 * Format harga ke Rupiah.
 * @param {number} amount
 * @returns {string}
 */
export function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount)
}
