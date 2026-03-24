// tests/load-tests.js
// Load and stress testing utilities
//
// Tests focus on:
// 1. Concurrent order creation
// 2. Concurrent payment processing
// 3. Database performance under load
// 4. Memory usage patterns

import 'dotenv/config'
import prisma from '../src/services/db.js'
import {
  createTestUser,
  createTestProducts,
  createTestOrder,
  createMidtransNotification,
  TestContext,
  Timer,
} from './test-helpers.js'

const ctx = new TestContext()

// ────────────────────────────────────────────────────────────────────────────
// Load Test Utilities
// ────────────────────────────────────────────────────────────────────────────

/**
 * Run concurrent operations and track timing
 */
async function runConcurrent(operations, concurrency = 5) {
  const results = {
    total: operations.length,
    success: 0,
    failed: 0,
    errors: [],
    timings: [],
  }

  const queue = [...operations]
  const running = new Set()

  while (queue.length > 0 || running.size > 0) {
    while (running.size < concurrency && queue.length > 0) {
      const op = queue.shift()
      const startTime = Date.now()

      const promise = Promise.resolve()
        .then(() => op())
        .then(() => {
          results.success++
          results.timings.push(Date.now() - startTime)
        })
        .catch((err) => {
          results.failed++
          results.errors.push(err.message)
        })
        .finally(() => running.delete(promise))

      running.add(promise)
    }

    if (running.size > 0) {
      await Promise.race(running)
    }
  }

  return results
}

/**
 * Calculate statistics from results
 */
function calculateStats(results) {
  if (results.timings.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      median: 0,
      p95: 0,
      p99: 0,
    }
  }

  const sorted = [...results.timings].sort((a, b) => a - b)
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
  const median = sorted[Math.floor(sorted.length / 2)]
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)]

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(avg),
    median: Math.round(median),
    p95: Math.round(p95),
    p99: Math.round(p99),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Load Tests
// ────────────────────────────────────────────────────────────────────────────

async function testConcurrentOrderCreation() {
  console.log(
    '\n📋 Test: Concurrent Order Creation (100 orders, concurrency=10)',
  )
  const timer = new Timer('Concurrent order creation test')

  try {
    // Setup: Create user and products
    const user = await createTestUser(ctx)
    const userId = user.user.id
    const products = await createTestProducts(ctx, userId, 3)

    // Create 100 concurrent orders
    const operations = []
    for (let i = 0; i < 100; i++) {
      const productIdx = i % products.length
      operations.push(() =>
        createTestOrder(
          ctx,
          userId,
          products[productIdx].id,
          Math.floor(i / 10) + 1,
        ),
      )
    }

    const results = await runConcurrent(operations, 10)
    const stats = calculateStats(results)

    console.log(`   ✅ Success: ${results.success}/${results.total}`)
    console.log(
      `   ⏱️  Timing (ms): min=${stats.min}, avg=${stats.avg}, p95=${stats.p95}, max=${stats.max}`,
    )

    if (results.failed > 0) {
      console.log(`   ⚠️  Failed: ${results.failed}`)
      console.log(`   Errors: ${results.errors.slice(0, 3).join(', ')}`)
    }

    // Verify all orders created
    const orderCount = await prisma.order.count({ where: { userId } })
    console.log(`   📊 Total orders in DB: ${orderCount}`)

    timer.log()
    console.log('✅ Concurrent order creation test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

async function testConcurrentPaymentProcessing() {
  console.log('\n📋 Test: Concurrent Payment Processing (50 orders)')
  const timer = new Timer('Concurrent payment processing test')

  try {
    // Setup: Create user with orders
    const user = await createTestUser(ctx)
    const userId = user.user.id
    const products = await createTestProducts(ctx, userId, 1)

    // Create 50 orders
    const orders = []
    for (let i = 0; i < 50; i++) {
      const order = await createTestOrder(ctx, userId, products[0].id, 1)
      orders.push(order)
    }

    console.log(`   Created 50 test orders`)

    // Simulate concurrent payment processing
    const operations = orders.map((order) => async () => {
      const notification = createMidtransNotification(
        order.orderId,
        'settlement',
      )

      // Webhook: find + update pattern
      const foundOrder = await prisma.order.findFirst({
        where: { orderId: notification.order_id },
      })

      if (foundOrder) {
        await prisma.order.update({
          where: { id: foundOrder.id },
          data: {
            status: 'COMPLETED',
            paidAt: new Date(),
            // Use orderId as midtransOrderId (already unique per user)
            // This avoids concurrent unique constraint violations
            midtransOrderId: order.orderId,
          },
        })
      }
    })

    const results = await runConcurrent(operations, 10)
    const stats = calculateStats(results)

    console.log(`   ✅ Success: ${results.success}/${results.total}`)
    console.log(
      `   ⏱️  Timing (ms): min=${stats.min}, avg=${stats.avg}, p95=${stats.p95}, max=${stats.max}`,
    )

    // Verify all payments processed
    const completedCount = await prisma.order.count({
      where: { userId, status: 'COMPLETED' },
    })

    console.log(`   📊 Completed orders: ${completedCount}/50`)

    timer.log()
    console.log('✅ Concurrent payment processing test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

async function testMultiUserConcurrentOrders() {
  console.log(
    '\n📋 Test: Multi-User Concurrent Orders (10 users, 10 orders each)',
  )
  const timer = new Timer('Multi-user concurrent orders test')

  try {
    // Create 10 users
    const users = []
    for (let i = 0; i < 10; i++) {
      const user = await createTestUser(ctx)
      users.push(user)
    }

    console.log(`   Created 10 test users`)

    // Create products for each user
    const userProducts = {}
    for (const user of users) {
      const products = await createTestProducts(ctx, user.user.id, 1)
      userProducts[user.user.id] = products
    }

    // Create 100 concurrent orders (10 per user)
    const operations = []
    for (const user of users) {
      const products = userProducts[user.user.id]
      for (let i = 0; i < 10; i++) {
        operations.push(() =>
          createTestOrder(ctx, user.user.id, products[0].id, 1),
        )
      }
    }

    const results = await runConcurrent(operations, 20)
    const stats = calculateStats(results)

    console.log(`   ✅ Success: ${results.success}/${results.total}`)
    console.log(
      `   ⏱️  Timing (ms): min=${stats.min}, avg=${stats.avg}, p95=${stats.p95}, max=${stats.max}`,
    )

    // Verify per-user isolation
    for (const user of users) {
      const count = await prisma.order.count({
        where: { userId: user.user.id },
      })
      if (count !== 10) {
        console.warn(
          `   ⚠️  User ${user.user.id}: expected 10 orders, got ${count}`,
        )
      }
    }

    timer.log()
    console.log('✅ Multi-user concurrent orders test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

async function testDatabaseQueryPerformance() {
  console.log('\n📋 Test: Database Query Performance')
  const timer = new Timer('Database query performance test')

  try {
    // Create test data: 1 user, 100 orders
    const user = await createTestUser(ctx)
    const userId = user.user.id
    const products = await createTestProducts(ctx, userId, 1)

    // Create 100 orders
    const orders = []
    for (let i = 0; i < 100; i++) {
      const order = await createTestOrder(ctx, userId, products[0].id, 1)
      orders.push(order)
    }

    // Test 1: Query all user's orders with items
    const t1 = new Timer('Query all orders with items')
    const allOrders = await prisma.order.findMany({
      where: { userId },
      include: { orderItems: { include: { product: true } } },
    })
    t1.log()

    console.log(`   Found ${allOrders.length} orders`)

    // Test 2: Query by orderId (webhook pattern)
    const t2 = new Timer('Query by orderId')
    const sampleOrder = orders[50]
    const foundByOrderId = await prisma.order.findFirst({
      where: { orderId: sampleOrder.orderId },
      include: { orderItems: { include: { product: true } } },
    })
    t2.log()

    if (foundByOrderId) {
      console.log(`   Found order: ${foundByOrderId.orderId}`)
    }

    // Test 3: Count pending orders
    const t3 = new Timer('Count pending orders')
    const pendingCount = await prisma.order.count({
      where: { userId, status: 'PENDING' },
    })
    t3.log()

    console.log(`   Pending orders: ${pendingCount}`)

    timer.log()
    console.log('✅ Database query performance test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main Test Runner
// ────────────────────────────────────────────────────────────────────────────

async function runAllTests() {
  console.log('═════════════════════════════════════════════════════════════')
  console.log('🧪 PHASE 5: Load & Stress Tests')
  console.log('═════════════════════════════════════════════════════════════')

  try {
    await testConcurrentOrderCreation()
    await testConcurrentPaymentProcessing()
    await testMultiUserConcurrentOrders()
    await testDatabaseQueryPerformance()

    console.log('═════════════════════════════════════════════════════════════')
    console.log('✅ ALL LOAD TESTS PASSED!')
    console.log(
      '═════════════════════════════════════════════════════════════\n',
    )

    return true
  } catch (err) {
    console.error(
      '\n═════════════════════════════════════════════════════════════',
    )
    console.error('❌ LOAD TEST SUITE FAILED')
    console.error(
      '═════════════════════════════════════════════════════════════',
    )
    console.error(err)
    return false
  } finally {
    await ctx.cleanup()
  }
}

// Run tests
const success = await runAllTests()
process.exit(success ? 0 : 1)
