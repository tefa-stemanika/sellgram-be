import { getHistory, addMessage, clearHistory } from '../services/session.js'
import { isAiEnabledForUser, askAI } from '../services/aiProvider.js'
import { redisSetNx } from '../services/redis.js'
import {
  handleOrderInput,
  handleMenu,
  handlePesan,
  handleKonfirmasi,
  handleBatal,
  handleOrderStatus,
} from './orderHandler.js'
import { handleCustomQtyInput } from './buttonHandler.js'

// ── /start ───────────────────────────────────────────────────────────────────

export async function handleStart(bot, msg, userId) {
  const { id: chatId, first_name } = msg.chat

  const dedupKey = `welcome_sent:${userId}:${chatId}`
  const acquired = await redisSetNx(dedupKey, '1', 86400)
  if (!acquired) return

  let text, keyboard

  const aiEnabled = await isAiEnabledForUser(userId)

  if (aiEnabled) {
    text = `👋 Halo, *${first_name}*!

Saya asisten toko online yang siap membantu kamu.
Cukup ketik dengan bahasa natural, misalnya:

• _"Saya mau lihat menu"_
• _"Saya mau pesan nasi goreng 2"_
• _"Batalkan pesanan saya"_

Atau gunakan tombol di bawah:`

    keyboard = {
      inline_keyboard: [
        [{ text: '🍽️ Lihat Menu', callback_data: 'show_menu' }],
        [{ text: '❓ Bantuan', callback_data: 'show_help' }],
      ],
    }
  } else {
    text = `👋 Halo, *${first_name}*!

Selamat datang di toko kami.
Gunakan tombol di bawah untuk mulai:`

    keyboard = {
      inline_keyboard: [
        [{ text: '🍽️ Lihat Menu & Pesan', callback_data: 'show_menu' }],
        [{ text: '❓ Bantuan', callback_data: 'show_help' }],
      ],
    }
  }

  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    })
  } catch {
    await bot.sendMessage(chatId, text)
  }
}

// ── /help ─────────────────────────────────────────────────────────────────────

export async function handleHelp(bot, msg, userId) {
  const { id: chatId } = msg.chat

  let text

  const aiEnabled = await isAiEnabledForUser(userId)

  if (aiEnabled) {
    text = `🤖 *Bantuan Bot*

Kamu bisa chat natural seperti biasa:
_"Mau lihat menu"_, _"Pesan ayam bakar 2"_, _"Batalkan"_

Atau pakai perintah:
/menu — Lihat daftar produk
/pesan — Mulai order
/konfirmasi — Konfirmasi order
/batal — Batalkan order
/reset — Reset riwayat chat`
  } else {
    text = `🤖 *Bantuan Bot*

Gunakan tombol yang muncul di setiap langkah untuk melakukan order.

Perintah tersedia:
/menu — Lihat menu & mulai order
/batal — Batalkan order yang sedang berjalan
/start — Kembali ke menu utama`
  }

  const keyboard = {
    inline_keyboard: [[{ text: '🍽️ Lihat Menu', callback_data: 'show_menu' }]],
  }

  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    })
  } catch {
    await bot.sendMessage(chatId, text)
  }
}

// ── /reset ────────────────────────────────────────────────────────────────────

export async function handleReset(bot, msg, userId) {
  const { id: chatId } = msg.chat
  const telegramId = msg.from.id
  await clearHistory(userId, telegramId)
  await bot.sendMessage(
    chatId,
    '🔄 Riwayat percakapan dihapus. Mulai dari awal!',
  )
}

// ── Handler pesan teks ────────────────────────────────────────────────────────

export async function handleMessage(bot, msg, userId) {
  const { id: chatId } = msg.chat
  const telegramId = msg.from.id
  const userText = msg.text

  if (!userText) return

  const aiEnabled = await isAiEnabledForUser(userId)

  // ── Mode tanpa AI: hanya tangani input teks yang relevan dengan flow order ──
  if (!aiEnabled) {
    // Cek custom qty input (setelah user tekan "Jumlah lain...")
    const handledByCustomQty = await handleCustomQtyInput(bot, msg, userId)
    if (handledByCustomQty) return

    // Cek input angka saat flow order aktif (fallback jika user ketik manual)
    const handledByOrder = await handleOrderInput(bot, msg, userId)
    if (handledByOrder) return

    // Teks lain di luar flow order — arahkan ke menu
    await bot.sendMessage(chatId, 'Gunakan tombol di bawah untuk memesan:', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🍽️ Lihat Menu & Pesan', callback_data: 'show_menu' }],
        ],
      },
    })
    return
  }

  // ── Mode AI: proses natural language dengan OpenRouter ────────────────────
  // AI handle semua input natural — skip handleOrderInput biar AI yang proses
  await bot.sendChatAction(chatId, 'typing')

  try {
    const history = await getHistory(userId, telegramId)
    await addMessage(userId, telegramId, 'user', userText)

    const result = await askAI(userText, userId, history)

    if (result.type === 'function_call') {
      await executeFunctionCall(bot, msg, userId, result.name, result.args)
      await addMessage(userId, telegramId, 'model', `[Aksi: ${result.name}]`)
      return
    }

    await addMessage(userId, telegramId, 'model', result.text)
    try {
      await bot.sendMessage(chatId, result.text, { parse_mode: 'Markdown' })
    } catch {
      await bot.sendMessage(chatId, result.text)
    }
  } catch (error) {
    console.error(`[Error] userId=${userId}:`, error.message)
    await bot.sendMessage(
      chatId,
      '⚠️ Maaf, terjadi kesalahan. Silakan coba lagi.',
    )
  }
}

// ── Function call dispatcher (AI mode only) ───────────────────────────────────

async function executeFunctionCall(bot, msg, userId, name, args) {
  console.log(`[FunctionCall] userId=${userId} ${name}`, args)

  switch (name) {
    case 'show_menu':
      return handleMenu(bot, msg, userId)
    case 'start_order':
      if (args.product_id) {
        return handlePesanDenganProduk(
          bot,
          msg,
          userId,
          args.product_id,
          args.quantity,
        )
      }
      const { getAllProducts, formatRupiah } = await import(
        '../services/productService.js'
      )
      const { products } = await getAllProducts(userId)
      const list = products
        .map(
          (p) =>
            `${p.emoji} ${p.name} — ${formatRupiah(p.price)}\n   ${p.description}`,
        )
        .join('\n\n')
      await bot.sendMessage(
        chatId,
        `Dengan senang hati! Mau pesan yang mana, kak? 😊\n\n${list}`,
        { parse_mode: 'Markdown' },
      )
      return
    case 'confirm_order':
      return handleKonfirmasi(bot, msg, userId)
    case 'cancel_order':
      return handleBatal(bot, msg, userId)
    case 'get_order_status':
      return handleOrderStatus(bot, msg, userId)
    default:
      console.warn(`[FunctionCall] Unknown function: ${name}`)
  }
}

async function handlePesanDenganProduk(bot, msg, userId, productId, quantity) {
  const { id: chatId } = msg.chat
  const telegramId = msg.from.id

  const { setOrder, getOrder, ORDER_STATE } = await import(
    '../services/order.js'
  )
  const { getProductById, getAllProducts, formatRupiah } = await import(
    '../services/productService.js'
  )

  const current = await getOrder(userId, telegramId)
  if (current.state !== ORDER_STATE.IDLE) {
    await bot.sendMessage(
      chatId,
      '⚠️ Kamu masih punya order yang belum selesai. Ketik /batal untuk membatalkan dulu.',
    )
    return
  }

  let product
  if (typeof productId === 'number' || !Number.isNaN(Number(productId))) {
    const { products } = await getAllProducts(userId)
    product = products[Number(productId) - 1]
  } else {
    product = await getProductById(userId, productId)
  }
  if (!product) {
    const allProducts = await getAllProducts(userId)
    const list = allProducts.products
      .map(
        (p) =>
          `${p.emoji} ${p.name} — ${formatRupiah(p.price)}\n   ${p.description}`,
      )
      .join('\n\n')
    await bot.sendMessage(
      chatId,
      `Maaf kak, produk yang dimaksud nggak ketemu. Yang tersedia:\n\n${list}\n\nMau pesan yang mana?`,
      { parse_mode: 'Markdown' },
    )
    return
  }

  if (
    quantity &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 99
  ) {
    const total = product.price * quantity
    await setOrder(userId, telegramId, {
      state: ORDER_STATE.CONFIRMING,
      selectedProduct: product,
      quantity,
    })

    const summary = `📝 *Ringkasan Order*

${product.emoji} ${product.name}
   ${quantity} x ${formatRupiah(product.price)}
━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(total)}*

Ketik /konfirmasi untuk melanjutkan
Ketik /batal untuk membatalkan`

    try {
      await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' })
    } catch {
      await bot.sendMessage(chatId, summary)
    }
    return
  }

  await setOrder(userId, telegramId, {
    state: ORDER_STATE.SELECTING_QTY,
    selectedProduct: product,
  })

  const text = `${product.emoji} *${product.name}*\n💰 ${formatRupiah(product.price)}\n\nMau pesan berapa? (contoh: \`2\`)`
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  } catch {
    await bot.sendMessage(chatId, text)
  }
}
