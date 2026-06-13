import prisma from './db.js'

export async function validateStock(items, userId) {
  const productIds = items.map((i) => i.productId)

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, userId, deletedAt: null },
    select: {
      id: true,
      name: true,
      stock: true,
      stockEnabled: true,
      allowOversell: true,
      isAvailable: true,
    },
  })

  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))
  const errors = []

  for (const item of items) {
    const product = productMap[item.productId]

    if (!product) {
      errors.push('Produk tidak ditemukan')
      continue
    }

    if (!product.isAvailable) {
      errors.push(`Produk "${product.name}" tidak tersedia`)
      continue
    }

    if (!product.stockEnabled) continue

    if (product.stock < item.quantity && !product.allowOversell) {
      errors.push(
        `Stok "${product.name}" tidak cukup. Tersedia: ${product.stock}, diminta: ${item.quantity}`,
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
}

export async function deductStock(orderId, userId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      orderItems: {
        include: { product: true },
      },
    },
  })

  if (!order) throw new Error('Order not found')

  const itemsToDeduct = order.orderItems.filter(
    (item) => item.product.stockEnabled,
  )
  if (itemsToDeduct.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const item of itemsToDeduct) {
      const updated = await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      })

      await tx.stockLog.create({
        data: {
          productId: item.productId,
          userId,
          orderId,
          type: 'SALE',
          delta: -item.quantity,
          stockAfter: updated.stock,
          note: `Order ${order.orderId}`,
        },
      })

      await checkLowStockAlert(tx, updated, userId)
    }
  })
}

export async function refundStock(orderId, userId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      orderItems: {
        include: { product: true },
      },
    },
  })

  if (!order) throw new Error('Order not found')

  const itemsToRefund = order.orderItems.filter(
    (item) => item.product.stockEnabled,
  )
  if (itemsToRefund.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const item of itemsToRefund) {
      const updated = await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      })

      await tx.stockLog.create({
        data: {
          productId: item.productId,
          userId,
          orderId,
          type: 'REFUND',
          delta: item.quantity,
          stockAfter: updated.stock,
          note: `Refund order ${order.orderId}`,
        },
      })
    }
  })
}

export async function restockProduct(productId, userId, quantity, note = null) {
  const product = await prisma.product.findFirst({
    where: { id: productId, userId, deletedAt: null },
  })
  if (!product) throw new Error('Product not found')
  if (quantity <= 0) throw new Error('Quantity harus lebih dari 0')

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } },
    })

    await tx.stockLog.create({
      data: {
        productId,
        userId,
        type: 'RESTOCK',
        delta: quantity,
        stockAfter: updated.stock,
        note: note ?? `Restock manual +${quantity}`,
      },
    })

    return updated
  })
}

export async function adjustStock(productId, userId, newStock, note = null) {
  const product = await prisma.product.findFirst({
    where: { id: productId, userId, deletedAt: null },
  })
  if (!product) throw new Error('Product not found')
  if (newStock < 0) throw new Error('Stok tidak boleh negatif')

  const delta = newStock - product.stock

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: newStock },
    })

    await tx.stockLog.create({
      data: {
        productId,
        userId,
        type: 'ADJUSTMENT',
        delta,
        stockAfter: updated.stock,
        note: note ?? `Adjustment stok ke ${newStock}`,
      },
    })

    return updated
  })
}

export async function getStockLogs(
  productId,
  userId,
  { page = 1, limit = 20 } = {},
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, userId },
  })
  if (!product) throw new Error('Product not found')

  const where = { productId }

  const [logs, total] = await Promise.all([
    prisma.stockLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.stockLog.count({ where }),
  ])

  return {
    logs,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  }
}

async function checkLowStockAlert(tx, product, userId) {
  if (!product.stockEnabled) return
  if (product.stock > product.lowStockAlert) return

  try {
    const { sendAdminBotMessage } = await import('./adminBot.js')
    await sendAdminBotMessage(
      userId,
      `⚠️ *Stok Menipis!*\n\nProduk: *${product.name}*\nSisa stok: *${product.stock}*\n\nSegera lakukan restock.`,
    )
  } catch (e) {
    console.error('[StockAlert] Failed to send low stock alert:', e.message)
  }
}
