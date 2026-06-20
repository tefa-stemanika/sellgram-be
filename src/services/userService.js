// src/services/userService.js
// Service untuk mengelola user (tenant) — create, read, update, check status.

import prisma from './db.js'
import { hash, verify } from '../utils/password.js' // akan dibuat

/**
 * Cari user by ID — dengan full relations (config, credentials, products, orders).
 */
export async function getUserById(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      botConfigs: true,
      credentials: true,
      products: { where: { deletedAt: null, isAvailable: true } },
      orders: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
}

/**
 * Cari user by email.
 */
export async function getUserByEmail(email) {
  return prisma.user.findUnique({
    where: { email },
    include: {
      botConfigs: true,
      credentials: true,
    },
  })
}

/**
 * Buat user baru.
 */
export async function createUser({ email, password, name, plan = 'FREE' }) {
  const passwordHash = await hash(password)

  return prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      plan,
      isActive: true,
    },
  })
}

/**
 * Update user profile.
 */
export async function updateUserProfile(userId, { name, plan }) {
  return prisma.user.update({
    where: { id: userId },
    data: { ...(name && { name }), ...(plan && { plan }) },
  })
}

/**
 * Cek apakah password user cocok.
 * Return: { valid: boolean, user?: User }
 */
export async function verifyUserPassword(email, password) {
  const user = await getUserByEmail(email)
  if (!user) return { valid: false }

  const isValid = await verify(password, user.passwordHash)
  return { valid: isValid, user: isValid ? user : null }
}

/**
 * Hitung jumlah bot instance aktif user (jumlah BotConfig dengan isActive=true).
 */
export async function countActiveBots(userId) {
  return prisma.botConfig.count({
    where: { userId, isActive: true },
  })
}

/**
 * Cek apakah user bisa spawn bot baru (berdasarkan plan).
 */
export function canCreateNewBot(user) {
  const limits = {
    FREE: 1,
    STARTER: 1,
    PRO: 1,
  }

  const limit = limits[user.plan] || 1
  return limit
}

/**
 * Deactivate user (soft delete).
 */
export async function deactivateUser(userId) {
  return prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  })
}

/**
 * Get all active users (untuk bot manager startup).
 */
export async function getAllActiveUsers() {
  return prisma.user.findMany({
    where: { isActive: true },
    include: {
      botConfigs: { where: { isActive: true } },
      credentials: true,
    },
  })
}
