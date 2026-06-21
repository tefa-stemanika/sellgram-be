import prisma from './db.js'

const RESOLVERS = {
  TOTAL_ORDERS: async (customerId, userId) => {
    const count = await prisma.order.count({
      where: { customerId, userId, status: 'COMPLETED' },
    })
    return String(count)
  },

  TOTAL_SPENT: async (customerId, userId) => {
    const result = await prisma.order.aggregate({
      where: { customerId, userId, status: 'COMPLETED' },
      _sum: { totalPrice: true },
    })
    const total = result._sum.totalPrice || 0
    return `Rp ${total.toLocaleString('id-ID')}`
  },

  LAST_ORDER_DATE: async (customerId, userId) => {
    const order = await prisma.order.findFirst({
      where: { customerId, userId, status: 'COMPLETED' },
      orderBy: { paidAt: 'desc' },
      select: { paidAt: true },
    })
    if (!order?.paidAt) return null
    return order.paidAt.toLocaleDateString('id-ID', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  },

  LAST_PRODUCT_NAME: async (customerId, userId) => {
    const order = await prisma.order.findFirst({
      where: { customerId, userId, status: 'COMPLETED' },
      orderBy: { paidAt: 'desc' },
      select: { id: true },
    })
    if (!order) return null
    const item = await prisma.orderItem.findFirst({
      where: { orderId: order.id },
      include: { product: { select: { name: true } } },
    })
    return item?.product?.name || null
  },
}

const DERIVED_FIELD_TYPES = Object.keys(RESOLVERS)

export function getDerivedFieldTypes() {
  return DERIVED_FIELD_TYPES
}

export async function resolveDerivedField(customerId, userId, fieldType) {
  const resolver = RESOLVERS[fieldType]
  if (!resolver) return null
  try {
    return await resolver(customerId, userId)
  } catch {
    return null
  }
}
