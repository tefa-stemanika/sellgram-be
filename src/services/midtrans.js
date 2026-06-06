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
      `MIDTRANS_SERVER_KEY tidak ditemukan di database credentials untuk user ${userId}.`,
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
      first_name: customer.firstName || 'Pelanggan',
      email: customer.email || `${orderId.toLowerCase()}@bot.com`,
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
  const expected = crypto.createHash('sha512').update(raw).digest('hex')
  return expected === signature_key
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
