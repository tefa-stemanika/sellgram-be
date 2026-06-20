// src/services/subscriptionService.js

import prisma from './db.js'
import { clearUserCache } from '../api/middlewares/planGuard.js'

/**
 * Dipanggil saat invoice berhasil dibayar (dari webhook handler).
 * Buat atau perpanjang subscription, update User.plan.
 *
 * @param {string} midtransOrderId - ID dari Midtrans webhook
 * @param {string} paymentMethod
 */
export async function activateSubscription(midtransOrderId, paymentMethod) {
  const invoice = await prisma.invoice.findUnique({
    where: { midtransOrderId },
    include: { user: { include: { subscription: true } } }
  })

  if (!invoice || invoice.status === 'PAID') return // Idempoten

  const { userId, plan, interval, periodStart, periodEnd } = invoice
  const gracePeriodEnd = new Date(periodEnd)
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3) // +3 hari grace period

  await prisma.$transaction([
    // Update invoice
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: new Date(), paymentMethod }
    }),

    // Buat atau perpanjang subscription
    prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan,
        interval,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gracePeriodEnd,
      },
      update: {
        plan,
        interval,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gracePeriodEnd,
      }
    }),

    // Update plan di User
    prisma.user.update({
      where: { id: userId },
      data: { plan }
    }),
  ])

  // Sambungkan invoice ke subscription
  const sub = await prisma.subscription.findUnique({ where: { userId } })
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { subscriptionId: sub.id }
  })

  await clearUserCache(userId)

  return sub
}

/**
 * Cancel subscription — akses tetap aktif sampai currentPeriodEnd.
 */
export async function cancelSubscription(userId, reason) {
  const sub = await prisma.subscription.findUnique({ where: { userId } })
  if (!sub || sub.status !== 'ACTIVE') throw new Error('Tidak ada subscription aktif')

  await prisma.subscription.update({
    where: { userId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }
  })

  await clearUserCache(userId)
}

/**
 * Dapatkan subscription aktif user.
 */
export async function getSubscription(userId) {
  return prisma.subscription.findUnique({
    where: { userId },
  })
}

/**
 * Dipanggil oleh cron job saat subscription expired melewati grace period.
 * Downgrade ke FREE dan nonaktifkan bot.
 */
export async function handleExpiredSubscription(userId) {
  await prisma.$transaction([
    prisma.subscription.update({
      where: { userId },
      data: { status: 'PAST_DUE' }
    }),
    prisma.user.update({
      where: { id: userId },
      data: { plan: 'FREE' }
    }),
    // Nonaktifkan semua bot config tenant
    prisma.botConfig.updateMany({
      where: { userId },
      data: { isActive: false }
    })
  ])

  await clearUserCache(userId)

  // TODO: Kirim notifikasi ke tenant (via email atau Telegram ke admin chat)
}

/**
 * Update status subscription yang sudah lewat currentPeriodEnd tapi masih dalam grace period → EXPIRED
 */
export async function updateExpiredStatuses() {
  const now = new Date()
  return prisma.subscription.updateMany({
    where: {
      status: 'ACTIVE',
      currentPeriodEnd: { lte: now },
      gracePeriodEnd: { gt: now },
    },
    data: { status: 'EXPIRED' }
  })
}

/**
 * Dapatkan subscription yang perlu di-handle expiry (grace period sudah habis)
 */
export async function getOverdueSubscriptions() {
  const now = new Date()
  return prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'EXPIRED', 'CANCELLED'] },
      gracePeriodEnd: { lte: now },
    },
    select: { userId: true }
  })
}

/**
 * Dapatkan subscription untuk reminder (H-3 dan H-1 sebelum expired)
 */
export async function getSubscriptionsForReminder() {
  const now = new Date()
  const in3Days = new Date(now); in3Days.setDate(in3Days.getDate() + 3)
  const in1Day  = new Date(now); in1Day.setDate(in1Day.getDate() + 1)

  return prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      currentPeriodEnd: {
        gte: now,
        lte: in3Days,
      }
    },
    include: { user: true }
  })
}