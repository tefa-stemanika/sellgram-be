// src/services/adminBot.js
// Bot Telegram terpisah khusus untuk mengirim notifikasi ke admin.
// Bot ini hanya MENGIRIM pesan — tidak perlu polling/webhook.

import TelegramBot from 'node-telegram-bot-api'
import { formatRupiah } from './productService.js'

let adminBot = null

/**
 * Inisialisasi admin bot. Dipanggil sekali dari index.js.
 * Menggunakan mode { polling: false } karena bot ini hanya kirim pesan, tidak perlu terima.
 */
export function initAdminBot() {
  const token = process.env.ADMIN_BOT_TOKEN

  if (!token) {
    console.warn(
      '⚠️  ADMIN_BOT_TOKEN tidak ditemukan — notifikasi admin dinonaktifkan.',
    )
    return null
  }

  adminBot = new TelegramBot(token, { polling: false })
  console.log('👮 Admin bot siap mengirim notifikasi.')
  return adminBot
}

/**
 * Kirim notifikasi order baru (pembayaran sukses) ke admin.
 * @param {object} order - Order dari database (include orderItems.product)
 * @param {object} notification - Payload dari Midtrans webhook
 */
export async function notifyAdminOrderSuccess(order, notification) {
  if (!adminBot) return

  const adminChatId = process.env.ADMIN_CHAT_ID
  if (!adminChatId) {
    console.warn(
      '⚠️  ADMIN_CHAT_ID tidak ditemukan — notifikasi admin dilewati.',
    )
    return
  }

  const item = order.orderItems[0]
  const paidAt = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
  })
  const paymentMethod = formatPaymentMethod(notification.payment_type)

  const text = `🛎️ *ORDER BARU MASUK!*

━━━━━━━━━━━━━━━━━━━━
📋 *Detail Order*
🔖 No. Order: \`${order.orderId}\`
📅 Waktu Bayar: ${paidAt}
💳 Metode: ${paymentMethod}
━━━━━━━━━━━━━━━━━━━━
${
  item
    ? `${item.product.emoji} *${item.product.name}*
   Jumlah: ${item.quantity} pcs
   Harga satuan: ${formatRupiah(item.unitPrice)}`
    : ''
}
━━━━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(order.totalPrice)}*
━━━━━━━━━━━━━━━━━━━━
👤 *Data Pembeli*
Nama: ${order.firstName || '-'}
Username: ${order.username ? `@${order.username}` : '-'}
Telegram ID: \`${order.telegramId}\`
━━━━━━━━━━━━━━━━━━━━

Segera proses pesanan ini! 🚀`

  try {
    await adminBot.sendMessage(adminChatId, text, { parse_mode: 'Markdown' })
    console.log(
      '[AdminBot] Notifikasi order sukses terkirim ke admin:',
      order.orderId,
    )
  } catch (err) {
    console.error('[AdminBot] Gagal kirim notifikasi ke admin:', err.message)
  }
}

/**
 * Kirim notifikasi pembayaran gagal ke admin (opsional, untuk monitoring).
 * @param {object} order
 */
export async function notifyAdminOrderFailed(order) {
  if (!adminBot) return

  const adminChatId = process.env.ADMIN_CHAT_ID
  if (!adminChatId) return

  const item = order.orderItems[0]

  const text = `⚠️ *Pembayaran Gagal/Expired*

🔖 Order: \`${order.orderId}\`
${item ? `${item.product.emoji} ${item.product.name} x${item.quantity}` : ''}
💵 Total: ${formatRupiah(order.totalPrice)}
👤 ${order.firstName || '-'} ${order.username ? `(@${order.username})` : ''}

Tidak perlu diproses.`

  try {
    await adminBot.sendMessage(adminChatId, text, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[AdminBot] Gagal kirim notif gagal ke admin:', err.message)
  }
}

// ── Helper ───────────────────────────────────────────────────────────────────

function formatPaymentMethod(paymentType) {
  const map = {
    qris: 'QRIS',
    gopay: 'GoPay',
    shopeepay: 'ShopeePay',
    bank_transfer: 'Transfer Bank',
    credit_card: 'Kartu Kredit',
    cstore: 'Minimarket',
    echannel: 'Mandiri Bill',
  }
  return map[paymentType] || paymentType
}
