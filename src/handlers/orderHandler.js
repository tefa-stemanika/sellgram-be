// src/handlers/orderHandler.js

import {
  getAllProducts,
  getProductById,
  formatRupiah,
} from '../services/productService.js'
import { saveOrder } from '../services/orderService.js'
import {
  getOrder,
  setOrder,
  resetOrder,
  ORDER_STATE,
} from '../services/order.js'

// Helper: kirim pesan dengan fallback plain text
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

  const products = await getAllProducts()

  if (products.length === 0) {
    await send(bot, chatId, '⚠️ Belum ada produk tersedia saat ini.')
    return
  }

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

  const products = await getAllProducts()
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

  try {
    // Simpan ke database
    const savedOrder = await saveOrder({
      telegramId: msg.from.id,
      username: msg.from.username,
      firstName: msg.from.first_name,
      product: selectedProduct,
      quantity,
    })

    const total = selectedProduct.price * quantity
    const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })

    const invoice = `✅ *ORDER BERHASIL!*

📄 *Invoice*
━━━━━━━━━━━━━━━━━━━━
🔖 No. Order: \`${savedOrder.orderId}\`
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
  } catch (error) {
    console.error('[saveOrder error]', error.message)
    await send(bot, chatId, '⚠️ Gagal menyimpan order. Silakan coba lagi.')
  }
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

// ── handleOrderStatus ────────────────────────────────────────────────────────

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

  let text = `📋 *Status Order Kamu*\n\nStatus: ${stateLabel[order.state] || order.state}\n`

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

// ── Handler input angka saat flow order aktif ────────────────────────────────

export async function handleOrderInput(bot, msg) {
  const chatId = msg.chat.id
  const userId = msg.from.id
  const order = getOrder(userId)
  const input = msg.text?.trim()

  if (order.state === ORDER_STATE.IDLE) return false

  const num = parseInt(input, 10)

  if (order.state === ORDER_STATE.SELECTING_PRODUCT) {
    const products = await getAllProducts()

    if (isNaN(num) || num < 1) {
      await send(
        bot,
        chatId,
        `⚠️ Nomor produk tidak valid. Masukkan angka 1 sampai ${products.length}.`,
      )
      return true
    }

    const product = await getProductById(num)
    if (!product) {
      await send(bot, chatId, `⚠️ Produk dengan nomor ${num} tidak ditemukan.`)
      return true
    }

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
