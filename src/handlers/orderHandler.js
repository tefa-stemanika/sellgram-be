// src/handlers/orderHandler.js

import {
  getAllProducts,
  getProductById,
  formatRupiah,
} from '../services/productService.js'
import { saveOrder, updateOrderPayment } from '../services/orderService.js'
import { createSnapTransaction } from '../services/midtrans.js'
import {
  getOrder,
  setOrder,
  resetOrder,
  ORDER_STATE,
} from '../services/order.js'

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

  // Kirim loading indicator
  await bot.sendChatAction(chatId, 'typing')
  await send(bot, chatId, '⏳ Memproses order dan membuat link pembayaran...')

  try {
    // 1. Simpan order ke database
    const savedOrder = await saveOrder({
      telegramId: msg.from.id,
      username: msg.from.username,
      firstName: msg.from.first_name,
      product: selectedProduct,
      quantity,
    })

    // 2. Buat transaksi Midtrans
    const snapResult = await createSnapTransaction({
      orderId: savedOrder.orderId,
      totalPrice: savedOrder.totalPrice,
      product: selectedProduct,
      quantity,
      customer: { firstName: msg.from.first_name },
    })

    // 3. Simpan payment URL ke database
    await updateOrderPayment(savedOrder.orderId, {
      paymentUrl: snapResult.redirect_url,
      snapToken: snapResult.token,
    })

    // 4. Reset state order user (selesai dari flow)
    resetOrder(userId)

    // 5. Kirim invoice + link pembayaran ke user
    const total = selectedProduct.price * quantity
    const invoice = `✅ *Order Berhasil Dibuat!*

📄 *Detail Order*
━━━━━━━━━━━━━━━━━━━━
🔖 No. Order: \`${savedOrder.orderId}\`
${selectedProduct.emoji} ${selectedProduct.name}
   ${quantity} x ${formatRupiah(selectedProduct.price)}
━━━━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(total)}*
━━━━━━━━━━━━━━━━━━━━

💳 *Silakan lakukan pembayaran:*
${snapResult.redirect_url}

Tersedia: QRIS, GoPay, ShopeePay, Transfer Bank
⏰ Link berlaku 24 jam

Kamu akan otomatis mendapat notifikasi setelah pembayaran berhasil.`

    await send(bot, chatId, invoice)
  } catch (error) {
    console.error('[handleKonfirmasi error]', error.message)
    await send(
      bot,
      chatId,
      '⚠️ Gagal membuat transaksi. Silakan coba lagi atau hubungi admin.',
    )
  }
}

// ── /batal ───────────────────────────────────────────────────────────────────

export async function handleBatal(bot, msg) {
  const chatId = msg.chat.id
  const userId = msg.from.id

  if (getOrder(userId).state === ORDER_STATE.IDLE) {
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

// ── handleOrderStatus ─────────────────────────────────────────────────────────

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
    const total = order.selectedProduct.price * order.quantity
    text += `Jumlah: ${order.quantity}\n`
    text += `Total: *${formatRupiah(total)}*\n`
  }
  if (order.state === ORDER_STATE.CONFIRMING) {
    text += `\nKetik /konfirmasi untuk melanjutkan atau /batal untuk membatalkan.`
  }

  await send(bot, chatId, text)
}

// ── handleOrderInput (flow angka) ─────────────────────────────────────────────

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
        `⚠️ Nomor tidak valid. Masukkan angka 1 sampai ${products.length}.`,
      )
      return true
    }
    const product = await getProductById(num)
    if (!product) {
      await send(bot, chatId, `⚠️ Produk nomor ${num} tidak ditemukan.`)
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
    setOrder(userId, { state: ORDER_STATE.CONFIRMING, quantity: num })

    const summary = `📝 *Ringkasan Order*

${selectedProduct.emoji} ${selectedProduct.name}
   ${num} x ${formatRupiah(selectedProduct.price)}
━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(selectedProduct.price * num)}*

Ketik /konfirmasi untuk lanjut ke pembayaran
Ketik /batal untuk membatalkan`

    await send(bot, chatId, summary)
    return true
  }

  if (order.state === ORDER_STATE.CONFIRMING) {
    await send(
      bot,
      chatId,
      'Gunakan /konfirmasi untuk lanjut ke pembayaran atau /batal untuk membatalkan.',
    )
    return true
  }

  return false
}
