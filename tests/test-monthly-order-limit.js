import 'dotenv/config'
import prisma from '../src/services/db.js'
import { redisDel } from '../src/services/redis.js'

const BASE_URL = process.env.BASE_URL || 'http://localhost:5505'
const JWT = process.env.JWT || process.argv[2]

if (!JWT) {
  console.error('Usage: JWT=<token> node tests/test-monthly-order-limit.js')
  console.error('   or: node tests/test-monthly-order-limit.js <token>')
  process.exit(1)
}

async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Authorization': `Bearer ${JWT}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    ...opts,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, ok: res.ok, data }
}

async function main() {
  // 1. Get user info
  const me = await api('/api/auth/me')
  if (!me.ok) {
    console.error('Token invalid:', me.status, me.status === 401 ? '(expired?)' : JSON.stringify(me.data))
    process.exit(1)
  }

  const user = me.data?.data || me.data
  const userId = user.id
  const plan = user.plan
  const LIMITS = { FREE: 10, STARTER: 200, PRO: Infinity }
  const maxOrders = LIMITS[plan]

  if (!maxOrders) {
    console.error(`Unknown plan: ${plan}`)
    process.exit(1)
  }

  console.log(`User: ${userId}`)
  console.log(`Plan: ${plan} (max orders/month: ${maxOrders === Infinity ? 'unlimited' : maxOrders})\n`)

  // 2. Find or create a product to use for order testing (need valid UUID)
  let testProductId = null
  const existingProduct = await prisma.product.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  if (existingProduct) {
    testProductId = existingProduct.id
    console.log(`Using existing product: ${testProductId}\n`)
  } else {
    const prodRes = await api('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        name: '[LIMIT-TEST] Product',
        description: 'Temporary',
        price: 1,
        emoji: '📦',
      }),
    })
    if (!prodRes.ok) {
      console.error('Failed to create product:', JSON.stringify(prodRes.data))
      process.exit(1)
    }
    testProductId = prodRes.data?.data?.id || prodRes.data?.id
    console.log(`Created test product: ${testProductId}\n`)
  }

  if (maxOrders === Infinity) {
    console.log('PRO plan — unlimited orders. Verifying order creation works...\n')
    const r = await api('/api/public/orders', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        productId: testProductId,
        quantity: 1,
        customerName: 'Test',
        customerPhone: '08123456789',
      }),
    })
    if (r.status === 403 && (r.data?.message || '').includes('order bulanan')) {
      console.log('  FAIL: Monthly order limit unexpectedly blocked for PRO plan!')
      process.exit(1)
    }
    console.log('  PASS: PRO plan does not block order creation.\n')
    if (!existingProduct) await api(`/api/products/${testProductId}`, { method: 'DELETE' }).catch(() => {})
    process.exit(0)
  }

  // 3. Count current COMPLETED orders this month
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const currentCount = await prisma.order.count({
    where: { userId, status: 'COMPLETED', paidAt: { gte: startOfMonth } },
  })
  const remaining = maxOrders - currentCount
  console.log(`Current COMPLETED orders this month: ${currentCount}`)
  console.log(`Remaining quota: ${remaining}`)

  if (currentCount >= maxOrders) {
    console.log(`\nLimit already reached (${currentCount}/${maxOrders}).`)
    console.log('Testing that order creation is blocked...\n')
    const r = await api('/api/public/orders', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        productId: testProductId,
        quantity: 1,
        customerName: 'Test',
        customerPhone: '08123456789',
      }),
    })
    if (r.status === 403 && (r.data?.message || '').includes('order bulanan')) {
      console.log('PASS: Order creation blocked (MONTHLY_ORDER_LIMIT_EXCEEDED)')
    } else {
      console.log('FAIL: Expected 403 but got', r.status, JSON.stringify(r.data).slice(0, 200))
      process.exit(1)
    }
    if (!existingProduct) await api(`/api/products/${testProductId}`, { method: 'DELETE' }).catch(() => {})
    await redisDel(redisKey({ userId })).catch(() => {})
    process.exit(0)
  }

  // 4. Create enough COMPLETED orders to fill quota
  console.log(`\nCreating ${remaining} COMPLETED orders to fill quota...\n`)
  for (let i = 0; i < remaining; i++) {
    const order = await prisma.order.create({
      data: {
        userId,
        orderId: `LIMIT-TEST-${Date.now()}-${i}`,
        telegramId: 0,
        customerName: 'Test Limit',
        totalPrice: 1,
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    })
    await prisma.orderItem.create({
      data: { orderId: order.id, productId: testProductId, quantity: 1, unitPrice: 1 },
    })
    process.stdout.write('.')
  }
  console.log(`\n  Created ${remaining} COMPLETED orders.\n`)

  // 5. Clear Redis cache
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const redisKey = `monthly_orders:${userId}:${yyyymm}`
  await redisDel(redisKey).catch(() => {})
  console.log('  Cleared Redis monthly order counter.\n')

  // 6. Test limit via API (using valid productId)
  console.log('Testing order creation limit (expecting 403)...\n')
  const r = await api('/api/public/orders', {
    method: 'POST',
    body: JSON.stringify({
      userId,
      productId: testProductId,
      quantity: 1,
      customerName: 'Test',
      customerPhone: '08123456789',
    }),
  })
  const blocked = r.status === 403 && (r.data?.message || '').includes('order bulanan')

  if (blocked) {
    console.log('PASS: Order creation blocked with MONTHLY_ORDER_LIMIT_EXCEEDED')
  } else {
    console.log('FAIL: Expected 403 limit error, got:')
    console.log(`  status=${r.status}`, JSON.stringify(r.data).slice(0, 300))
  }

  // 7. Cleanup
  console.log('\nCleaning up test data...')
  const delCount = await prisma.orderItem.deleteMany({
    where: { order: { orderId: { startsWith: 'LIMIT-TEST-' }, userId } },
  })
  console.log(`  Deleted ${delCount.count} order items`)
  const orderIds = await prisma.order.findMany({
    where: { userId, orderId: { startsWith: 'LIMIT-TEST-' } },
    select: { id: true },
  })
  if (orderIds.length > 0) {
    await prisma.order.deleteMany({
      where: { userId, orderId: { startsWith: 'LIMIT-TEST-' } },
    })
  }
  console.log(`  Deleted ${orderIds.length} test orders`)
  if (!existingProduct) {
    await api(`/api/products/${testProductId}`, { method: 'DELETE' }).catch(() => {})
    console.log('  Deleted test product')
  }
  await redisDel(redisKey).catch(() => {})
  console.log('  Cleared Redis counter (restored to DB-accurate)\n')

  console.log(blocked ? 'ALL TESTS PASSED' : 'TEST FAILED')
  process.exit(blocked ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
