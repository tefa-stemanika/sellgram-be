// src/services/adminBot.js
// Multi-tenant admin bot management — each user dapat admin bot instance sendiri

import TelegramBot from 'node-telegram-bot-api'
import { formatRupiah } from './productService.js'
import {
  getAdminBotTokenForUser,
  getAdminChatIdForUser,
} from './configService.js'

/**
 * Map<userId, BotInstance>
 * Tracks admin bot instances per tenant user
 */
const adminBots = new Map()

/**
 * Initialize admin bot for a specific user (multi-tenant).
 * Return: BotInstance atau null jika tidak ada token.
 */
export async function initAdminBotForUser(userId) {
  try {
    const token = await getAdminBotTokenForUser(userId)

    if (!token) {
      console.warn(
        `⚠️  ADMIN_BOT_TOKEN tidak ditemukan untuk user ${userId} — notifikasi admin dinonaktifkan.`,
      )
      return null
    }

    const botInstance = new TelegramBot(token, { polling: false })
    adminBots.set(userId, botInstance)
    console.log(
      `👮 Admin bot siap untuk user ${userId} (${adminBots.size} total)`,
    )
    return botInstance
  } catch (err) {
    console.error(
      `[AdminBot] Gagal init admin bot untuk user ${userId}:`,
      err.message,
    )
    return null
  }
}

/**
 * Initialize admin bots untuk semua active users.
 * Dipanggil dari index-m6.js saat startup.
 */
export async function initAllAdminBots(userIds) {
  for (const userId of userIds) {
    try {
      await initAdminBotForUser(userId)
    } catch (err) {
      console.error(`[AdminBot] Gagal init untuk user ${userId}:`, err.message)
    }
  }
  console.log(`✅ Admin bots initialized untuk ${adminBots.size} users`)
}

/**
 * Get admin bot instance untuk specific user.
 */
export function getAdminBotForUser(userId) {
  return adminBots.get(userId) || null
}

/**
 * Notify admin tentang order berhasil (multi-tenant version).
 * userId: pemilik bot (tenant)
 */
export async function notifyAdminOrderSuccessForUser(
  userId,
  order,
  notification,
) {
  const adminBotInstance = getAdminBotForUser(userId)
  if (!adminBotInstance) {
    console.warn(
      `[AdminBot] Tidak ada admin bot untuk user ${userId} — skip notifikasi.`,
    )
    return
  }

  const adminChatId = await getAdminChatIdForUser(userId)
  if (!adminChatId) {
    console.warn(
      `⚠️  ADMIN_CHAT_ID tidak ditemukan untuk user ${userId} — notifikasi dilewati.`,
    )
    return
  }

  const item = order.orderItems?.[0]
  const paidAt = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
  })
  const paymentMethod = formatPaymentMethod(notification?.payment_type)

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
    await adminBotInstance.sendMessage(adminChatId, text, {
      parse_mode: 'Markdown',
    })
    console.log(
      `[AdminBot] Notifikasi order sukses terkirim (user ${userId}):`,
      order.orderId,
    )
  } catch (err) {
    console.error(
      `[AdminBot] Gagal kirim notifikasi (user ${userId}):`,
      err.message,
    )
  }
}

/**
 * Notify admin tentang payment failed (multi-tenant version).
 * userId: pemilik bot (tenant)
 */
export async function notifyAdminOrderFailedForUser(userId, order) {
  const adminBotInstance = getAdminBotForUser(userId)
  if (!adminBotInstance) {
    console.warn(
      `[AdminBot] Tidak ada admin bot untuk user ${userId} — skip notifikasi.`,
    )
    return
  }

  const adminChatId = await getAdminChatIdForUser(userId)
  if (!adminChatId) return

  const item = order.orderItems?.[0]
  const text = `⚠️ *Pembayaran Gagal/Expired*

🔖 Order: \`${order.orderId}\`
${item ? `${item.product.emoji} ${item.product.name} x${item.quantity}` : ''}
💵 Total: ${formatRupiah(order.totalPrice)}
👤 ${order.firstName || '-'} ${order.username ? `(@${order.username})` : ''}

Tidak perlu diproses.`

  try {
    await adminBotInstance.sendMessage(adminChatId, text, {
      parse_mode: 'Markdown',
    })
    console.log(
      `[AdminBot] Notifikasi gagal terkirim (user ${userId}):`,
      order.orderId,
    )
  } catch (err) {
    console.error(
      `[AdminBot] Gagal kirim notif gagal (user ${userId}):`,
      err.message,
    )
  }
}

/**
 * Send arbitrary message to admin via admin bot (multi-tenant).
 * userId: pemilik bot (tenant), text: message content (Markdown).
 * Digunakan oleh stockService.js untuk low stock alert dll.
 */
export async function sendAdminBotMessage(userId, text) {
  const adminBotInstance = getAdminBotForUser(userId)
  if (!adminBotInstance) {
    console.warn(`[AdminBot] No admin bot for user ${userId} — skip message`)
    return
  }
  const adminChatId = await getAdminChatIdForUser(userId)
  if (!adminChatId) {
    console.warn(`[AdminBot] No admin chat id for user ${userId} — skip message`)
    return
  }

  try {
    await adminBotInstance.sendMessage(adminChatId, text, {
      parse_mode: 'Markdown',
    })
  } catch (err) {
    console.error(`[AdminBot] Gagal kirim message (user ${userId}):`, err.message)
  }
}

function formatPaymentMethod(paymentType) {
  const map = {
    qris: 'QRIS',
    gopay: 'GoPay',
    shopeepay: 'ShopeePay',
    bank_transfer: 'Transfer Bank',
    credit_card: 'Kartu Kredit',
  }
  return map[paymentType] || paymentType
}
