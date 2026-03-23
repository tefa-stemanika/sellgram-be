// src/services/productService.js
// Semua interaksi database untuk tabel products.

import prisma from './db.js'

/**
 * Ambil semua produk yang tersedia (isAvailable = true).
 * @returns {Promise<Product[]>}
 */
export async function getAllProducts() {
  return prisma.product.findMany({
    where: { isAvailable: true },
    orderBy: { id: 'asc' },
  })
}

/**
 * Ambil satu produk berdasarkan ID.
 * @param {number} id
 * @returns {Promise<Product|null>}
 */
export async function getProductById(id) {
  return prisma.product.findFirst({
    where: { id, isAvailable: true },
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
