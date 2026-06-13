import prisma from '../../db.js'
import { sendAdminBotMessage } from '../../adminBot.js'

export async function execute({ userId, order, config }) {
  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'PROCESSING' },
  })

  const item = order.orderItems?.[0]
  const text = `👷 *Fulfillment Manual Diperlukan*

🔖 Order: \`${order.orderId}\`
📦 Produk: ${item ? `${item.product.emoji} ${item.product.name} x${item.quantity}` : '-'}
💵 Total: Rp ${order.totalPrice.toLocaleString('id-ID')}
👤 ${order.firstName || '-'} ${order.username ? `(@${order.username})` : ''}
📞 ${order.customerPhone || order.customer?.phone || '-'}

${config.manualNote ? `📝 *Catatan:* ${config.manualNote}` : ''}

Segera proses pesanan ini!`

  await sendAdminBotMessage(userId, text)

  return {
    success: true,
    delivery: 'Pesanan sedang diproses manual oleh admin',
    note: config.manualNote || null,
  }
}
