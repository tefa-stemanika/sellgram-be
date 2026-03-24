// tests/test-helpers.js
// Utility functions for integration testing

import 'dotenv/config'
import prisma from '../src/services/db.js'
import { encrypt } from '../src/utils/encryption.js'

/**
 * Test context: contains database data refs for cleanup
 */
export class TestContext {
  constructor() {
    this.createdUserIds = []
    this.createdOrderIds = []
    this.createdProductIds = []
  }

  async cleanup() {
    console.log('🧹 Cleaning up test data...')

    // ⚠️ IMPORTANT: Delete in correct order to avoid foreign key constraint violations
    // 1. Delete OrderItems first (they reference Orders)
    if (this.createdOrderIds.length > 0) {
      try {
        await prisma.orderItem.deleteMany({
          where: { orderId: { in: this.createdOrderIds } },
        })
      } catch (err) {
        // Silently ignore if no OrderItems (some tests might not create them)
      }
    }

    // 2. Delete Orders (after OrderItems are gone)
    if (this.createdOrderIds.length > 0) {
      await prisma.order.deleteMany({
        where: { id: { in: this.createdOrderIds } },
      })
    }

    // 3. Delete Products
    if (this.createdProductIds.length > 0) {
      await prisma.product.deleteMany({
        where: { id: { in: this.createdProductIds } },
      })
    }

    // 4. Delete Users (cascading deletes handle credentials, configs)
    if (this.createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: this.createdUserIds } },
      })
    }

    console.log('✅ Cleanup complete')
  }
}

/**
 * Create test user with credentials
 * Returns: { user, botToken, adminToken }
 */
export async function createTestUser(ctx, overrides = {}) {
  const defaultData = {
    email: `test_${Date.now()}@example.com`,
    passwordHash: 'hashed_password',
    name: `Test User ${Date.now()}`,
    plan: 'PRO',
    isActive: true,
  }

  const user = await prisma.user.create({
    data: { ...defaultData, ...overrides },
  })

  ctx.createdUserIds.push(user.id)

  // Create bot token credential
  const botToken = `test_bot_token_${user.id}_${Date.now()}`
  const encryptedBotToken = encrypt(botToken)

  await prisma.botCredential.create({
    data: {
      userId: user.id,
      key: 'TELEGRAM_BOT_TOKEN',
      value: encryptedBotToken,
    },
  })

  // Create admin token credential
  const adminToken = `test_admin_token_${user.id}_${Date.now()}`
  const encryptedAdminToken = encrypt(adminToken)

  await prisma.botCredential.create({
    data: {
      userId: user.id,
      key: 'TELEGRAM_ADMIN_BOT_TOKEN',
      value: encryptedAdminToken,
    },
  })

  // Create bot config
  await prisma.botConfig.create({
    data: {
      userId: user.id,
      aiEnabled: true,
      geminiModel: 'gemini-2.0-flash',
      midtransIsProduction: false,
      botMode: 'polling',
      isActive: true,
    },
  })

  return {
    user,
    botToken,
    adminToken,
  }
}

/**
 * Create test products for user
 */
export async function createTestProducts(ctx, userId, count = 3) {
  const products = []

  const defaultProducts = [
    {
      name: 'Nasi Goreng',
      description: 'Nasi goreng spesial',
      price: 25000,
      emoji: '🍳',
    },
    {
      name: 'Mie Ayam',
      description: 'Mie ayam dengan bakso',
      price: 20000,
      emoji: '🍜',
    },
    {
      name: 'Jus Alpukat',
      description: 'Jus alpukat segar',
      price: 15000,
      emoji: '🥑',
    },
  ]

  for (let i = 0; i < Math.min(count, defaultProducts.length); i++) {
    const product = await prisma.product.create({
      data: {
        userId,
        ...defaultProducts[i],
        isAvailable: true,
      },
    })
    ctx.createdProductIds.push(product.id)
    products.push(product)
  }

  return products
}

/**
 * Create test order for user
 */
export async function createTestOrder(ctx, userId, productId, quantity = 1) {
  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) throw new Error(`Product ${productId} not found`)

  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
  const totalPrice = product.price * quantity
  const telegramId = BigInt(123000000 + userId)

  const order = await prisma.order.create({
    data: {
      userId,
      orderId,
      telegramId,
      username: 'testuser',
      firstName: 'Test',
      totalPrice,
      status: 'PENDING',
      orderItems: {
        create: [
          {
            productId,
            quantity,
            unitPrice: product.price,
          },
        ],
      },
    },
    include: { orderItems: { include: { product: true } } },
  })

  ctx.createdOrderIds.push(order.id)
  return order
}

/**
 * Create Midtrans webhook notification payload
 */
export function createMidtransNotification(orderId, status = 'settlement') {
  const statusCodeMap = {
    settlement: '200',
    capture: '200',
    deny: '202',
    cancel: '202',
    expire: '202',
    pending: '201',
  }

  return {
    transaction_type: 'on-us',
    transaction_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
    transaction_status: status,
    transaction_id: `trans_${Date.now()}`,
    status_message: 'midtrans payment notification',
    status_code: statusCodeMap[status] || '200',
    signature_key: 'test_signature_key_' + Date.now(),
    settlement_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
    pop_id: `pop_${Date.now()}`,
    payment_type: 'qris',
    order_id: orderId,
    merchant_id: 'G442431684',
    merchant_cross_reference_id: `ref_${Date.now()}`,
    issuer: 'gopay',
    gross_amount: '80000.00',
    fraud_status: 'accept',
    expiry_time: new Date(Date.now() + 900000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19),
    customer_details: {
      full_name: 'Test Customer',
      email: 'customer@example.com',
    },
    currency: 'IDR',
    acquirer: 'gopay',
  }
}

/**
 * Assert wrapper with detailed output
 */
export function assert(condition, message) {
  if (!condition) {
    throw new Error(`❌ Assertion failed: ${message}`)
  }
  console.log(`   ✅ ${message}`)
}

/**
 * Assert equality
 */
export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `❌ Assertion failed: ${message}\n   Expected: ${expected}\n   Actual: ${actual}`,
    )
  }
  console.log(`   ✅ ${message}`)
}

/**
 * Assert exists
 */
export function assertExists(value, message) {
  if (!value) {
    throw new Error(`❌ Assertion failed: ${message} - value doesn't exist`)
  }
  console.log(`   ✅ ${message}`)
}

/**
 * Test timer
 */
export class Timer {
  constructor(name) {
    this.name = name
    this.start = Date.now()
  }

  elapsed() {
    return Date.now() - this.start
  }

  log() {
    console.log(`⏱️  ${this.name}: ${this.elapsed()}ms`)
  }
}
