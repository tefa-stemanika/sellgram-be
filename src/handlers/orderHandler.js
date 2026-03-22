// src/handlers/orderHandler.js

import { products, getProductById, formatRupiah } from '../data/products.js'
import {
  getOrder,
  setOrder,
  resetOrder,
  generateOrderId,
  ORDER_STATE,
} from '../services/order.js'

// Helper: kirim pesan — coba Markdown, fallback plain text
async function send(bot, chatId, text) {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  } catch {
    await bot.sendMessage(chatId, text)
  }
}

// ── /menu ────────────────────────────────────────────────────────────────────

export async function handleMenu(bot, msg) {
  const chatId = msg.chat.id

  let text = '🍽️ *MENU KAMI*\n\n'
  products.forEach((p) => {
    text += `${p.emoji} *${p.id}. ${p.name}*\n`
    text += `    ${p.description}\n`
    text += `    💰 ${formatRupiah(p.price)}\n\n`
  })
  text += 'Ketik /pesan untuk mulai memesan.'

  await send(bot, chatId, text)
}

// ── /pesan ───────────────────────────────────────────────────────────────────

export async function handlePesan(bot, msg) {
  const chatId = msg.chat.id
  const userId = msg.from.id

  const current = getOrder(userId)
  if (current.state !== ORDER_STATE.IDLE) {
    await send(
      bot,
      chatId,
      '⚠️ Kamu masih punya order yang belum selesai. Gunakan /batal untuk membatalkan terlebih dahulu.',
    )
    return
  }

  setOrder(userId, { state: ORDER_STATE.SELECTING_PRODUCT })

  let text = '📋 *Pilih produk yang ingin dipesan:*\n\n'
  products.forEach((p) => {
    text += `*${p.id}.* ${p.emoji} ${p.name} — ${formatRupiah(p.price)}\n`
  })
  text += '\nKetik *nomor produk* (contoh: `1`)'

  await send(bot, chatId, text)
}

// ── /konfirmasi ──────────────────────────────────────────────────────────────

export async function handleKonfirmasi(bot, msg) {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const order = getOrder(userId)

  if (order.state !== ORDER_STATE.CONFIRMING) {
    await send(bot, chatId, '⚠️ Tidak ada order yang perlu dikonfirmasi.')
    return
  }

  const { selectedProduct, quantity } = order
  const total = selectedProduct.price * quantity
  const orderId = generateOrderId()
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })

  const invoice = `✅ *ORDER BERHASIL!*

📄 *Invoice*
━━━━━━━━━━━━━━━━━━━━
🔖 No. Order: \`${orderId}\`
📅 Waktu: ${now}
━━━━━━━━━━━━━━━━━━━━
${selectedProduct.emoji} ${selectedProduct.name}
   ${quantity} x ${formatRupiah(selectedProduct.price)}
━━━━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(total)}*
━━━━━━━━━━━━━━━━━━━━

🙏 Terima kasih atas pesananmu!
Pesananmu sedang diproses.

Ketik /menu untuk memesan lagi.`

  await send(bot, chatId, invoice)
  resetOrder(userId)
}

// ── /batal ───────────────────────────────────────────────────────────────────

export async function handleBatal(bot, msg) {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const order = getOrder(userId)

  if (order.state === ORDER_STATE.IDLE) {
    await send(bot, chatId, 'ℹ️ Tidak ada order yang sedang berjalan.')
    return
  }

  resetOrder(userId)
  await send(
    bot,
    chatId,
    '❌ Order dibatalkan.\n\nKetik /menu untuk melihat menu kami.',
  )
}

// ── Handler input angka saat proses order ────────────────────────────────────

export async function handleOrderInput(bot, msg) {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const order = getOrder(userId)
  const input = msg.text?.trim()

  if (order.state === ORDER_STATE.IDLE) return false

  const num = parseInt(input, 10)

  if (order.state === ORDER_STATE.SELECTING_PRODUCT) {
    if (isNaN(num) || num < 1 || num > products.length) {
      await send(
        bot,
        chatId,
        `⚠️ Nomor produk tidak valid. Masukkan angka 1 sampai ${products.length}.`,
      )
      return true
    }

    const product = getProductById(num)
    setOrder(userId, {
      state: ORDER_STATE.SELECTING_QTY,
      selectedProduct: product,
    })

    await send(
      bot,
      chatId,
      `${product.emoji} *${product.name}*\n💰 ${formatRupiah(product.price)}\n\nMau pesan berapa? (contoh: \`2\`)`,
    )
    return true
  }

  if (order.state === ORDER_STATE.SELECTING_QTY) {
    if (isNaN(num) || num < 1 || num > 99) {
      await send(
        bot,
        chatId,
        '⚠️ Jumlah tidak valid. Masukkan angka 1 sampai 99.',
      )
      return true
    }

    const { selectedProduct } = order
    const total = selectedProduct.price * num
    setOrder(userId, { state: ORDER_STATE.CONFIRMING, quantity: num })

    const summary = `📝 *Ringkasan Order*

${selectedProduct.emoji} ${selectedProduct.name}
   ${num} x ${formatRupiah(selectedProduct.price)}
━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(total)}*

Ketik /konfirmasi untuk melanjutkan
Ketik /batal untuk membatalkan`

    await send(bot, chatId, summary)
    return true
  }

  if (order.state === ORDER_STATE.CONFIRMING) {
    await send(
      bot,
      chatId,
      'Gunakan /konfirmasi untuk melanjutkan atau /batal untuk membatalkan.',
    )
    return true
  }

  return false
}

// ── handleOrderStatus (dipanggil via function calling) ───────────────────────

export async function handleOrderStatus(bot, msg) {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const order = getOrder(userId)

  if (order.state === ORDER_STATE.IDLE) {
    await send(
      bot,
      chatId,
      'ℹ️ Kamu belum punya order yang sedang berjalan.\n\nKetik /menu untuk melihat produk kami.',
    )
    return
  }

  const stateLabel = {
    [ORDER_STATE.SELECTING_PRODUCT]: 'Memilih produk',
    [ORDER_STATE.SELECTING_QTY]: `Memilih jumlah untuk: ${order.selectedProduct?.name || ''}`,
    [ORDER_STATE.CONFIRMING]: 'Menunggu konfirmasi',
  }

  let text = `📋 *Status Order Kamu*\n\n`
  text += `Status: ${stateLabel[order.state] || order.state}\n`

  if (order.selectedProduct) {
    text += `Produk: ${order.selectedProduct.emoji} ${order.selectedProduct.name}\n`
    text += `Harga: ${formatRupiah(order.selectedProduct.price)}\n`
  }
  if (order.quantity) {
    text += `Jumlah: ${order.quantity}\n`
    text += `Total: *${formatRupiah(order.selectedProduct.price * order.quantity)}*\n`
  }

  if (order.state === ORDER_STATE.CONFIRMING) {
    text += `\nKetik /konfirmasi untuk melanjutkan atau /batal untuk membatalkan.`
  }

  await send(bot, chatId, text)
}
