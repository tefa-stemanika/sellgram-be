// src/services/invoiceService.js

import prisma from './db.js'
import { redisIncr, redisExpire } from './redis.js'
import { PLAN_PRICES } from './planLimitService.js'

/**
 * Generate nomor invoice unik: INV-YYYYMMDD-NNNN
 * — Gunakan Redis INCR untuk sequence harian, fallback ke DB.
 */
async function generateInvoiceNumber(prismaClient, userId) {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const redisKey = `invoice_seq:${dateStr}`

  const seq = await redisIncr(redisKey).catch(() => null)
  if (seq !== null) {
    if (seq === 1) {
      await redisExpire(redisKey, 86400 * 2).catch(() => {})
    }
    return `INV-${dateStr}-${String(seq).padStart(4, '0')}`
  }

  // Fallback ke DB jika Redis tidak tersedia
  const prefix = `INV-${dateStr}-`
  const last = await prismaClient.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
  })
  const nextSeq = last
    ? String(parseInt(last.invoiceNumber.split('-')[2]) + 1).padStart(4, '0')
    : '0001'
  return `${prefix}${nextSeq}`
}

/**
 * Buat invoice baru dan Midtrans Snap transaction.
 * Dipanggil saat tenant request upgrade atau renewal.
 *
 * @param {string} userId
 * @param {string} plan - 'STARTER' | 'PRO'
 * @param {string} interval - 'MONTHLY' | 'YEARLY'
 */
export async function createInvoice(userId, plan, interval = 'MONTHLY') {
  const amount = PLAN_PRICES[plan]?.[interval]
  if (!amount) throw new Error(`Kombinasi plan/interval tidak valid: ${plan}/${interval}`)

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('User not found')

  // Hitung periode yang di-cover
  const periodStart = new Date()
  const periodEnd = new Date()
  if (interval === 'MONTHLY') periodEnd.setMonth(periodEnd.getMonth() + 1)
  if (interval === 'YEARLY') periodEnd.setFullYear(periodEnd.getFullYear() + 1)

  const invoiceNumber = await generateInvoiceNumber(prisma, userId)
  const midtransOrderId = `SUB-${invoiceNumber}` // Prefix berbeda dari order biasa
  const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 jam

  // Buat Snap transaction ke Midtrans
  // Gunakan PLATFORM_MIDTRANS_SERVER_KEY dari env (key platform, bukan tenant)
  const serverKey = process.env.PLATFORM_MIDTRANS_SERVER_KEY
  if (!serverKey) throw new Error('PLATFORM_MIDTRANS_SERVER_KEY tidak dikonfigurasi')

  const isProduction = process.env.PLATFORM_MIDTRANS_IS_PRODUCTION === 'true'
  const snapBase = isProduction
    ? 'https://app.midtrans.com/snap/v1'
    : 'https://app.sandbox.midtrans.com/snap/v1'

  const auth = Buffer.from(`${serverKey}:`).toString('base64')

  const snapRes = await fetch(`${snapBase}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: amount,
      },
      customer_details: {
        first_name: user.name,
        email: user.email,
      },
      item_details: [{
        id: plan,
        price: amount,
        quantity: 1,
        name: `Subscription ${plan} (${interval})`,
      }],
      expiry: {
        unit: 'hour',
        duration: 24,
      },
    }),
  })

  const snapData = await snapRes.json()
  if (!snapData.token) throw new Error(`Midtrans error: ${JSON.stringify(snapData)}`)

  // Simpan invoice ke DB
  const invoice = await prisma.invoice.create({
    data: {
      userId,
      invoiceNumber,
      plan,
      interval,
      amount,
      status: 'PENDING',
      midtransOrderId,
      paymentUrl: snapData.redirect_url,
      periodStart,
      periodEnd,
      expiredAt,
    }
  })

  return invoice
}

/**
 * Dapatkan invoice by ID (dengan userId scoping)
 */
export async function getInvoiceById(invoiceId, userId) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, userId },
  })
}

/**
 * Dapatkan semua invoice user (dengan pagination)
 */
export async function getUserInvoices(userId, { page = 1, limit = 20, status } = {}) {
  const where = { userId }
  if (status) where.status = status

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ])

  return {
    invoices,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  }
}

/**
 * Update invoice status (dipanggil dari webhook handler)
 */
export async function updateInvoiceStatus(midtransOrderId, status, paymentMethod = null) {
  const invoice = await prisma.invoice.findUnique({
    where: { midtransOrderId },
  })

  if (!invoice) return null

  const data = { status }
  if (status === 'PAID') {
    data.paidAt = new Date()
    if (paymentMethod) data.paymentMethod = paymentMethod
  }

  return prisma.invoice.update({
    where: { id: invoice.id },
    data,
  })
}

/**
 * Cek dan update invoice yang expired (PENDING tapi expiredAt sudah lewat)
 */
export async function expirePendingInvoices() {
  const now = new Date()
  return prisma.invoice.updateMany({
    where: {
      status: 'PENDING',
      expiredAt: { lte: now },
    },
    data: { status: 'EXPIRED' },
  })
}