// src/services/midtrans.js

import crypto from 'crypto'
import { getMidtransServerKey, isMidtransProduction } from './configService.js'

function getBaseUrl() {
  return isMidtransProduction()
    ? 'https://app.midtrans.com/snap/v1'
    : 'https://app.sandbox.midtrans.com/snap/v1'
}

function getApiBase() {
  return isMidtransProduction()
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'
}

function getAuthHeader() {
  const serverKey = getMidtransServerKey()
  if (!serverKey)
    throw new Error(
      'MIDTRANS_SERVER_KEY tidak ditemukan di database credentials.',
    )
  return 'Basic ' + Buffer.from(serverKey + ':').toString('base64')
}

export async function createSnapTransaction({
  orderId,
  totalPrice,
  product,
  quantity,
  customer,
}) {
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
      finish: process.env.MIDTRANS_FINISH_URL || 'https://t.me/',
    },
  }

  const response = await fetch(`${getBaseUrl()}/transactions`, {
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

  return response.json()
}

export async function checkTransactionStatus(orderId) {
  const response = await fetch(`${getApiBase()}/${orderId}/status`, {
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

export function verifyWebhookSignature(notification) {
  const serverKey = getMidtransServerKey()
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
