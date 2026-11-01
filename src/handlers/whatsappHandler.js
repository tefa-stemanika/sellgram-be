// src/handlers/whatsappHandler.js
// Percakapan bot WhatsApp (Evolution API).
// Reuse service order, product, session, dan AI yang sama dengan bot Telegram.

import prisma from '../services/db.js'
import {
  getAllProducts,
  getProductById,
  formatRupiah,
} from '../services/productService.js'
import {
  saveOrder,
  updateOrderPayment,
  updateOrderStatus,
} from '../services/orderService.js'
import { createSnapTransaction } from '../services/midtrans.js'
import { validateStock } from '../services/stockService.js'
import { assertMonthlyOrderLimit } from '../services/planLimitService.js'
import {
  getOrder,
  setOrder,
  resetOrder,
  ORDER_STATE,
} from '../services/order.js'
import { getHistory, addMessage, clearHistory } from '../services/session.js'
import { isAiEnabledForUser, askAI } from '../services/aiProvider.js'
import { getWhatsAppClientForUser } from '../services/evolution.js'
import { extractPhoneFromJid, maskChatId } from '../services/whatsappJid.js'
import { safeEmoji, safePlainText } from '../services/safeText.js'
import { redisSetNx } from '../services/redis.js'

const MAX_PRODUCTS_IN_MENU = 100
const WELCOME_DEDUP_TTL_SECONDS = 60 * 60 * 24

// ── Helpers ──────────────────────────────────────────────────────────────────

function unwrapMessage(message) {
  const wrappers = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage',
  ]

  let current = message
  // Wrapper bisa bersarang (editedMessage → ephemeralMessage → ...), jadi
  // ulangi sampai tidak ada wrapper tersisa.
  for (let depth = 0; depth < 5; depth += 1) {
    const key = wrappers.find((name) => current?.[name]?.message)
    if (!key) break
    current = current[key].message
  }

  return current || {}
}

/**
 * Ambil konten yang bisa diproses dari payload messages.upsert Evolution.
 * Bot hanya menerima teks; pesan interaktif (list/button) sudah tidak dipakai.
 */
export function extractWhatsAppMessage(data) {
  const message = unwrapMessage(data?.message)

  if (typeof message.conversation === 'string' && message.conversation.trim()) {
    return { kind: 'text', text: message.conversation.trim() }
  }

  if (message.extendedTextMessage?.text?.trim()) {
    return { kind: 'text', text: message.extendedTextMessage.text.trim() }
  }

  const caption =
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption

  if (caption?.trim()) {
    return { kind: 'text', text: caption.trim() }
  }

  if (data?.messageType) {
    return { kind: 'unsupported', type: data.messageType }
  }

  return null
}

export function buildProductListText(products) {
  if (!Array.isArray(products) || products.length === 0) return null

  const visible = products.slice(0, MAX_PRODUCTS_IN_MENU)
  const lines = visible.map(
    (product, index) =>
      `${index + 1}. ${safeEmoji(product.emoji)} ${safePlainText(product.name, 80)} — ${formatRupiah(product.price)}`,
  )

  return `🛍️ *Menu Produk*\n\n${lines.join('\n')}\n\nKetik nomor produk untuk memesan.`
}

// Perintah yang membuat/membatalkan transaksi hanya diterima dengan prefix
// "/" agar kalimat biasa ("bayar nanti", "reset dulu") tidak memicu aksi.
const SLASH_ONLY_COMMANDS = {
  konfirmasi: 'confirm',
  confirm: 'confirm',
  reset: 'reset',
}

const OPEN_COMMANDS = {
  start: 'start',
  mulai: 'start',
  menu: 'menu',
  help: 'help',
  bantuan: 'help',
  pesan: 'order',
  order: 'order',
  batal: 'cancel',
  cancel: 'cancel',
  status: 'status',
}

export function parseCommand(text) {
  const normalized = String(text || '').trim().toLowerCase()
  if (!normalized) return null

  const [first] = normalized.split(/\s+/)
  const word = first.startsWith('/') ? first.slice(1) : first
  if (!word) return null

  if (first.startsWith('/')) {
    return SLASH_ONLY_COMMANDS[word] || OPEN_COMMANDS[word] || null
  }

  return OPEN_COMMANDS[word] || null
}

// AI dan balasan internal memakai Markdown gaya Telegram; WhatsApp memakai
// penanda tunggal. Tautan [teks](url) ditulis ulang karena tidak dirender.
function toWhatsAppText(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/~~(.+?)~~/g, '~$1~')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
}

async function getAvailableProducts(userId) {
  const { products } = await getAllProducts(userId, {
    limit: MAX_PRODUCTS_IN_MENU,
  })
  return products.filter((product) => product.isAvailable)
}

async function sendText(ctx, chatId, text, options = {}) {
  try {
    return await ctx.client.sendText(chatId, text, options)
  } catch (error) {
    if (String(chatId || '').endsWith('@lid')) {
      error.message = `${error.message} — JID @lid tidak didukung server Evolution ini; upgrade ke >= 2.3.x agar remoteJidAlt tersedia.`
    }
    throw error
  }
}

/**
 * Menu baru berarti mulai ulang alur: state lama harus dibersihkan supaya
 * angka yang diketik pelanggan tidak diarahkan ke langkah sebelumnya.
 */
async function resetActiveOrder(ctx, userId, chatId) {
  const current = await getOrder(userId, chatId)
  if (current.state === ORDER_STATE.IDLE) return

  await resetOrder(userId, chatId)
  await sendText(ctx, chatId, '🔄 Order sebelumnya dibatalkan, silakan pilih ulang.')
}

async function sendProductList(ctx, userId, chatId) {
  const products = await getAvailableProducts(userId)

  if (products.length === 0) {
    await sendText(ctx, chatId, '⚠️ Belum ada produk tersedia saat ini.')
    return
  }

  const order = await getOrder(userId, chatId)
  if (order.state === ORDER_STATE.IDLE) {
    await setOrder(userId, chatId, {
      state: ORDER_STATE.SELECTING_PRODUCT,
      awaitingCustomQty: false,
    })
  }

  await sendText(ctx, chatId, buildProductListText(products))
}

async function sendQuantityList(ctx, userId, chatId, product) {
  await setOrder(userId, chatId, {
    state: ORDER_STATE.SELECTING_QTY,
    selectedProduct: product,
    quantity: 0,
    awaitingCustomQty: false,
  })

  const lines = [1, 2, 3, 4, 5].map(
    (qty) => `${qty}. ${qty} x ${formatRupiah(product.price)}`,
  )

  await sendText(
    ctx,
    chatId,
    `📦 *Pilih Jumlah*\n\n${safeEmoji(product.emoji)} ${safePlainText(product.name, 80)} — ${formatRupiah(product.price)}\n\n${lines.join('\n')}\n\nKetik angka 1–99 untuk jumlah.`,
  )
}

async function sendConfirmationList(ctx, userId, chatId) {
  const order = await getOrder(userId, chatId)
  if (order.state !== ORDER_STATE.CONFIRMING || !order.selectedProduct) {
    await sendText(ctx, chatId, '⚠️ Tidak ada order yang perlu dikonfirmasi.')
    return
  }

  const { selectedProduct, quantity } = order
  const total = selectedProduct.price * quantity

  await sendText(
    ctx,
    chatId,
    `📝 *Ringkasan Order*\n\n${safeEmoji(selectedProduct.emoji)} ${safePlainText(selectedProduct.name, 80)}\n   ${quantity} x ${formatRupiah(selectedProduct.price)}\n━━━━━━━━━━━━━━━━━\n💵 *Total: ${formatRupiah(total)}*`,
  )

  await sendText(
    ctx,
    chatId,
    'Ketik /konfirmasi untuk membayar atau /batal untuk membatalkan.',
  )
}

async function selectProduct(ctx, userId, chatId, productId) {
  const current = await getOrder(userId, chatId)

  if (
    current.state !== ORDER_STATE.IDLE &&
    current.state !== ORDER_STATE.SELECTING_PRODUCT
  ) {
    await sendText(
      ctx,
      chatId,
      '⚠️ Kamu masih punya order yang belum selesai.\nKetik /batal untuk membatalkan order sebelumnya.',
    )
    return
  }

  const product = await getProductById(userId, productId)
  if (!product || !product.isAvailable) {
    await sendText(
      ctx,
      chatId,
      '⚠️ Produk tidak ditemukan atau sedang tidak tersedia. Silakan pilih lagi dari menu.',
    )
    await sendProductList(ctx, userId, chatId)
    return
  }

  await sendQuantityList(ctx, userId, chatId, product)
}

async function selectQuantity(ctx, userId, chatId, quantity) {
  const order = await getOrder(userId, chatId)

  if (order.state !== ORDER_STATE.SELECTING_QTY || !order.selectedProduct) {
    await sendText(
      ctx,
      chatId,
      '⚠️ Sesi order tidak valid. Ketik /menu untuk memulai lagi.',
    )
    return
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    await sendText(
      ctx,
      chatId,
      '⚠️ Jumlah tidak valid. Masukkan angka 1 sampai 99.',
    )
    return
  }

  await setOrder(userId, chatId, {
    state: ORDER_STATE.CONFIRMING,
    quantity,
    awaitingCustomQty: false,
  })

  await sendConfirmationList(ctx, userId, chatId)
}

async function confirmOrder(ctx, userId, chatId, { pushName, phone }) {
  const order = await getOrder(userId, chatId)

  if (order.state !== ORDER_STATE.CONFIRMING || !order.selectedProduct) {
    await sendText(ctx, chatId, '⚠️ Tidak ada order yang perlu dikonfirmasi.')
    return
  }

  const quantity = order.quantity
  const cachedProduct = order.selectedProduct

  // Harga/ketersediaan di sesi chat bisa basi (TTL order 1 jam). Ambil ulang
  // dari DB supaya total yang disimpan dan tagihan Midtrans selalu yang terbaru.
  const product = await getProductById(userId, cachedProduct.id)
  if (!product || !product.isAvailable) {
    await resetOrder(userId, chatId)
    await sendText(
      ctx,
      chatId,
      '⚠️ Produk ini sedang tidak tersedia. Silakan pilih produk lain dengan /menu.',
    )
    return
  }

  if (product.price !== cachedProduct.price) {
    await sendText(
      ctx,
      chatId,
      `ℹ️ Harga ${safePlainText(product.name, 80)} berubah sejak ringkasan order: ${formatRupiah(cachedProduct.price)} → ${formatRupiah(product.price)}.`,
    )
  }

  if (!phone) {
    console.warn(
      `[WhatsApp] Order user=${userId} dibuat tanpa nomor telepon (chat ${maskChatId(chatId)}); ` +
        'identitas pembeli hanya berdasarkan JID.',
    )
  }

  await sendText(
    ctx,
    chatId,
    '⏳ Memproses order dan membuat link pembayaran...',
  )

  let savedOrderId = null
  let invoiceText = null

  try {
    await assertMonthlyOrderLimit(userId, prisma)

    await validateStock([{ productId: product.id, quantity }], userId)

    const savedOrder = await saveOrder({
      userId,
      source: 'WHATSAPP',
      whatsappId: chatId,
      customerPhone: phone,
      customerName: pushName,
      firstName: pushName,
      product,
      quantity,
    })
    savedOrderId = savedOrder.orderId

    const snapResult = await createSnapTransaction({
      userId,
      orderId: savedOrder.orderId,
      totalPrice: savedOrder.totalPrice,
      product,
      quantity,
      customer: { firstName: pushName, phone },
    })

    await updateOrderPayment(userId, savedOrder.orderId, {
      paymentUrl: snapResult.redirect_url,
      snapToken: snapResult.token,
    })

    await resetOrder(userId, chatId)

    const total = product.price * quantity
    invoiceText = `✅ *Order Berhasil Dibuat!*

📄 *Detail Order*
━━━━━━━━━━━━━━━━━━━━
🔖 No. Order: *${savedOrder.orderId}*
${safeEmoji(product.emoji)} ${safePlainText(product.name, 80)}
   ${quantity} x ${formatRupiah(product.price)}
━━━━━━━━━━━━━━━━━━━━
💵 *Total: ${formatRupiah(total)}*
━━━━━━━━━━━━━━━━━━━━

💳 *Silakan lakukan pembayaran:*
${snapResult.redirect_url}

Tersedia: QRIS, GoPay, ShopeePay, Transfer Bank
⏰ Link berlaku 24 jam

Kamu akan otomatis mendapat notifikasi setelah pembayaran berhasil.`
  } catch (error) {
    console.error('[WhatsApp confirmOrder]', error.message)

    // Order sudah tersimpan tapi Midtrans gagal: tandai gagal dan bersihkan
    // sesi, kalau tidak pelanggan bisa menekan /konfirmasi lagi dan membuat
    // order duplikat untuk produk yang sama.
    if (savedOrderId) {
      await resetOrder(userId, chatId)
      await updateOrderStatus(userId, savedOrderId, 'PAYMENT_FAILED').catch(
        (markError) => {
          console.error(
            `[WhatsApp confirmOrder] Gagal menandai ${savedOrderId}: ${markError.message}`,
          )
        },
      )
    }

    const message =
      error.code === 'MONTHLY_ORDER_LIMIT_EXCEEDED'
        ? '⚠️ Maaf, order tidak dapat diproses saat ini. Silakan hubungi admin.'
        : String(error.message).startsWith('Stok')
          ? `⚠️ ${error.message}`
          : '⚠️ Gagal membuat transaksi. Silakan coba lagi atau hubungi admin.'

    await sendText(ctx, chatId, message)
  }

  if (invoiceText) {
    // Mengirim invoice bukan bagian dari pembuatan order. Kalau Evolution gagal
    // mengirim, order tetap berlaku dan link pembayaran di notifikasi admin
    // masih bisa dipakai — jangan sampai order yang bisa dibayar ditandai gagal.
    try {
      await sendText(ctx, chatId, invoiceText, { linkPreview: true })
    } catch (sendError) {
      console.error(
        `[WhatsApp confirmOrder] Gagal mengirim invoice ${savedOrderId}: ${sendError.message}`,
      )
    }
  }
}

async function cancelOrder(ctx, userId, chatId) {
  const current = await getOrder(userId, chatId)
  if (current.state === ORDER_STATE.IDLE) {
    await sendText(ctx, chatId, 'ℹ️ Tidak ada order yang sedang berjalan.')
    return
  }

  await resetOrder(userId, chatId)
  await sendText(
    ctx,
    chatId,
    '❌ Order dibatalkan.\n\nKetik /menu untuk melihat produk kami.',
  )
}

async function sendOrderStatus(ctx, userId, chatId) {
  const order = await getOrder(userId, chatId)

  if (order.state === ORDER_STATE.IDLE) {
    await sendText(
      ctx,
      chatId,
      'ℹ️ Kamu belum punya order yang sedang berjalan.\n\nKetik /menu untuk melihat produk kami.',
    )
    return
  }

  const stateLabel = {
    [ORDER_STATE.SELECTING_PRODUCT]: 'Memilih produk',
    [ORDER_STATE.SELECTING_QTY]: `Memilih jumlah untuk: ${safePlainText(order.selectedProduct?.name, 80)}`,
    [ORDER_STATE.CONFIRMING]: 'Menunggu konfirmasi',
  }

  let text = `📋 *Status Order Kamu*\n\nStatus: ${stateLabel[order.state] || order.state}\n`

  if (order.selectedProduct) {
    text += `Produk: ${safeEmoji(order.selectedProduct.emoji)} ${safePlainText(order.selectedProduct.name, 80)}\n`
    text += `Harga: ${formatRupiah(order.selectedProduct.price)}\n`
  }

  if (order.quantity) {
    const total = order.selectedProduct.price * order.quantity
    text += `Jumlah: ${order.quantity}\n`
    text += `Total: *${formatRupiah(total)}*\n`
  }

  if (order.state === ORDER_STATE.CONFIRMING) {
    text += '\nKetik /konfirmasi untuk melanjutkan atau /batal untuk membatalkan.'
  }

  await sendText(ctx, chatId, text)
}

async function sendHelp(ctx, chatId) {
  await sendText(
    ctx,
    chatId,
    `🤖 *Bantuan Bot*

/menu — Lihat daftar produk
/pesan — Mulai order
/konfirmasi — Konfirmasi order
/batal — Batalkan order
/status — Cek status order
/reset — Hapus riwayat chat

Kamu juga bisa memilih produk langsung dari daftar yang muncul.`,
  )
}

function matchProductByName(products, text) {
  const needle = String(text || '').trim().toLowerCase()
  if (needle.length < 3) return null

  return (
    products.find((product) => product.name.toLowerCase() === needle) ||
    products.find((product) => product.name.toLowerCase().includes(needle)) ||
    products.find((product) => needle.includes(product.name.toLowerCase())) ||
    null
  )
}

async function handleStateInput(ctx, userId, chatId, text, { aiEnabled }) {
  const order = await getOrder(userId, chatId)
  if (order.state === ORDER_STATE.IDLE) return false

  const trimmed = String(text || '').trim()
  const numeric = Number.parseInt(trimmed, 10)
  const isNumeric = /^\d+$/.test(trimmed)

  if (order.state === ORDER_STATE.SELECTING_PRODUCT) {
    const products = await getAvailableProducts(userId)

    if (isNumeric) {
      if (numeric < 1 || numeric > products.length) {
        await sendText(
          ctx,
          chatId,
          `⚠️ Nomor tidak valid. Masukkan angka 1 sampai ${products.length}.`,
        )
        return true
      }

      await selectProduct(ctx, userId, chatId, products[numeric - 1].id)
      return true
    }

    const matched = matchProductByName(products, trimmed)
    if (matched) {
      await selectProduct(ctx, userId, chatId, matched.id)
      return true
    }

    // Paritas Telegram: dalam mode AI teks bebas milik AI, bukan ditolak state.
    if (aiEnabled) return false

    await sendText(
      ctx,
      chatId,
      '⚠️ Produk tidak dikenali. Pilih dari daftar atau ketik nomor produk.',
    )
    return true
  }

  if (order.state === ORDER_STATE.SELECTING_QTY) {
    if (isNumeric) {
      await selectQuantity(ctx, userId, chatId, numeric)
      return true
    }

    if (aiEnabled) return false

    if (order.awaitingCustomQty) {
      await sendText(
        ctx,
        chatId,
        '⚠️ Jumlah tidak valid. Masukkan angka 1 sampai 99.',
      )
      return true
    }

    await sendText(
      ctx,
      chatId,
      `⚠️ Ketik jumlah dalam angka (1–99) atau pilih dari daftar.`,
    )
    return true
  }

  if (order.state === ORDER_STATE.CONFIRMING) {
    if (aiEnabled) return false

    await sendText(
      ctx,
      chatId,
      'Ketik /konfirmasi untuk lanjut ke pembayaran atau /batal untuk membatalkan.',
    )
    return true
  }

  return false
}

async function executeFunctionCall(ctx, userId, chatId, name, args, context) {
  console.log(`[WhatsApp FunctionCall] userId=${userId} ${name}`)

  switch (name) {
    case 'show_menu':
      return sendProductList(ctx, userId, chatId)

    case 'start_order': {
      const products = await getAvailableProducts(userId)
      if (products.length === 0) {
        return sendText(ctx, chatId, '⚠️ Belum ada produk tersedia saat ini.')
      }

      const current = await getOrder(userId, chatId)
      if (current.state !== ORDER_STATE.IDLE) {
        return sendText(
          ctx,
          chatId,
          '⚠️ Kamu masih punya order yang belum selesai. Ketik /batal untuk membatalkan dulu.',
        )
      }

      const index = Number(args?.product_id)
      let product = null

      if (Number.isInteger(index) && index >= 1 && index <= products.length) {
        product = products[index - 1]
      } else if (typeof args?.product_id === 'string') {
        product = await getProductById(userId, args.product_id)
      }

      if (!product || !product.isAvailable) {
        return sendProductList(ctx, userId, chatId)
      }

      const quantity = Number(args?.quantity)
      if (
        Number.isInteger(quantity) &&
        quantity >= 1 &&
        quantity <= 99
      ) {
        await setOrder(userId, chatId, {
          state: ORDER_STATE.CONFIRMING,
          selectedProduct: product,
          quantity,
          awaitingCustomQty: false,
        })
        return sendConfirmationList(ctx, userId, chatId)
      }

      return sendQuantityList(ctx, userId, chatId, product)
    }

    case 'confirm_order':
      return confirmOrder(ctx, userId, chatId, context)

    case 'cancel_order':
      return cancelOrder(ctx, userId, chatId)

    case 'get_order_status':
      return sendOrderStatus(ctx, userId, chatId)

    default:
      console.warn(`[WhatsApp FunctionCall] Unknown function: ${name}`)
  }
}

async function handleAiMessage(ctx, userId, chatId, text, context) {
  const history = await getHistory(userId, chatId)
  await addMessage(userId, chatId, 'user', text)

  const result = await askAI(text, userId, history)

  if (result.type === 'function_call') {
    await executeFunctionCall(
      ctx,
      userId,
      chatId,
      result.name,
      result.args,
      context,
    )
    await addMessage(userId, chatId, 'model', `[Aksi: ${result.name}]`)
    return
  }

  await addMessage(userId, chatId, 'model', result.text)
  await sendText(ctx, chatId, toWhatsAppText(result.text))
}

/**
 * Entry point untuk satu pesan WhatsApp yang sudah lolos filter.
 */
export async function handleIncomingWhatsAppMessage({ userId, chatId, data }) {
  const ctx = await getWhatsAppClientForUser(userId)
  if (!ctx) {
    console.warn(
      `[WhatsApp] Kredensial Evolution belum dikonfigurasi untuk user=${userId}`,
    )
    return
  }

  const content = extractWhatsAppMessage(data)
  if (!content) return

  // Nama profil dikontrol pelanggan dan bisa berisi markup/j markup newline;
  // disanitasi sebelum disisipkan ke pesan atau disimpan sebagai nama pembeli.
  const pushName = safePlainText(data?.pushName, 60, '') || 'Pelanggan'
  const phone = extractPhoneFromJid(chatId)
  const context = { pushName, phone }

  if (content.kind === 'unsupported') {
    await sendText(
      ctx,
      chatId,
      'Maaf, saat ini bot hanya bisa memproses pesan teks.',
    )
    return
  }

  const text = content.text
  const command = parseCommand(text)

  try {
    switch (command) {
      case 'start': {
        // WhatsApp mengirim "start" tiap kali chat dibuka lagi dari link
        // click-to-chat; hindari greeting + daftar produk 100 baris berulang.
        const freshWelcome = await redisSetNx(
          `welcome_sent:${userId}:${chatId}`,
          '1',
          WELCOME_DEDUP_TTL_SECONDS,
        ).catch(() => false)

        if (!freshWelcome) {
          await sendText(
            ctx,
            chatId,
            '👋 Halo lagi! Ketik /menu untuk lihat produk atau /pesan untuk mulai order.',
          )
          return
        }

        await resetActiveOrder(ctx, userId, chatId)
        await sendText(
          ctx,
          chatId,
          `👋 Halo, *${pushName}*!\n\nSelamat datang di toko kami.\nSilakan pilih produk di bawah atau ketik /menu.`,
        )
        await sendProductList(ctx, userId, chatId)
        return
      }

      case 'menu':
        await resetActiveOrder(ctx, userId, chatId)
        await sendProductList(ctx, userId, chatId)
        return

      case 'order': {
        const current = await getOrder(userId, chatId)
        if (current.state !== ORDER_STATE.IDLE) {
          await sendText(
            ctx,
            chatId,
            '⚠️ Kamu masih punya order yang belum selesai. Ketik /batal untuk membatalkan dulu.',
          )
          return
        }
        await resetOrder(userId, chatId)
        await sendProductList(ctx, userId, chatId)
        return
      }

      case 'help':
        await sendHelp(ctx, chatId)
        return

      case 'cancel':
        await cancelOrder(ctx, userId, chatId)
        return

      case 'confirm':
        await confirmOrder(ctx, userId, chatId, context)
        return

      case 'status':
        await sendOrderStatus(ctx, userId, chatId)
        return

      case 'reset':
        await clearHistory(userId, chatId)
        await sendText(ctx, chatId, '🔄 Riwayat percakapan dihapus.')
        return

      default:
        break
    }

    const aiEnabled = await isAiEnabledForUser(userId)

    const handledByState = await handleStateInput(
      ctx,
      userId,
      chatId,
      text,
      { aiEnabled },
    )
    if (handledByState) return

    if (!aiEnabled) {
      await sendProductList(ctx, userId, chatId)
      return
    }

    await handleAiMessage(ctx, userId, chatId, text, context)
  } catch (error) {
    console.error(
      `[WhatsApp] Gagal memproses pesan user=${userId} chat=${maskChatId(chatId)}:`,
      error.message,
    )

    try {
      await sendText(
        ctx,
        chatId,
        '⚠️ Maaf, terjadi kesalahan. Silakan coba lagi.',
      )
    } catch {}
  }
}
