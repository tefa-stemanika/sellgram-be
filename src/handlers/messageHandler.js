// src/handlers/messageHandler.js

import { askGemini } from '../services/gemini.js'
import { getHistory, addMessage, clearHistory } from '../services/session.js'
import {
  handleOrderInput,
  handleMenu,
  handlePesan,
  handleKonfirmasi,
  handleBatal,
  handleOrderStatus,
} from './orderHandler.js'

export async function handleStart(bot, msg) {
  const { id: chatId, first_name } = msg.chat
  const text = `👋 Halo, *${first_name}*!

Saya asisten toko online yang siap membantu kamu.
Cukup ketik dengan bahasa natural, misalnya:

• _"Saya mau lihat menu"_
• _"Saya mau pesan nasi goreng"_
• _"Batalkan pesanan saya"_

Atau gunakan perintah: /menu /pesan /help`

  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  } catch {
    await bot.sendMessage(chatId, text)
  }
}

export async function handleHelp(bot, msg) {
  const { id: chatId } = msg.chat
  const text = `🤖 *Bantuan Bot*

Kamu bisa chat natural seperti biasa:
_"Mau lihat menu"_, _"Pesan ayam bakar 2"_, _"Batalkan"_

Atau pakai perintah:
/menu — Lihat daftar produk
/pesan — Mulai order
/konfirmasi — Konfirmasi order
/batal — Batalkan order
/reset — Reset riwayat chat`

  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
  } catch {
    await bot.sendMessage(chatId, text)
  }
}

export async function handleReset(bot, msg) {
  const { id: chatId } = msg.chat
  const userId = msg.from.id
  clearHistory(userId)
  await bot.sendMessage(
    chatId,
    '🔄 Riwayat percakapan dihapus. Mulai dari awal!',
  )
}

export async function handleMessage(bot, msg) {
  const { id: chatId } = msg.chat
  const userId = msg.from.id
  const userText = msg.text

  if (!userText) return

  // Jika user sedang di tengah flow order (memilih produk/qty),
  // tangani dulu sebelum ke AI
  const handledByOrder = await handleOrderInput(bot, msg)
  if (handledByOrder) return

  await bot.sendChatAction(chatId, 'typing')

  try {
    const history = getHistory(userId)
    addMessage(userId, 'user', userText)

    const result = await askGemini(userText, history)

    // ── Gemini memutuskan untuk memanggil sebuah fungsi ──
    if (result.type === 'function_call') {
      await executeFunctionCall(bot, msg, result.name, result.args)
      // Catat ke history sebagai aksi yang dilakukan
      addMessage(userId, 'model', `[Aksi: ${result.name}]`)
      return
    }

    // ── Respons teks biasa ──
    addMessage(userId, 'model', result.text)
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

// ── Mapping function name → handler ─────────────────────────────────────────

async function executeFunctionCall(bot, msg, name, args) {
  console.log(`[FunctionCall] ${name}`, args)

  switch (name) {
    case 'show_menu':
      return handleMenu(bot, msg)

    case 'start_order':
      if (args.product_id) {
        // Gemini berhasil ekstrak produk (dan mungkin quantity) dari pesan natural
        return handlePesanDenganProduk(bot, msg, args.product_id, args.quantity)
      }
      return handlePesan(bot, msg)

    case 'confirm_order':
      return handleKonfirmasi(bot, msg)

    case 'cancel_order':
      return handleBatal(bot, msg)

    case 'get_order_status':
      return handleOrderStatus(bot, msg)

    default:
      console.warn(`[FunctionCall] Unknown function: ${name}`)
  }
}

// Gemini sudah extract product_id (dan opsional quantity) dari natural language.
// Jika quantity juga ada → langsung tampilkan ringkasan konfirmasi.
// Jika quantity belum ada → tanya jumlah ke user.
async function handlePesanDenganProduk(bot, msg, productId, quantity) {
  const { id: chatId } = msg.chat
  const userId = msg.from.id

  const { setOrder, getOrder, resetOrder, generateOrderId, ORDER_STATE } =
    await import('../services/order.js')
  const { getProductById, formatRupiah } = await import('../data/products.js')

  const current = getOrder(userId)
  if (current.state !== ORDER_STATE.IDLE) {
    await bot.sendMessage(
      chatId,
      '⚠️ Kamu masih punya order yang belum selesai. Ketik /batal untuk membatalkan dulu.',
    )
    return
  }

  const product = getProductById(productId)
  if (!product) {
    return handlePesan(bot, msg)
  }

  // ── Kasus lengkap: produk + quantity sudah diketahui ──
  if (
    quantity &&
    Number.isInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 99
  ) {
    const total = product.price * quantity
    setOrder(userId, {
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

  // ── Kasus sebagian: hanya produk, belum ada quantity ──
  setOrder(userId, {
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
