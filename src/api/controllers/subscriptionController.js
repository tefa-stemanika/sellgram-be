// src/api/controllers/subscriptionController.js

import prisma from '../../services/db.js'
import { ok, fail } from '../utils/response.js'
import { createInvoice } from '../../services/invoiceService.js'
import { cancelSubscription, getSubscription, activateSubscription } from '../../services/subscriptionService.js'

export async function getSubscriptionStatus(req, res) {
  try {
    const userId = req.auth.userId
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true }
    })

    if (!user) return fail(res, 'User not found', 404)

    const sub = user.subscription
    const planLimits = {
      FREE: { botConfigs: 1, products: 10, maxBroadcastsPerMonth: 0, maxOrdersPerMonth: 10 },
      STARTER: { botConfigs: 1, products: 50, maxBroadcastsPerMonth: 50, maxOrdersPerMonth: 200 },
      PRO: { botConfigs: 1, products: Infinity, maxBroadcastsPerMonth: Infinity, maxOrdersPerMonth: Infinity },
    }

    return ok(res, {
      plan: user.plan,
      subscription: sub ? {
        id: sub.id,
        plan: sub.plan,
        status: sub.status,
        interval: sub.interval,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        gracePeriodEnd: sub.gracePeriodEnd,
        cancelledAt: sub.cancelledAt,
        cancelReason: sub.cancelReason,
      } : null,
      limits: planLimits[user.plan] || planLimits.FREE,
    })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
}

export async function upgradeSubscription(req, res) {
  try {
    const userId = req.auth.userId
    const { plan, interval = 'MONTHLY' } = req.body

    if (!['STARTER', 'PRO'].includes(plan)) {
      return fail(res, 'Plan tidak valid. Pilih STARTER atau PRO', 400)
    }
    if (!['MONTHLY', 'YEARLY'].includes(interval)) {
      return fail(res, 'Interval tidak valid. Pilih MONTHLY atau YEARLY', 400)
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return fail(res, 'User not found', 404)

    // Jika sudah di plan yang sama atau lebih tinggi, tidak perlu upgrade
    const planHierarchy = { FREE: 0, STARTER: 1, PRO: 2 }
    if (planHierarchy[user.plan] >= planHierarchy[plan]) {
      return fail(res, `Anda sudah menggunakan plan ${user.plan} atau lebih tinggi`, 400)
    }

    const invoice = await createInvoice(userId, plan, interval)

    return ok(res, {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        plan: invoice.plan,
        interval: invoice.interval,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
      },
      paymentUrl: invoice.paymentUrl,
    }, 'Invoice berhasil dibuat. Silakan lakukan pembayaran.')
  } catch (err) {
    if (err.message?.includes('PLATFORM_MIDTRANS_SERVER_KEY')) {
      return fail(res, 'Konfigurasi pembayaran platform belum lengkap. Hubungi admin.', 500)
    }
    return fail(res, err.message, 500)
  }
}

export async function cancelSubscriptionHandler(req, res) {
  try {
    const userId = req.auth.userId
    const { reason } = req.body

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true }
    })

    if (!user || !user.subscription) {
      return fail(res, 'Tidak ada subscription aktif', 404)
    }

    if (user.subscription.status !== 'ACTIVE') {
      return fail(res, 'Subscription tidak dalam status aktif', 400)
    }

    await cancelSubscription(userId, reason || 'Dibatalkan oleh user')

    return ok(res, { cancelled: true }, 'Subscription dibatalkan. Akses tetap aktif sampai periode berakhir.')
  } catch (err) {
    return fail(res, err.message, 500)
  }
}