// src/services/midtrans.js

import crypto from 'crypto'
import {
  getMidtransServerKeyForUser,
  isMidtransProductionForUser,
  getCredentialForUser,
  loadConfigForUser,
} from './configService.js'

function getBaseUrl(isProduction) {
  return isProduction
    ? 'https://app.midtrans.com/snap/v1'
    : 'https://app.sandbox.midtrans.com/snap/v1'
}

function getApiBase(isProduction) {
  return isProduction
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'
}

async function resolveMidtransContext(userId) {
  if (!userId) {
    throw new Error('userId wajib diisi untuk akses Midtrans per tenant.')
  }

  await loadConfigForUser(userId)

  const serverKey = await getMidtransServerKeyForUser(userId)
  if (!serverKey)
    throw new Error(
      `Midtrans server key tidak ditemukan di database credentials untuk user ${userId}.`,
    )

  return {
    authHeader: 'Basic ' + Buffer.from(serverKey + ':').toString('base64'),
    isProduction: await isMidtransProductionForUser(userId),
  }
}

export async function createSnapTransaction({
  userId,
  orderId,
  totalPrice,
  product,
  quantity,
  customer,
}) {
  const { authHeader, isProduction } = await resolveMidtransContext(userId)

  const body = {
    transaction_details: { order_id: orderId, gross_amount: totalPrice },
    item_details: [
      {
        id: String(product.id),
        price: product.price,
        quantity,
        name: product.name.slice(0, 50),
      },
    ],
    customer_details: {
      first_name: customer.firstName || customer.name || 'Pelanggan',
      email: customer.email || `${orderId.toLowerCase()}@bot.com`,
      ...(customer.phone && { phone: customer.phone }),
    },
    enabled_payments: ['qris', 'gopay', 'shopeepay', 'bank_transfer'],
    qris: { acquirer: 'gopay' },
    callbacks: {
      finish: await getCredentialForUser(userId, 'MIDTRANS_FINISH_URL') || process.env.MIDTRANS_FINISH_URL || 'https://t.me/',
    },
  }

  const response = await fetch(`${getBaseUrl(isProduction)}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Midtrans error ${response.status}: ${JSON.stringify(err)}`)
  }

  return response.json()
}

export async function checkTransactionStatus(userId, orderId) {
  const { authHeader, isProduction } = await resolveMidtransContext(userId)

  const response = await fetch(`${getApiBase(isProduction)}/${orderId}/status`, {
    headers: { Authorization: authHeader },
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(
      `Midtrans status error ${response.status}: ${JSON.stringify(err)}`,
    )
  }

  return response.json()
}

export async function verifyWebhookSignature(userId, notification) {
  await loadConfigForUser(userId)

  const serverKey = await getMidtransServerKeyForUser(userId)
  if (!serverKey) return false

  const { order_id, status_code, gross_amount, signature_key } = notification
  const raw = `${order_id}${status_code}${gross_amount}${serverKey}`
  return safeHexEqual(
    crypto.createHash('sha512').update(raw).digest('hex'),
    signature_key,
  )
}

function safeHexEqual(expected, received) {
  const a = String(expected || '')
  const b = String(received || '')
  if (!a || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * `gross_amount` Midtrans bervariasi per kanal: "25000", "25000.00", dan pada
 * beberapa invoice "25.000" atau "25.000,50". Dipakai untuk memilih order yang
 * benar kalau beberapa tenant memakai orderId yang sama, jadi nilai yang tidak
 * bisa dibaca dikembalikan NaN dan pemanggilnya fallback, bukan menolak.
 */
export function parseGrossAmount(raw) {
  const cleaned = String(raw ?? '').replace(/[^\d.,]/g, '')
  if (!cleaned) return NaN
  if (!/[.,]/.test(cleaned)) return Number(cleaned)

  const lastSep = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','))
  const tail = cleaned.slice(lastSep + 1)
  // Tiga digit di belakang pemisah terakhir hanya dianggap grouping ribuan
  // kalau seluruh polonya memang pemisah ribuan (1.234 / 1,234,567). "25000.000"
  // tetap desimal, kalau tidak nilainya meleset seribu kali dan bisa memilih
  // order tenant yang salah.
  if (tail.length === 3 && /^\d{1,3}([.,]\d{3})+$/.test(cleaned)) {
    return Number(cleaned.replace(/[.,]/g, ''))
  }

  const head = cleaned.slice(0, lastSep).replace(/[.,]/g, '')
  return Number(`${head}.${tail}`)
}

// Invoice subscription dibuat dengan akun Midtrans platform
// (PLATFORM_MIDTRANS_SERVER_KEY), jadi signature-nya tidak bisa diverifikasi
// memakai key tenant.
export function verifySubscriptionWebhookSignature(notification) {
  const serverKey = String(process.env.PLATFORM_MIDTRANS_SERVER_KEY || '').trim()
  if (!serverKey) return false

  const { order_id, status_code, gross_amount, signature_key } = notification || {}
  if (!signature_key) return false

  const raw = `${order_id}${status_code}${gross_amount}${serverKey}`
  return safeHexEqual(
    crypto.createHash('sha512').update(raw).digest('hex'),
    signature_key,
  )
}

// Fallback untuk kanal yang notifikasinya tidak menyertakan signature_key
// (mis. beberapa VA bank): status transaksi dibaca langsung ke Midtrans memakai
// key platform. Mengembalikan null bila tidak bisa dipastikan (fail-closed).
export async function fetchSubscriptionTransactionStatus(orderId) {
  const serverKey = String(process.env.PLATFORM_MIDTRANS_SERVER_KEY || '').trim()
  if (!serverKey) {
    console.warn('[Midtrans] PLATFORM_MIDTRANS_SERVER_KEY tidak dikonfigurasi')
    return null
  }

  try {
    const isProduction = process.env.PLATFORM_MIDTRANS_IS_PRODUCTION === 'true'
    const auth = 'Basic ' + Buffer.from(`${serverKey}:`).toString('base64')

    const response = await fetch(
      `${getApiBase(isProduction)}/${encodeURIComponent(orderId)}/status`,
      { headers: { Authorization: auth } },
    )

    if (!response.ok) {
      console.warn(
        `[Midtrans] Gagal membaca status subscription ${orderId}: ${response.status}`,
      )
      return null
    }

    return await response.json()
  } catch (error) {
    console.warn(
      `[Midtrans] Gagal membaca status subscription ${orderId}: ${error.message}`,
    )
    return null
  }
}

export function isPaymentSuccess(notification) {
  const { transaction_status, fraud_status } = notification
  return (
    (transaction_status === 'capture' && fraud_status === 'accept') ||
    transaction_status === 'settlement'
  )
}

export function isPaymentFailed(notification) {
  return ['deny', 'cancel', 'expire', 'failure'].includes(
    notification.transaction_status,
  )
}
