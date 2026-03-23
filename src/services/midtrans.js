// src/services/midtrans.js
// Integrasi Midtrans menggunakan native fetch — tidak perlu SDK tambahan.
// Docs: https://docs.midtrans.com/reference/create-transaction

import crypto from 'crypto'

const MIDTRANS_BASE_URL =
  process.env.MIDTRANS_IS_PRODUCTION === 'true'
    ? 'https://app.midtrans.com/snap/v1'
    : 'https://app.sandbox.midtrans.com/snap/v1'

const MIDTRANS_API_BASE =
  process.env.MIDTRANS_IS_PRODUCTION === 'true'
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'

/**
 * Buat Base64 dari Server Key untuk Authorization header.
 */
function getAuthHeader() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY tidak ditemukan di .env')
  return 'Basic ' + Buffer.from(serverKey + ':').toString('base64')
}

/**
 * Buat transaksi Snap Midtrans dan dapatkan payment URL + token.
 *
 * @param {object} params
 * @param {string} params.orderId       - Order ID unik (ORD-xxx)
 * @param {number} params.totalPrice    - Total harga dalam Rupiah
 * @param {object} params.product       - Objek produk
 * @param {number} params.quantity      - Jumlah produk
 * @param {object} params.customer      - { firstName, email (opsional) }
 * @returns {Promise<{ token: string, redirect_url: string }>}
 */
export async function createSnapTransaction({
  orderId,
  totalPrice,
  product,
  quantity,
  customer,
}) {
  const body = {
    transaction_details: {
      order_id: orderId,
      gross_amount: totalPrice,
    },
    item_details: [
      {
        id: String(product.id),
        price: product.price,
        quantity,
        name: product.name.slice(0, 50), // Midtrans max 50 karakter
      },
    ],
    customer_details: {
      first_name: customer.firstName || 'Pelanggan',
      email: customer.email || `${orderId.toLowerCase()}@bot.com`, // dummy jika tidak ada
    },
    // Aktifkan QRIS sebagai metode pembayaran utama
    enabled_payments: ['qris', 'gopay', 'shopeepay', 'bank_transfer'],
    qris: {
      acquirer: 'gopay',
    },
    callbacks: {
      finish: process.env.MIDTRANS_FINISH_URL || 'https://t.me/',
    },
  }

  const response = await fetch(`${MIDTRANS_BASE_URL}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Midtrans error ${response.status}: ${JSON.stringify(err)}`)
  }

  return response.json() // { token, redirect_url }
}

/**
 * Cek status transaksi langsung ke Midtrans API.
 * Berguna untuk polling atau double-check setelah webhook.
 *
 * @param {string} orderId - Order ID yang dicek
 * @returns {Promise<object>} - Response status dari Midtrans
 */
export async function checkTransactionStatus(orderId) {
  const response = await fetch(`${MIDTRANS_API_BASE}/${orderId}/status`, {
    headers: { Authorization: getAuthHeader() },
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(
      `Midtrans status error ${response.status}: ${JSON.stringify(err)}`,
    )
  }

  return response.json()
}

/**
 * Verifikasi signature dari webhook Midtrans.
 * Penting untuk memastikan notifikasi benar-benar dari Midtrans.
 *
 * Formula: SHA512(order_id + status_code + gross_amount + server_key)
 *
 * @param {object} notification - Body webhook dari Midtrans
 * @returns {boolean}
 */
export function verifyWebhookSignature(notification) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY
  const { order_id, status_code, gross_amount, signature_key } = notification

  const raw = `${order_id}${status_code}${gross_amount}${serverKey}`
  const expected = crypto.createHash('sha512').update(raw).digest('hex')

  return expected === signature_key
}

/**
 * Tentukan apakah status transaksi dianggap "berhasil dibayar".
 * Referensi: https://docs.midtrans.com/docs/payment-status
 *
 * @param {object} notification
 * @returns {boolean}
 */
export function isPaymentSuccess(notification) {
  const { transaction_status, fraud_status } = notification

  return (
    (transaction_status === 'capture' && fraud_status === 'accept') ||
    transaction_status === 'settlement'
  )
}

/**
 * Tentukan apakah transaksi gagal/expired.
 */
export function isPaymentFailed(notification) {
  const { transaction_status } = notification
  return ['deny', 'cancel', 'expire', 'failure'].includes(transaction_status)
}
