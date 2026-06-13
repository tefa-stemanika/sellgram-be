import prisma from '../../services/db.js'
import { ok, fail } from '../utils/response.js'
import { encrypt } from '../../utils/encryption.js'

export async function listSlotAccounts(req, res) {
  const { productId } = req.params
  const userId = req.auth.userId

  const accounts = await prisma.slotAccount.findMany({
    where: { productId, userId },
    include: { _count: { select: { slots: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return ok(res, accounts)
}

export async function createSlotAccount(req, res) {
  const { productId } = req.params
  const userId = req.auth.userId

  const product = await prisma.product.findFirst({
    where: { id: productId, userId },
  })
  if (!product) return fail(res, 'Product not found', 404)

  const { label, credentials, totalSlots } = req.body
  if (!label || !credentials || !totalSlots) {
    return fail(res, 'label, credentials, and totalSlots required', 400)
  }

  const account = await prisma.slotAccount.create({
    data: {
      userId,
      productId,
      label,
      credentials: encrypt(JSON.stringify(credentials)),
      totalSlots,
      usedSlots: 0,
    },
  })

  return ok(res, account)
}

export async function updateSlotAccount(req, res) {
  const { productId, accountId } = req.params
  const userId = req.auth.userId

  const existing = await prisma.slotAccount.findFirst({
    where: { id: accountId, productId, userId },
  })
  if (!existing) return fail(res, 'Slot account not found', 404)

  const { label, credentials, totalSlots, isActive } = req.body

  const data = {}
  if (label !== undefined) data.label = label
  if (credentials !== undefined) {
    data.credentials = encrypt(JSON.stringify(credentials))
  }
  if (totalSlots !== undefined) data.totalSlots = totalSlots
  if (isActive !== undefined) data.isActive = isActive

  const account = await prisma.slotAccount.update({
    where: { id: accountId },
    data,
  })

  return ok(res, account)
}

export async function deleteSlotAccount(req, res) {
  const { productId, accountId } = req.params
  const userId = req.auth.userId

  const existing = await prisma.slotAccount.findFirst({
    where: { id: accountId, productId, userId },
  })
  if (!existing) return fail(res, 'Slot account not found', 404)

  await prisma.slotAccount.delete({ where: { id: accountId } })
  return ok(res, { deleted: true })
}

export async function listSlots(req, res) {
  const { productId, accountId } = req.params
  const userId = req.auth.userId

  const slots = await prisma.slot.findMany({
    where: { slotAccountId: accountId, productId, userId },
    include: {
      order: {
        select: {
          firstName: true,
          customerName: true,
          customerPhone: true,
          username: true,
          telegramId: true,
          customer: {
            select: { name: true, phone: true, email: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return ok(res, slots)
}

export async function createSlots(req, res) {
  const { productId, accountId } = req.params
  const userId = req.auth.userId

  const account = await prisma.slotAccount.findFirst({
    where: { id: accountId, productId, userId },
  })
  if (!account) return fail(res, 'Slot account not found', 404)

  const { slots } = req.body
  if (!Array.isArray(slots) || slots.length === 0) {
    return fail(res, 'slots array required', 400)
  }

  const data = slots.map((slot) => ({
    userId,
    slotAccountId: accountId,
    productId,
    slotIdentifier: slot.slotIdentifier,
    additionalInfo: slot.additionalInfo || null,
    status: 'AVAILABLE',
  }))

  await prisma.slot.createMany({ data })
  return ok(res, { created: data.length })
}

export async function deleteSlot(req, res) {
  const { productId, slotId } = req.params
  const userId = req.auth.userId

  const slot = await prisma.slot.findFirst({
    where: { id: slotId, productId, userId, status: 'AVAILABLE' },
  })
  if (!slot) return fail(res, 'Available slot not found', 404)

  await prisma.slot.delete({ where: { id: slotId } })
  return ok(res, { deleted: true })
}

export async function releaseSlot(req, res) {
  const { productId, slotId } = req.params
  const userId = req.auth.userId

  const slot = await prisma.slot.findFirst({
    where: { id: slotId, productId, userId, status: 'ACTIVE' },
    include: { slotAccount: true },
  })
  if (!slot) return fail(res, 'Active slot not found', 404)

  await prisma.$transaction([
    prisma.slot.update({
      where: { id: slotId },
      data: { status: 'AVAILABLE', assignedAt: null, orderId: null },
    }),
    prisma.slotAccount.update({
      where: { id: slot.slotAccountId },
      data: { usedSlots: { decrement: 1 } },
    }),
    prisma.fulfillmentLog.deleteMany({
      where: { orderId: slot.orderId },
    }),
  ])

  return ok(res, { released: true })
}
