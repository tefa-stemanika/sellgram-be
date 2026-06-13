import prisma from '../../db.js'

export async function execute({ userId, order, config }) {
  const item = await prisma.$queryRaw`
    UPDATE stock_items
    SET status = 'USED', used_at = NOW(), order_id = ${order.id}::uuid
    WHERE id = (
      SELECT id FROM stock_items
      WHERE product_id = ${config.productId}::uuid
        AND user_id = ${userId}::uuid
        AND status = 'AVAILABLE'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, content
  `

  if (!item || item.length === 0) {
    throw new Error('Stok habis — tidak ada item AVAILABLE')
  }

  return {
    success: true,
    delivery: item[0].content,
    note: null,
  }
}
