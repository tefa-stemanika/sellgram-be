import prisma from './db.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const SALT_ROUNDS = 10
const TOKEN_EXPIRY = '30d'

export async function registerCustomer(tenantId, { email, password, name, phone }) {
  if (!email || !password) throw new Error('Email dan password wajib diisi')
  if (!phone) throw new Error('Nomor telepon wajib diisi')
  if (password.length < 6) throw new Error('Password minimal 6 karakter')

  const existingAuth = await prisma.customerAuth.findUnique({
    where: { userId_email: { userId: tenantId, email } },
  })
  if (existingAuth) throw new Error('Email sudah terdaftar')

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  let customer = await prisma.customer.findFirst({
    where: { userId: tenantId, email },
  })

  if (!customer && phone) {
    customer = await prisma.customer.findFirst({
      where: { userId: tenantId, phone },
    })
  }

  const result = await prisma.$transaction(async (tx) => {
    if (!customer) {
      customer = await tx.customer.create({
        data: {
          userId: tenantId,
          email,
          name: name ?? null,
          phone: phone ?? null,
          hasEmail: true,
          source: 'MANUAL',
        },
      })
    } else {
      customer = await tx.customer.update({
        where: { id: customer.id },
        data: {
          ...(name ? { name } : {}),
          ...(phone ? { phone, hasWhatsapp: true } : {}),
          hasEmail: true,
        },
      })
    }

    const auth = await tx.customerAuth.create({
      data: {
        customerId: customer.id,
        userId: tenantId,
        email,
        passwordHash,
        isVerified: true,
      },
    })

    return { customer, auth }
  })

  const token = generateToken(result.customer, tenantId)
  return { customer: sanitizeCustomer(result.customer), token }
}

export async function loginCustomer(tenantId, { email, password }) {
  if (!email || !password) throw new Error('Email dan password wajib diisi')

  const auth = await prisma.customerAuth.findUnique({
    where: { userId_email: { userId: tenantId, email } },
    include: { customer: true },
  })

  if (!auth) throw new Error('Email atau password salah')

  const isMatch = await bcrypt.compare(password, auth.passwordHash)
  if (!isMatch) throw new Error('Email atau password salah')

  await prisma.customerAuth.update({
    where: { id: auth.id },
    data: { lastLoginAt: new Date() },
  })

  const token = generateToken(auth.customer, tenantId)
  return { customer: sanitizeCustomer(auth.customer), token }
}

export async function getCustomerProfile(customerId, tenantId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId: tenantId },
    include: {
      auth: { select: { email: true, lastLoginAt: true, isVerified: true } },
    },
  })
  if (!customer) throw new Error('Customer not found')
  return sanitizeCustomer(customer)
}

export async function updateCustomerProfile(customerId, tenantId, { name, phone }) {
  return prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(name !== undefined && { name }),
      ...(phone !== undefined && { phone, hasWhatsapp: !!phone }),
    },
  })
}

export async function changePassword(customerId, tenantId, { oldPassword, newPassword }) {
  if (newPassword.length < 6) throw new Error('Password baru minimal 6 karakter')

  const auth = await prisma.customerAuth.findUnique({
    where: { customerId },
  })
  if (!auth) throw new Error('Auth not found')

  const isMatch = await bcrypt.compare(oldPassword, auth.passwordHash)
  if (!isMatch) throw new Error('Password lama salah')

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await prisma.customerAuth.update({
    where: { id: auth.id },
    data: { passwordHash },
  })

  return { message: 'Password berhasil diubah' }
}

export async function getCustomerOrders(customerId, tenantId, { page = 1, limit = 10 } = {}) {
  const where = { customerId, userId: tenantId }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      select: {
        id: true,
        orderId: true,
        source: true,
        status: true,
        totalPrice: true,
        paymentUrl: true,
        paidAt: true,
        createdAt: true,
        orderItems: {
          include: {
            product: {
              select: { id: true, name: true, emoji: true, price: true },
            },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ])

  return {
    orders,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
  }
}

function generateToken(customer, tenantId) {
  return jwt.sign(
    {
      sub: customer.id,
      tenantId,
      type: 'customer',
    },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  )
}

function sanitizeCustomer(customer) {
  const safe = { ...customer }
  if (safe.auth) {
    delete safe.auth.passwordHash
  }
  return safe
}
