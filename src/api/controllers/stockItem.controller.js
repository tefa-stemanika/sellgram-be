import prisma from '../../services/db.js'
import { ok, okPaginated, fail } from '../utils/response.js'

export async function listStockItems(req, res) {
  const { productId } = req.params
  const userId = req.auth.userId
  const { status, page = 1, limit = 50 } = req.query

  const where = { productId, userId }
  if (status) where.status = status

  const [items, total] = await Promise.all([
    prisma.stockItem.findMany({
      where,
      include: {
        order: {
          select: {
            source: true,
            firstName: true,
            customerName: true,
            customerPhone: true,
            username: true,
            telegramId: true,
            whatsappId: true,
            customer: {
              select: { name: true, phone: true, email: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: Number(limit),
    }),
    prisma.stockItem.count({ where }),
  ])

  return okPaginated(res, items, total, Number(page), Number(limit))
}

export async function createStockItems(req, res) {
  const { productId } = req.params
  const userId = req.auth.userId

  const product = await prisma.product.findFirst({
    where: { id: productId, userId },
  })
  if (!product) return fail(res, 'Product not found', 404)

  const { items, content } = req.body

  let entries = []
  if (Array.isArray(items) && items.length > 0) {
    entries = items.map((item) => ({
      userId,
      productId,
      content: typeof item === 'string' ? item : JSON.stringify(item),
    }))
  } else if (typeof content === 'string' && content.trim()) {
    entries = content
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => ({
        userId,
        productId,
        content: line,
      }))
  }

  if (entries.length === 0) return fail(res, 'No items provided', 400)

  try {
    await prisma.stockItem.createMany({ data: entries, skipDuplicates: true })
    return ok(res, { created: entries.length })
  } catch (err) {
    if (err.code === 'P2002') {
      return fail(res, 'Some items already exist (duplicate content)', 409)
    }
    throw err
  }
}

export async function deleteStockItem(req, res) {
  const { productId, itemId } = req.params
  const userId = req.auth.userId

  const item = await prisma.stockItem.findFirst({
    where: { id: itemId, productId, userId, status: 'AVAILABLE' },
  })
  if (!item) return fail(res, 'Item not found or already used', 404)

  await prisma.stockItem.delete({ where: { id: itemId } })
  return ok(res, { deleted: true })
}

export async function countStockItems(req, res) {
  const { productId } = req.params
  const userId = req.auth.userId

  const count = await prisma.stockItem.count({
    where: { productId, userId, status: 'AVAILABLE' },
  })

  return ok(res, { available: count })
}
