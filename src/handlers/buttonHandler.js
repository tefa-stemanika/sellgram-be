// src/handlers/buttonHandler.js
// Multi-tenant button/callback handler — mendukung multiple users

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

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Edit pesan sebelumnya (teks + hapus keyboard lama).
 * Digunakan untuk "update" tampilan setelah button diklik.
 */
async function editMessage(bot, chatId, messageId, text, keyboard = null) {
  const opts = { parse_mode: 'Markdown' }
  if (keyboard) opts.reply_markup = { inline_keyboard: keyboard }

  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      ...opts,
    })
  } catch {
    // Fallback: kirim pesan baru jika edit gagal (misal pesan terlalu lama)
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    })
  }
}

/**
 * Jawab callback query agar loading spinner di button hilang.
 * Wajib dipanggil di setiap handler, jika tidak button akan "loading" terus.
 */
async function answerCallback(bot, callbackQueryId, text = '') {
  try {
    await bot.answerCallbackQuery(callbackQueryId, { text })
  } catch {
    // Ignore — callback query mungkin sudah expired (>10 menit)
  }
}

// ── Main Dispatcher ──────────────────────────────────────────────────────────

/**
 * Entry point — dipanggil dari index.js saat ada callback_query masuk.
 * Parse action dan payload lalu arahkan ke handler yang sesuai.
 */
export async function handleCallbackQuery(bot, query, userId) {
  const chatId = query.message.chat.id
  const msgId = query.message.message_id
  const telegramId = query.from.id
  const data = query.data || ''

  const [action, ...rest] = data.split(':')
  const payload = rest.join(':') // support payload yang mengandung ":"

  switch (action) {
    case 'show_menu':
      await answerCallback(bot, query.id)
      return showMenuButtons(bot, chatId, msgId, userId)

    case 'select_product':
      await answerCallback(bot, query.id)
      return handleSelectProduct(
        bot,
        chatId,
        msgId,
        userId,
        telegramId,
        payload,
      )

    case 'select_qty':
      await answerCallback(bot, query.id)
      return handleSelectQty(
        bot,
        chatId,
        msgId,
        userId,
        telegramId,
        parseInt(payload),
      )

    case 'custom_qty':
      await answerCallback(bot, query.id, 'Ketik jumlah yang kamu inginkan')
      return handleAskCustomQty(bot, chatId, userId, telegramId)

    case 'confirm_order':
      await answerCallback(bot, query.id, '⏳ Memproses...')
      return handleConfirmOrder(
        bot,
        chatId,
        msgId,
        userId,
        telegramId,
        query.from,
      )

    case 'cancel_order':
      await answerCallback(bot, query.id, 'Order dibatalkan')
      return handleCancelOrder(bot, chatId, msgId, userId, telegramId)

    case 'back_to_menu':
      await answerCallback(bot, query.id)
      return showMenuButtons(bot, chatId, msgId, userId)

    default:
      await answerCallback(bot, query.id, 'Aksi tidak dikenal')
  }
}

// ── Menu dengan Button ────────────────────────────────────────────────────────

export async function showMenuButtons(bot, chatId, editMsgId = null, userId) {
  const products = await getAllProducts(userId)

  if (products.length === 0) {
    const text = '⚠️ Belum ada produk tersedia saat ini.'
    if (editMsgId) return editMessage(bot, chatId, editMsgId, text)
    return bot.sendMessage(chatId, text)
  }

  let text = '🍽️ *MENU KAMI*\n\n'
  products.forEach((p) => {
    text += `${p.emoji} *${p.name}*\n`
    text += `    ${p.description}\n`
    text += `    💰 ${formatRupiah(p.price)}\n\n`
  })
  text += 'Pilih produk di bawah untuk memesan:'

  // Buat tombol grid produk — maksimal 2 per baris
  const productButtons = []
  for (let i = 0; i < products.length; i += 2) {
    const row = [
      {
        text: `${products[i].emoji} ${products[i].name}`,
        callback_data: `select_product:${products[i].id}`,
      },
    ]
    if (products[i + 1]) {
      row.push({
        text: `${products[i + 1].emoji} ${products[i + 1].name}`,
        callback_data: `select_product:${products[i + 1].id}`,
      })
    }
    productButtons.push(row)
  }

  const keyboard = productButtons
  const opts = {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  }

  if (editMsgId) {
    return editMessage(bot, chatId, editMsgId, text, keyboard)
  }
  return bot.sendMessage(chatId, text, opts)
}

// ── Pilih Produk ──────────────────────────────────────────────────────────────

async function handleSelectProduct(
  bot,
  chatId,
  msgId,
  userId,
  telegramId,
  productId,
) {
  const current = getOrder(userId, telegramId)

  // Jika sudah ada order berjalan, tanya dulu
  if (current.state !== ORDER_STATE.IDLE) {
    const keyboard = [
      [
        { text: '❌ Batalkan order lama', callback_data: 'cancel_order' },
        { text: '↩️ Kembali', callback_data: 'back_to_menu' },
      ],
    ]
    return editMessage(
      bot,
      chatId,
      msgId,
      '⚠️ Kamu masih punya order yang belum selesai.\nBatalkan dulu atau selesaikan order sebelumnya.',
      keyboard,
    )
  }

  const product = await getProductById(userId, productId)
  if (!product) {
    return editMessage(
      bot,
      chatId,
      msgId,
      '⚠️ Produk tidak ditemukan. Silakan pilih lagi.',
      [[{ text: '↩️ Kembali ke Menu', callback_data: 'back_to_menu' }]],
    )
  }

  setOrder(userId, telegramId, {
    state: ORDER_STATE.SELECTING_QTY,
    selectedProduct: product,
  })

  const text = `${product.emoji} *${product.name}*\n💰 ${formatRupiah(product.price)}\n\nPilih jumlah:`

  // Tombol jumlah cepat: 1–5, + tombol angka lain
  const keyboard = [
    [
      { text: '1', callback_data: `select_qty:1` },
      { text: '2', callback_data: `select_qty:2` },
      { text: '3', callback_data: `select_qty:3` },
      { text: '4', callback_data: `select_qty:4` },
      { text: '5', callback_data: `select_qty:5` },
    ],
    [
      { text: '✏️ Jumlah lain...', callback_data: 'custom_qty' },
      { text: '↩️ Kembali', callback_data: 'back_to_menu' },
    ],
  ]

  return editMessage(bot, chatId, msgId, text, keyboard)
}

// ── Pilih Jumlah ──────────────────────────────────────────────────────────────

async function handleSelectQty(bot, chatId, msgId, userId, telegramId, qty) {
  const order = getOrder(userId, telegramId)

  if (order.state !== ORDER_STATE.SELECTING_QTY || !order.selectedProduct) {
    return editMessage(
      bot,
      chatId,
      msgId,
      '⚠️ Sesi order tidak valid. Silakan mulai lagi.',
      [[{ text: '↩️ Kembali ke Menu', callback_data: 'back_to_menu' }]],
    )
  }

  if (!qty || qty < 1 || qty > 99) {
    return editMessage(bot, chatId, msgId, '⚠️ Jumlah tidak valid.', [
      [
        {
          text: '↩️ Kembali',
          callback_data: `select_product:${order.selectedProduct.id}`,
        },
      ],
    ])
  }

  const { selectedProduct } = order
  const total = selectedProduct.price * qty
  setOrder(userId, telegramId, { state: ORDER_STATE.CONFIRMING, quantity: qty })

  const summary = `📝 *Ringkasan Order*

${selectedProduct.emoji} ${selectedProduct.name}
   ${qty} x ${formatRupiah(selectedProduct.price)}
━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(total)}*`

  const keyboard = [
    [{ text: '✅ Konfirmasi & Bayar', callback_data: 'confirm_order' }],
    [
      {
        text: '✏️ Ganti jumlah',
        callback_data: `select_product:${selectedProduct.id}`,
      },
      { text: '❌ Batal', callback_data: 'cancel_order' },
    ],
  ]

  return editMessage(bot, chatId, msgId, summary, keyboard)
}

// ── Input Jumlah Custom (via teks) ────────────────────────────────────────────

async function handleAskCustomQty(bot, chatId, userId, telegramId) {
  // Set flag di state agar handleOrderInput tahu user sedang input qty custom
  const order = getOrder(userId, telegramId)
  if (order.state === ORDER_STATE.SELECTING_QTY) {
    setOrder(userId, telegramId, { awaitingCustomQty: true })
  }

  await bot.sendMessage(chatId, 'Ketik jumlah yang kamu inginkan (1–99):', {
    reply_markup: { force_reply: true, selective: true },
  })
}

// ── Konfirmasi Order → Buat Transaksi Midtrans ────────────────────────────────

async function handleConfirmOrder(
  bot,
  chatId,
  msgId,
  userId,
  telegramId,
  fromUser,
) {
  const order = getOrder(userId, telegramId)

  if (order.state !== ORDER_STATE.CONFIRMING) {
    return editMessage(
      bot,
      chatId,
      msgId,
      '⚠️ Tidak ada order yang perlu dikonfirmasi.',
      [[{ text: '↩️ Kembali ke Menu', callback_data: 'back_to_menu' }]],
    )
  }

  const { selectedProduct, quantity } = order

  // Tampilkan loading state di pesan
  await editMessage(
    bot,
    chatId,
    msgId,
    '⏳ Memproses order dan membuat link pembayaran...',
  )

  try {
    const savedOrder = await saveOrder({
      userId,
      telegramId: fromUser.id,
      username: fromUser.username,
      firstName: fromUser.first_name,
      product: selectedProduct,
      quantity,
    })

    const snapResult = await createSnapTransaction({
      userId,
      orderId: savedOrder.orderId,
      totalPrice: savedOrder.totalPrice,
      product: selectedProduct,
      quantity,
      customer: { firstName: fromUser.first_name },
    })

    await updateOrderPayment(userId, savedOrder.orderId, {
      paymentUrl: snapResult.redirect_url,
      snapToken: snapResult.token,
    })

    resetOrder(userId, telegramId)

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

Tersedia: QRIS, GoPay, ShopeePay, Transfer Bank
⏰ Link berlaku 24 jam`

    // Tombol langsung ke halaman pembayaran
    const keyboard = [
      [{ text: '💳 Bayar Sekarang', url: snapResult.redirect_url }],
      [{ text: '🍽️ Pesan Lagi', callback_data: 'back_to_menu' }],
    ]

    await editMessage(bot, chatId, msgId, invoice, keyboard)
  } catch (error) {
    console.error('[handleConfirmOrder button error]', error.message)
    await editMessage(
      bot,
      chatId,
      msgId,
      '⚠️ Gagal membuat transaksi. Silakan coba lagi.',
      [
        [{ text: '🔄 Coba Lagi', callback_data: 'confirm_order' }],
        [{ text: '❌ Batal', callback_data: 'cancel_order' }],
      ],
    )
  }
}

// ── Batal Order ───────────────────────────────────────────────────────────────

async function handleCancelOrder(bot, chatId, msgId, userId, telegramId) {
  resetOrder(userId, telegramId)

  const keyboard = [[{ text: '🍽️ Lihat Menu', callback_data: 'back_to_menu' }]]

  return editMessage(bot, chatId, msgId, '❌ Order dibatalkan.', keyboard)
}

// ── Handler input teks saat awaiting custom qty ───────────────────────────────

/**
 * Dipanggil dari messageHandler saat user mengetik angka
 * setelah menekan tombol "Jumlah lain..."
 *
 * @returns {boolean} true jika ditangani di sini
 */
export async function handleCustomQtyInput(bot, msg, userId) {
  const chatId = msg.chat.id
  const telegramId = msg.from.id
  const order = getOrder(userId, telegramId)

  if (order.state !== ORDER_STATE.SELECTING_QTY || !order.awaitingCustomQty) {
    return false
  }

  const num = parseInt(msg.text?.trim(), 10)

  if (isNaN(num) || num < 1 || num > 99) {
    await bot.sendMessage(
      chatId,
      '⚠️ Jumlah tidak valid. Masukkan angka 1 sampai 99.',
    )
    return true
  }

  // Reset flag lalu lanjutkan seperti pilih qty normal
  setOrder(userId, telegramId, { awaitingCustomQty: false })

  const { selectedProduct } = order
  const total = selectedProduct.price * num
  setOrder(userId, telegramId, { state: ORDER_STATE.CONFIRMING, quantity: num })

  const summary = `📝 *Ringkasan Order*

${selectedProduct.emoji} ${selectedProduct.name}
   ${num} x ${formatRupiah(selectedProduct.price)}
━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(total)}*`

  const keyboard = [
    [{ text: '✅ Konfirmasi & Bayar', callback_data: 'confirm_order' }],
    [
      {
        text: '✏️ Ganti jumlah',
        callback_data: `select_product:${selectedProduct.id}`,
      },
      { text: '❌ Batal', callback_data: 'cancel_order' },
    ],
  ]

  await bot.sendMessage(chatId, summary, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard },
  })

  return true
}
