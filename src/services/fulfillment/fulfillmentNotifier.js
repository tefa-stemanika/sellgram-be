import { getBotForUser } from '../botManager.js'
import { sendAdminBotMessage } from '../adminBot.js'
import { sendWhatsAppTextForUser } from '../whatsappManager.js'

export async function sendDeliveryToCustomer({ userId, order, delivery }) {
  if (order.source === 'WEBSITE') return

  if (order.source === 'WHATSAPP') {
    const target =
      order.whatsappId ||
      String(order.customerPhone || '').replace(/\D/g, '') ||
      null

    if (!target) {
      console.warn(
        `[FulfillmentNotifier] Order ${order.orderId} tidak punya whatsappId/customerPhone, delivery WhatsApp dilewati`,
      )
      return
    }

    const text = `📦 *Pesanan Terkirim!*

🔖 Order: ${order.orderId}

${delivery}

Terima kasih telah berbelanja! 🙏`

    try {
      await sendWhatsAppTextForUser(userId, target, text)
    } catch (err) {
      console.error(
        '[FulfillmentNotifier] Gagal kirim delivery WhatsApp:',
        err.message,
      )
    }
    return
  }

  const bot = getBotForUser(userId)
  if (!bot) return

  const telegramId = Number(order.telegramId)
  if (!telegramId) return

  const text = `📦 *Pesanan Terkirim!*

🔖 Order: \`${order.orderId}\`

${delivery}

Terima kasih telah berbelanja! 🙏`

  try {
    await bot.sendMessage(telegramId, text, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[FulfillmentNotifier] Gagal kirim delivery:', err.message)
  }
}

export async function notifyFulfillmentFailed({ userId, order, productName, error }) {
  const text = `⚠️ *Fulfillment Gagal*

🔖 Order: \`${order.orderId}\`
📦 Produk: ${productName}
❌ Error: ${error}

Perlu dicek manual.`

  await sendAdminBotMessage(userId, text)
}
