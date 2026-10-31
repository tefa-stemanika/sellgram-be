// tests/webhook-tests.js
// Webhook integration tests for payment notification flow
//
// Tests focus on:
// 1. Webhook signature validation
// 2. Order status transitions
// 3. Payment success flow (PENDING → COMPLETED)
// 4. Payment failed flow (PENDING → PAYMENT_FAILED)
// 5. Admin notification dispatch
// 6. Multi-user payment isolation

import 'dotenv/config'
import prisma from '../src/services/db.js'
import {
  createTestUser,
  createTestProducts,
  createTestOrder,
  createMidtransNotification,
  assert,
  assertEqual,
  assertExists,
  TestContext,
  Timer,
} from './test-helpers.js'
import { isPaymentSuccess, isPaymentFailed } from '../src/services/midtrans.js'
import { handleMidtransWebhook } from '../src/api/controllers/webhook.controller.js'
import { notifQueue } from '../src/services/queue.js'
import { redisDel, redisPing } from '../src/services/redis.js'
import { encrypt } from '../src/utils/encryption.js'
import crypto from 'node:crypto'

const ctx = new TestContext()

// ────────────────────────────────────────────────────────────────────────────
// Webhook Notification Tests
// ────────────────────────────────────────────────────────────────────────────

async function testPaymentSuccessNotification() {
  console.log('\n📋 Test: Payment Success Notification Flow')
  const timer = new Timer('Payment success flow test')

  try {
    // Setup
    const user = await createTestUser(ctx)
    const userId = user.user.id
    const products = await createTestProducts(ctx, userId, 1)
    const order = await createTestOrder(ctx, userId, products[0].id, 1)

    // Test 1: Create Midtrans notification for success
    const notification = createMidtransNotification(order.orderId, 'settlement')

    assert(
      isPaymentSuccess(notification),
      'Notification recognized as payment success',
    )
    assertEqual(
      notification.order_id,
      order.orderId,
      'Notification references correct order',
    )

    // Test 2: Simulate webhook processing - find order by orderId
    const foundOrder = await prisma.order.findFirst({
      where: { orderId: notification.order_id },
      include: { orderItems: { include: { product: true } } },
    })

    assertExists(foundOrder, 'Order found by orderId')
    assertEqual(foundOrder.userId, userId, 'Order belongs to correct user')
    assertEqual(foundOrder.status, 'PENDING', 'Order starts in PENDING state')

    // Test 3: Update order status to COMPLETED (webhook action)
    const completedOrder = await prisma.order.update({
      where: { id: foundOrder.id },
      data: {
        status: 'COMPLETED',
        paidAt: new Date(),
        // Use orderId as midtransOrderId (already unique per user)
        midtransOrderId: order.orderId,
      },
    })

    assertEqual(
      completedOrder.status,
      'COMPLETED',
      'Order transitioned to COMPLETED',
    )
    assertExists(completedOrder.paidAt, 'Payment timestamp recorded')
    assertEqual(
      completedOrder.midtransOrderId,
      order.orderId,
      'Midtrans transaction ID stored',
    )

    // Test 4: Verify order data integrity
    const reloadedOrder = await prisma.order.findUnique({
      where: { id: completedOrder.id },
      include: { orderItems: { include: { product: true } } },
    })

    assertEqual(reloadedOrder.orderItems.length, 1, 'Order items preserved')
    assertEqual(
      reloadedOrder.orderItems[0].product.name,
      products[0].name,
      'Product data preserved',
    )

    timer.log()
    console.log('✅ Payment success test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

async function testPaymentFailedNotification() {
  console.log('\n📋 Test: Payment Failed Notification Flow')
  const timer = new Timer('Payment failed flow test')

  try {
    // Setup
    const user = await createTestUser(ctx)
    const userId = user.user.id
    const products = await createTestProducts(ctx, userId, 1)
    const order = await createTestOrder(ctx, userId, products[0].id, 1)

    // Test 1: Create failed notification
    const notification = createMidtransNotification(order.orderId, 'deny')

    assert(
      isPaymentFailed(notification),
      'Notification recognized as payment failed',
    )

    // Test 2: Find and update order
    const foundOrder = await prisma.order.findFirst({
      where: { orderId: notification.order_id },
    })

    const failedOrder = await prisma.order.update({
      where: { id: foundOrder.id },
      data: { status: 'PAYMENT_FAILED' },
    })

    assertEqual(
      failedOrder.status,
      'PAYMENT_FAILED',
      'Order marked as payment failed',
    )
    assert(
      failedOrder.paidAt === null,
      'No payment timestamp for failed payment',
    )

    timer.log()
    console.log('✅ Payment failed test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

async function testPaymentExpiredNotification() {
  console.log('\n📋 Test: Payment Expired Notification Flow')
  const timer = new Timer('Payment expired flow test')

  try {
    const user = await createTestUser(ctx)
    const userId = user.user.id
    const products = await createTestProducts(ctx, userId, 1)
    const order = await createTestOrder(ctx, userId, products[0].id, 1)

    // Create expired notification
    const notification = createMidtransNotification(order.orderId, 'expire')

    assert(isPaymentFailed(notification), 'Expired payment treated as failed')

    // Find and update
    const foundOrder = await prisma.order.findFirst({
      where: { orderId: notification.order_id },
    })

    const expiredOrder = await prisma.order.update({
      where: { id: foundOrder.id },
      data: { status: 'PAYMENT_FAILED' },
    })

    assertEqual(
      expiredOrder.status,
      'PAYMENT_FAILED',
      'Expired order marked as payment failed',
    )

    timer.log()
    console.log('✅ Payment expired test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

async function testMultiUserPaymentIsolation() {
  console.log('\n📋 Test: Multi-User Payment Isolation')
  const timer = new Timer('Multi-user payment isolation test')

  try {
    // Setup: 2 users with 2 orders each
    const user1 = await createTestUser(ctx)
    const user2 = await createTestUser(ctx)

    const products1 = await createTestProducts(ctx, user1.user.id, 1)
    const products2 = await createTestProducts(ctx, user2.user.id, 1)

    const user1Order1 = await createTestOrder(
      ctx,
      user1.user.id,
      products1[0].id,
      1,
    )
    const user2Order1 = await createTestOrder(
      ctx,
      user2.user.id,
      products2[0].id,
      1,
    )

    // Test 1: Process user1's payment
    const notif1 = createMidtransNotification(user1Order1.orderId, 'settlement')
    const foundOrder1 = await prisma.order.findFirst({
      where: { orderId: notif1.order_id },
    })

    const completedOrder1 = await prisma.order.update({
      where: { id: foundOrder1.id },
      data: { status: 'COMPLETED' },
    })

    assertEqual(
      completedOrder1.userId,
      user1.user.id,
      'User1 order marked complete',
    )

    // Test 2: User2's order still PENDING
    const refreshedOrder2 = await prisma.order.findUnique({
      where: { id: user2Order1.id },
    })

    assertEqual(refreshedOrder2.status, 'PENDING', 'User2 order still pending')

    // Test 3: Verify isolation - user1 cannot see user2's orders
    const user1Orders = await prisma.order.findMany({
      where: { userId: user1.user.id },
    })

    const user2Orders = await prisma.order.findMany({
      where: { userId: user2.user.id },
    })

    assertEqual(user1Orders.length, 1, 'User1 sees only their order')
    assertEqual(user2Orders.length, 1, 'User2 sees only their order')
    assertEqual(user1Orders[0].status, 'COMPLETED', 'User1 order is completed')
    assertEqual(
      user2Orders[0].status,
      'PENDING',
      'User2 order is still pending',
    )

    timer.log()
    console.log('✅ Multi-user isolation test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

async function testWebhookOrderIdLookup() {
  console.log(
    '\n📋 Test: Webhook Order Lookup by orderId (Composite Key Scenario)',
  )
  const timer = new Timer('Order lookup test')

  try {
    // Create multiple users with orders
    const users = []
    const orders = []

    for (let i = 0; i < 3; i++) {
      const user = await createTestUser(ctx)
      const products = await createTestProducts(ctx, user.user.id, 1)
      const order = await createTestOrder(ctx, user.user.id, products[0].id, 1)

      users.push(user)
      orders.push(order)
    }

    // Test: Query each order by orderId and verify correct user assignment
    for (const order of orders) {
      const notification = createMidtransNotification(
        order.orderId,
        'settlement',
      )

      // This is the exact webhook query
      const foundOrder = await prisma.order.findFirst({
        where: { orderId: notification.order_id },
        include: { orderItems: { include: { product: true } } },
      })

      assertExists(foundOrder, `Order ${order.orderId} found`)
      assertEqual(foundOrder.id, order.id, 'Correct order instance returned')
      assertEqual(foundOrder.userId, order.userId, 'Correct user extracted')
    }

    timer.log()
    console.log('✅ Order lookup test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

async function testWebhookUpdateWithPrimaryKey() {
  console.log('\n📋 Test: Webhook Update using Primary Key (After findFirst)')
  const timer = new Timer('Update with primary key test')

  try {
    const user = await createTestUser(ctx)
    const products = await createTestProducts(ctx, user.user.id, 1)
    const order = await createTestOrder(ctx, user.user.id, products[0].id, 1)

    // Simulate webhook: findFirst then update with id (not orderId)
    const foundOrder = await prisma.order.findFirst({
      where: { orderId: order.orderId },
    })

    assertExists(foundOrder, 'Order found by orderId')

    // This is the CORRECT way to update (using primary key)
    const updatedOrder = await prisma.order.update({
      where: { id: foundOrder.id }, // Use primary key
      data: {
        status: 'COMPLETED',
        paidAt: new Date(),
      },
    })

    assertEqual(updatedOrder.id, order.id, 'Correct order updated')
    assertEqual(updatedOrder.status, 'COMPLETED', 'Status updated correctly')

    // Verify database state
    const reloaded = await prisma.order.findUnique({
      where: { id: order.id },
    })

    assertEqual(reloaded.status, 'COMPLETED', 'Update persisted to database')

    timer.log()
    console.log('✅ Update with primary key test PASSED\n')
  } catch (err) {
    console.error('❌ Test failed:', err.message)
    throw err
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Controller-level test: job terantre dulu, status belakangan, dan order milik
// tenant lain dengan orderId sama tidak boleh ikut ditandai lunas.
// ────────────────────────────────────────────────────────────────────────────

async function testWebhookControllerQueuesBeforeCompleting() {
  console.log(
    '\n📋 Test: Webhook controller antrekan job sebelum mengubah status',
  )

  const serverKey = `sk-test-${Date.now()}`
  const userA = await createTestUser(ctx)
  const userB = await createTestUser(ctx)

  try {
    for (const user of [userA, userB]) {
      await prisma.botCredential.create({
        data: {
          userId: user.user.id,
          key: 'MIDTRANS_SERVER_KEY_SANDBOX',
          value: encrypt(serverKey),
        },
      })
      await redisDel(`tenant_config:${user.user.id}`).catch(() => {})
    }

    const productsA = await createTestProducts(ctx, userA.user.id, 1)
    const productsB = await createTestProducts(ctx, userB.user.id, 1)
    const orderA = await createTestOrder(ctx, userA.user.id, productsA[0].id, 1)
    const orderB = await createTestOrder(ctx, userB.user.id, productsB[0].id, 2)

    await prisma.order.update({
      where: { id: orderB.id },
      data: { orderId: orderA.orderId },
    })

    const notification = createMidtransNotification(orderA.orderId, 'settlement')
    notification.gross_amount = String(orderA.totalPrice)
    notification.signature_key = crypto
      .createHash('sha512')
      .update(
        `${notification.order_id}${notification.status_code}${notification.gross_amount}${serverKey}`,
      )
      .digest('hex')

    const response = await callWebhook(notification)

    const storedA = await prisma.order.findUnique({ where: { id: orderA.id } })
    const storedB = await prisma.order.findUnique({ where: { id: orderB.id } })

    assertEqual(
      storedB.status,
      'PENDING',
      'order tenant lain dengan orderId sama tidak disentuh',
    )

    // Redis hidup = cabang 200 wajib dipakai; cabang 500 hanya sah kalau
    // queue memang tidak bisa dihubungi (kalau tidak, regresi jobId lolos
    // diam-diam lewat cabang pengaman).
    const redisHidup = await redisPing().catch(() => false)

    if (redisHidup) {
      assertEqual(
        response.status,
        200,
        `webhook sah dengan Redis hidup harus 200, dapat ${response.status}: ${JSON.stringify(response.body)}`,
      )
      assertEqual(storedA.status, 'COMPLETED', 'nominal cocok → order dilunasi')

      const job = await notifQueue.getJob(`payment-success-${orderA.id}`)
      assert(
        job !== null,
        'job pemenuhan terantre dengan jobId deterministik (id tanpa tanda :)',
      )

      const dup = await callWebhook(notification)
      assertEqual(dup.status, 200, 'webhook duplikat dijawab 200')
      assertEqual(dup.body?.skipped, true, 'webhook duplikat tidak diproses ulang')
      await job?.remove().catch(() => {})
    } else {
      // Queue mati: order harus tetap PENDING supaya retry Midtrans memproses
      // ulang, tidak jadi lunas tanpa pemenuhan.
      assertEqual(response.status, 500, 'queue mati → 500 agar Midtrans retry')
      assertEqual(
        storedA.status,
        'PENDING',
        'status tidak dinaikkan sebelum job terantre',
      )
    }

    console.log('✅ Webhook controller ordering test PASSED\n')
  } finally {
    for (const user of [userA, userB]) {
      await redisDel(`tenant_config:${user.user.id}`).catch(() => {})
    }
  }
}

async function callWebhook(notification) {
  const state = { status: 0, body: null }
  const res = {
    status(code) {
      state.status = code
      return res
    },
    json(body) {
      state.body = body
      return res
    },
  }
  await handleMidtransWebhook({ body: notification }, res, (err) => {
    throw err
  })
  return state
}

// ────────────────────────────────────────────────────────────────────────────
// Main Test Runner
// ────────────────────────────────────────────────────────────────────────────

async function runAllTests() {
  console.log('═════════════════════════════════════════════════════════════')
  console.log('🧪 PHASE 5: Webhook Payment Flow Tests')
  console.log('═════════════════════════════════════════════════════════════')

  try {
    await testPaymentSuccessNotification()
    await testPaymentFailedNotification()
    await testPaymentExpiredNotification()
    await testMultiUserPaymentIsolation()
    await testWebhookOrderIdLookup()
    await testWebhookUpdateWithPrimaryKey()
    await testWebhookControllerQueuesBeforeCompleting()

    console.log('═════════════════════════════════════════════════════════════')
    console.log('✅ ALL WEBHOOK TESTS PASSED!')
    console.log(
      '═════════════════════════════════════════════════════════════\n',
    )

    return true
  } catch (err) {
    console.error(
      '\n═════════════════════════════════════════════════════════════',
    )
    console.error('❌ WEBHOOK TEST SUITE FAILED')
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
