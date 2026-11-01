import prisma from './db.js'
import { extractPhoneFromJid } from './whatsappJid.js'

function resolveIdentifier(userId, { telegramId, phone, email }) {
  if (telegramId)
    return { userId_telegramId: { userId, telegramId: BigInt(telegramId) } }
  if (phone) return { userId_phone: { userId, phone } }
  if (email) return { userId_email: { userId, email } }
  return null
}

function validateIdentifier({ telegramId, phone, email }) {
  if (!telegramId && !phone && !email) {
    throw new Error(
      'Minimal satu identifier harus diisi: telegramId, phone, atau email',
    )
  }
}

/**
 * Pembeli WhatsApp kadang hanya punya JID (nomor disembunyikan WhatsApp atau
 * order dibuat sebelum kolom HP diisi). Nomor dari JID dipakai supaya tetap
 * tercatat sebagai Customer dan bisa dihubungi.
 */
function resolveCustomerPhone(order) {
  const direct = String(order.customerPhone || '').trim()
  if (direct) return direct
  return extractPhoneFromJid(order.whatsappId)
}

export async function upsertCustomerFromOrder(order, userId) {
  const {
    telegramId,
    customerName,
    firstName,
    username,
    totalPrice,
    createdAt,
  } = order

  const phone = resolveCustomerPhone(order)

  const identifier = resolveIdentifier(userId, {
    telegramId,
    phone,
  })

  if (!identifier) {
    console.warn(
      `[Customer] Order ${order.orderId} (source ${order.source}) tanpa telegramId/phone/JID yang bisa dipakai — customer dilewati`,
    )
    return null
  }

  const customer = await prisma.customer.upsert({
    where: identifier,
    create: {
      userId,
      telegramId: telegramId ? BigInt(telegramId) : null,
      phone: phone ?? null,
      name: customerName ?? firstName ?? null,
      username: username ?? null,
      source: 'ORDER',
      hasTelegram: !!telegramId,
      hasWhatsapp: Boolean(phone),
      firstOrderAt: createdAt,
      lastOrderAt: createdAt,
      totalOrders: 1,
      totalSpent: totalPrice,
    },
    update: {
      ...(customerName || firstName ? { name: customerName ?? firstName } : {}),
      ...(username ? { username } : {}),
      ...(telegramId ? { hasTelegram: true } : {}),
      ...(phone ? { hasWhatsapp: true } : {}),
      lastOrderAt: createdAt,
      totalOrders: { increment: 1 },
      totalSpent: { increment: totalPrice },
    },
  })

  await prisma.order.update({
    where: { id: order.id },
    data: { customerId: customer.id },
  })

  return customer
}

export async function getCustomers(userId, filters = {}) {
  const {
    search,
    source,
    orderSource,
    hasTelegram,
    hasWhatsapp,
    hasEmail,
    sortBy = 'createdAt',
    sortDir = 'desc',
    page = 1,
    limit = 20,
  } = filters

  const ALLOWED_SORT = [
    'createdAt',
    'lastOrderAt',
    'totalSpent',
    'totalOrders',
    'name',
  ]
  const ALLOWED_SOURCE = ['ORDER', 'MANUAL', 'IMPORT']
  const ALLOWED_ORDER_SOURCE = ['TELEGRAM', 'WHATSAPP', 'WEBSITE', 'API']
  const safeSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'createdAt'
  const safeSortDir = sortDir === 'asc' ? 'asc' : 'desc'
  const safeSource = ALLOWED_SOURCE.includes(source) ? source : undefined
  const safeOrderSource = ALLOWED_ORDER_SOURCE.includes(orderSource) ? orderSource : undefined

  const where = {
    userId,
    ...(safeSource && { source: safeSource }),
    ...(safeOrderSource && {
      orders: { some: { source: safeOrderSource } },
    }),
    ...(hasTelegram !== undefined && { hasTelegram: hasTelegram === 'true' }),
    ...(hasWhatsapp !== undefined && { hasWhatsapp: hasWhatsapp === 'true' }),
    ...(hasEmail !== undefined && { hasEmail: hasEmail === 'true' }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    }),
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { [safeSortBy]: safeSortDir },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        telegramId: true,
        hasTelegram: true,
        hasWhatsapp: true,
        hasEmail: true,
        source: true,
        totalOrders: true,
        totalSpent: true,
        lastOrderAt: true,
        createdAt: true,
      },
    }),
    prisma.customer.count({ where }),
  ])

  return {
    customers,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
  }
}

export async function getCustomerById(customerId, userId) {
  return prisma.customer.findFirst({
    where: { id: customerId, userId },
    include: {
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderId: true,
          source: true,
          status: true,
          totalPrice: true,
          paidAt: true,
          createdAt: true,
          orderItems: {
            include: {
              product: { select: { id: true, name: true, emoji: true } },
            },
          },
        },
      },
    },
  })
}

export async function createCustomer(userId, data) {
  const { telegramId, email, phone, name, username, notes, hasWhatsapp } = data

  validateIdentifier({ telegramId, email, phone })

  await checkDuplicate(userId, { telegramId, email, phone })

  return prisma.customer.create({
    data: {
      userId,
      telegramId: telegramId ? BigInt(telegramId) : null,
      email: email ?? null,
      phone: phone ?? null,
      name: name ?? null,
      username: username ?? null,
      notes: notes ?? null,
      source: 'MANUAL',
      hasTelegram: !!telegramId,
      hasWhatsapp: hasWhatsapp ?? !!phone,
      hasEmail: !!email,
    },
  })
}

export async function updateCustomer(customerId, userId, data) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId },
  })
  if (!customer) throw new Error('Customer not found')

  const { email, phone, name, username, notes, hasWhatsapp, hasEmail } = data

  if (email && email !== customer.email) {
    await checkDuplicate(userId, { email }, customerId)
  }
  if (phone && phone !== customer.phone) {
    await checkDuplicate(userId, { phone }, customerId)
  }

  return prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(name !== undefined && { name }),
      ...(username !== undefined && { username }),
      ...(email !== undefined && { email, hasEmail: !!email }),
      ...(phone !== undefined && { phone }),
      ...(notes !== undefined && { notes }),
      ...(hasWhatsapp !== undefined && { hasWhatsapp }),
      ...(hasEmail !== undefined && { hasEmail }),
    },
  })
}

export async function deleteCustomer(customerId, userId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId },
  })
  if (!customer) throw new Error('Customer not found')

  await prisma.order.updateMany({
    where: { customerId },
    data: { customerId: null },
  })

  return prisma.customer.delete({ where: { id: customerId } })
}

async function checkDuplicate(
  userId,
  { telegramId, email, phone },
  excludeId = null,
) {
  const checks = []

  if (telegramId) checks.push({ userId, telegramId: BigInt(telegramId) })
  if (email) checks.push({ userId, email })
  if (phone) checks.push({ userId, phone })

  for (const condition of checks) {
    const existing = await prisma.customer.findFirst({
      where: {
        ...condition,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    })
    if (existing) {
      const field = Object.keys(condition).find((k) => k !== 'userId')
      throw new Error(`Customer dengan ${field} ini sudah terdaftar`)
    }
  }
}
