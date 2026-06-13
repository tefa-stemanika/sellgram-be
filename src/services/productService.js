// src/services/productService.js
// Semua interaksi database untuk tabel products.
// Multi-tenant: semua query menggunakan userId.

import prisma from './db.js'

/**
 * Ambil semua produk user yang tersedia (deletedAt = null) dengan pagination.
 * Query params: search, sortBy, sortDir, page, limit
 */
export async function getAllProducts(userId, filters = {}) {
  const {
    search,
    sortBy = 'createdAt',
    sortDir = 'asc',
    page = 1,
    limit = 20,
  } = filters

  const ALLOWED_SORT = ['createdAt', 'name', 'price']
  const safeSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'createdAt'
  const safeSortDir = sortDir === 'asc' ? 'asc' : 'desc'

  const where = {
    userId,
    deletedAt: null,
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { [safeSortBy]: safeSortDir },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.product.count({ where }),
  ])

  return { products, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) }
}

/**
 * Ambil satu produk user berdasarkan ID.
 * @param {string} userId
 * @param {string} id
 * @returns {Promise<Product|null>}
 */
export async function getProductById(userId, id) {
  return prisma.product.findFirst({
    where: { userId, id, deletedAt: null },
  })
}

/**
 * Ambil semua produk user (termasuk tidak available) dengan pagination.
 * Untuk admin dashboard.
 * Query params: search, isAvailable, sortBy, sortDir, page, limit
 */
export async function getAllProductsAdmin(userId, filters = {}) {
  const {
    search,
    isAvailable,
    sortBy = 'createdAt',
    sortDir = 'asc',
    page = 1,
    limit = 20,
  } = filters

  const ALLOWED_SORT = ['createdAt', 'name', 'price']
  const safeSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'createdAt'
  const safeSortDir = sortDir === 'asc' ? 'asc' : 'desc'

  const where = {
    userId,
    deletedAt: null,
    ...(isAvailable !== undefined && { isAvailable: isAvailable === 'true' }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    }),
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { [safeSortBy]: safeSortDir },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.product.count({ where }),
  ])

  return { products, total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) }
}

/**
 * Buat produk baru untuk user.
 * @param {string} userId
 * @param {object} data
 * @returns {Promise<Product>}
 */
export async function createProduct(
  userId,
  { name, description, price, emoji = '🛍️', stock, stockEnabled, allowOversell, lowStockAlert },
) {
  return prisma.product.create({
    data: {
      userId,
      name,
      description,
      price,
      emoji,
      isAvailable: true,
      ...(stock !== undefined && { stock }),
      ...(stockEnabled !== undefined && { stockEnabled }),
      ...(allowOversell !== undefined && { allowOversell }),
      ...(lowStockAlert !== undefined && { lowStockAlert }),
    },
  })
}

/**
 * Update produk user.
 * @param {string} userId
 * @param {string} id
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
 * @param {string} userId
 * @param {string} id
 * @returns {Promise<Product>}
 */
export async function deleteProduct(userId, id) {
  return prisma.product.update({
    where: { id },
    data: { deletedAt: new Date() },
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
