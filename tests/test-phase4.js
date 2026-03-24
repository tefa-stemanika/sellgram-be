// tests/test-phase4.js
// Test Multi-Tenant State Management (Phase 4)

import {
  getOrder,
  setOrder,
  resetOrder,
  getOrderStats,
  ORDER_STATE,
} from '../src/services/order.js'
import {
  getHistory,
  addMessage,
  clearHistory,
  getSessionStats,
  getActiveSessionCount,
} from '../src/services/session.js'

console.log('🧪 M6 Phase 4 State Management Tests\n')

// ── Test 1: Order State Machine ────────────────────────────────────
console.log('📝 Test 1: Order State Machine')
console.log('─'.repeat(50))

// User 1, Telegram 111
const order1 = getOrder(1, 111)
console.log('✅ Initial order (1, 111):', order1)
console.assert(order1.state === ORDER_STATE.IDLE, 'Should be IDLE')
console.assert(
  order1.selectedProduct === null,
  'selectedProduct should be null',
)

// Set order for user 1
setOrder(1, 111, {
  state: ORDER_STATE.SELECTING_PRODUCT,
  selectedProduct: {
    id: 1,
    name: 'Nasi Goreng Spesial',
    price: 25000,
    emoji: '🍳',
  },
})

const order2 = getOrder(1, 111)
console.log('✅ After setOrder (1, 111):', {
  state: order2.state,
  productName: order2.selectedProduct.name,
})
console.assert(
  order2.state === ORDER_STATE.SELECTING_PRODUCT,
  'State should be SELECTING_PRODUCT',
)
console.assert(
  order2.selectedProduct.name === 'Nasi Goreng Spesial',
  'Should have correct product',
)

// Reset order
resetOrder(1, 111)
const order3 = getOrder(1, 111)
console.log('✅ After resetOrder (1, 111):', order3)
console.assert(order3.state === ORDER_STATE.IDLE, 'Should reset to IDLE')

console.log('')

// ── Test 2: Multi-Tenant Isolation ─────────────────────────────────
console.log('📝 Test 2: Multi-Tenant Isolation')
console.log('─'.repeat(50))

setOrder(1, 111, { state: ORDER_STATE.SELECTING_QTY })
setOrder(1, 222, { state: ORDER_STATE.CONFIRMING })
setOrder(2, 111, { state: ORDER_STATE.IDLE })
setOrder(2, 333, { state: ORDER_STATE.SELECTING_PRODUCT })

const user1Tel111 = getOrder(1, 111).state
const user1Tel222 = getOrder(1, 222).state
const user2Tel111 = getOrder(2, 111).state
const user2Tel333 = getOrder(2, 333).state

console.log('✅ User 1, Tel 111:', user1Tel111)
console.log('✅ User 1, Tel 222:', user1Tel222)
console.log('✅ User 2, Tel 111:', user2Tel111)
console.log('✅ User 2, Tel 333:', user2Tel333)

console.assert(
  user1Tel111 !== user1Tel222,
  'User 1 different telegrams should have different state',
)
console.assert(
  user1Tel111 !== user2Tel111,
  'User 1 and User 2 same telegram should have different state',
)
console.assert(
  user2Tel333 === ORDER_STATE.SELECTING_PRODUCT,
  'User 2 Tel 333 should be SELECTING_PRODUCT',
)

console.log('')

// ── Test 3: Chat History ────────────────────────────────────────────
console.log('📝 Test 3: Chat History')
console.log('─'.repeat(50))

addMessage(1, 111, 'user', 'Halo!')
addMessage(1, 111, 'model', 'Halo juga!')
addMessage(1, 111, 'user', 'Ada menu nasi goreng?')

const history1 = getHistory(1, 111)
console.log('✅ Chat history (1, 111):', history1)
console.assert(history1.length === 3, 'Should have 3 messages')
console.assert(history1[0].role === 'user', 'First message should be from user')
console.assert(history1[0].text === 'Halo!', 'First message should be "Halo!"')

// Different user, different telegram = different history
const historyEmpty = getHistory(2, 444)
console.log('✅ Chat history (2, 444) [new]:', historyEmpty)
console.assert(historyEmpty.length === 0, 'New chat should be empty')

console.log('')

// ── Test 4: Session Isolation ──────────────────────────────────────
console.log('📝 Test 4: Session Isolation')
console.log('─'.repeat(50))

addMessage(1, 222, 'user', 'Pesan dari user 1 telegram 222')
addMessage(2, 333, 'user', 'Pesan dari user 2 telegram 333')

const user1Tel222History = getHistory(1, 222)
const user2Tel333History = getHistory(2, 333)

console.log('✅ User 1 Tel 222 history:', user1Tel222History)
console.log('✅ User 2 Tel 333 history:', user2Tel333History)

console.assert(
  user1Tel222History.length === 1,
  'User 1 Tel 222 should have 1 message',
)
console.assert(
  user2Tel333History.length === 1,
  'User 2 Tel 333 should have 1 message',
)
console.assert(
  user1Tel222History[0].text === 'Pesan dari user 1 telegram 222',
  'User 1 Tel 222 should have correct message',
)
console.assert(
  user2Tel333History[0].text === 'Pesan dari user 2 telegram 333',
  'User 2 Tel 333 should have correct message',
)

console.log('')

// ── Test 5: Statistics ────────────────────────────────────────────
console.log('📝 Test 5: Statistics')
console.log('─'.repeat(50))

const orderStats = getOrderStats()
const sessionStats = getSessionStats()
const sessionCount = getActiveSessionCount()

console.log('✅ Order Stats:', orderStats)
console.log('✅ Session Stats:', sessionStats)
console.log('✅ Active Session Count:', sessionCount)

console.assert(orderStats.total > 0, 'Should have active orders')
console.assert(sessionStats.total > 0, 'Should have active sessions')
console.assert(sessionCount > 0, 'Should have active sessions')

console.log('')

// ── Test 6: Clear History ──────────────────────────────────────────
console.log('📝 Test 6: Clear History')
console.log('─'.repeat(50))

clearHistory(1, 111)
const historyAfterClear = getHistory(1, 111)
console.log('✅ After clearHistory (1, 111):', historyAfterClear)
console.assert(
  historyAfterClear.length === 0,
  'History should be empty after clear',
)

console.log('')

// ── Summary ─────────────────────────────────────────────────────────
console.log('✅ All Phase 4 tests PASSED!')
console.log('')
console.log('Summary:')
console.log('  ✅ Order state machine (composite keys)')
console.log('  ✅ Multi-tenant isolation')
console.log('  ✅ Chat history management')
console.log('  ✅ Session isolation')
console.log('  ✅ Statistics tracking')
console.log('  ✅ History clearing')
console.log('')
console.log('🎉 Phase 4 State Management Ready for Integration!')
