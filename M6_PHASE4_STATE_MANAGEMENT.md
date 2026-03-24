# M6 PHASE 4 — State Management Refactoring

**Status:** ✅ State machines refactored  
**Date:** March 24, 2026  
**Next:** Handlers update + Integration testing

---

## 📋 What Was Completed in Phase 4

### 1. Order State Machine (`src/services/order.js`)

✅ **Multi-tenant key scoping:**

- Changed from: `orders.get(userId)`
- Changed to: `orders.get(${userId}:${telegramId})`
- Enables: Independent order state for each telegram user per tenant

✅ **New function signatures:**

```javascript
// OLD (single-key)
getOrder(userId)
setOrder(userId, data)
resetOrder(userId)

// NEW (composite key)
getOrder(userId, telegramId)
setOrder(userId, telegramId, data)
resetOrder(userId, telegramId)
```

✅ **Auto-cleanup mechanism:**

- Tracks timestamp per order state
- Deletes entries older than 24 hours
- Cleanup runs automatically on `getOrder()` call
- Prevents memory leak from long-running bots

✅ **Statistics tracking:**

- `getOrderStats()` → {total, active, expired}
- Useful for monitoring bot health

### 2. Session/Chat History (`src/services/session.js`)

✅ **Multi-tenant key scoping:**

- Changed from: `sessions.get(userId)`
- Changed to: `sessions.get(${userId}:${telegramId})`
- Enables: Independent chat history for each telegram user per tenant

✅ **New function signatures:**

```javascript
// OLD
getHistory(userId)
addMessage(userId, role, text)
clearHistory(userId)

// NEW
getHistory(userId, telegramId)
addMessage(userId, telegramId, role, text)
clearHistory(userId, telegramId)
```

✅ **Session limits per user:**

- Max 20 messages per chat history (unchanged)
- Max 50 active sessions per tenant user (NEW)
- Cleanup overflowing sessions (oldest first)

✅ **Auto-cleanup mechanism:**

- Tracks timestamp per session
- Deletes entries older than 24 hours
- Prevents memory bloat from inactive chats

✅ **Session statistics:**

- `getSessionStats()` → {total, byUser: {...}, maxPerUser}
- Per-tenant user session tracking
- Backward-compat function: `getActiveSessionCount()`

---

## 🔧 Required Handler Updates

Handlers yang sekarang perlu diupdate (**untuk Phase 2 - sudah direncanakan**):

### Files Using `getOrder()`:

1. **src/handlers/orderHandler.js**
   - `handleMenu()` → Call `getOrder(userId, telegramId)`
   - `handlePesan()` → Call `getOrder(userId, telegramId)`
   - `handleKonfirmasi()` → Call `setOrder(userId, telegramId, ...)`
   - `handleOrderInput()` → Use composite key state

2. **src/handlers/buttonHandler.js**
   - `handleConfirmOrder()` → Call `resetOrder(userId, telegramId)`
   - `handleCancelOrder()` → Call `resetOrder(userId, telegramId)`

### Files Using `getHistory()`/`addMessage()`:

1. **src/services/gemini.js**
   - `askGemini(msg, userId, history)`
   - Load history: `getHistory(userId, msg.chat.id)`
   - Add messages: `addMessage(userId, msg.chat.id, 'user', msg.text)`

2. **src/handlers/messageHandler.js**
   - `handleMessage(bot, msg, userId)`
   - Get chat history: `getHistory(userId, msg.chat.id)`

---

## 📊 Data Structure Notes

### Order State Example

```javascript
// Key = "1:123456789" (userId:telegramId)
// Value:
{
  state: 'selecting_qty',        // ORDER_STATE.SELECTING_QTY
  selectedProduct: {             // Produk yang dipilih
    id: 1,
    name: 'Nasi Goreng Spesial',
    price: 25000,
    emoji: '🍳'
  },
  quantity: 0,                   // Qty yang dipilih
  awaitingCustomQty: false       // Waiting for custom input?
}
```

### Session History Example

```javascript
// Key = "1:123456789" (userId:telegramId)
// Value = [
//   { role: 'user', text: 'Ada menu apa aja?' },
//   { role: 'model', text: 'Menu kami: ...' },
//   { role: 'user', text: 'Mau ORDER' },
//   ... MAX 20 messages
// ]
```

---

## 🚀 Testing Phase 4

### Setup Test

```javascript
// test-phase4.js
import {
  getOrder,
  setOrder,
  resetOrder,
  getOrderStats,
} from './src/services/order.js'
import {
  getHistory,
  addMessage,
  getSessionStats,
} from './src/services/session.js'

// Test order state
const order1 = getOrder(1, 123456789)
console.log('Initial order:', order1)
// { state: 'idle', selectedProduct: null, quantity: 0 }

setOrder(1, 123456789, {
  state: 'selecting_product',
  selectedProduct: { id: 1, name: 'Nasi Goreng', price: 25000 },
})

const order2 = getOrder(1, 123456789)
console.log('Updated order:', order2)
// { state: 'selecting_product', selectedProduct: {...}, quantity: 0 }

resetOrder(1, 123456789)
console.log('After reset:', getOrder(1, 123456789))
// { state: 'idle', selectedProduct: null, quantity: 0 }

// Test session
addMessage(1, 123456789, 'user', 'Halo!')
addMessage(1, 123456789, 'model', 'Halo juga!')
addMessage(1, 123456789, 'user', 'Ada menu nasi goreng?')

const history = getHistory(1, 123456789)
console.log('Chat history:', history)
// [
//   { role: 'user', text: 'Halo!' },
//   { role: 'model', text: 'Halo juga!' },
//   { role: 'user', text: 'Ada menu nasi goreng?' }
// ]

console.log('Stats:', getSessionStats())
// { total: 1, byUser: { '1': 1 }, maxPerUser: 50 }
```

### Multi-tenant Isolation Test

```javascript
// Test that user 1 and user 2 have separate states
import { getOrder, setOrder } from './src/services/order.js'

// User 1, telegram 111
setOrder(1, 111, { state: 'selecting_product' })

// User 2, telegram 222
setOrder(2, 222, { state: 'confirming' })

// User 1, telegram 333
setOrder(1, 333, { state: 'idle' })

console.log(getOrder(1, 111)) // { state: 'selecting_product', ... }
console.log(getOrder(2, 222)) // { state: 'confirming', ... }
console.log(getOrder(1, 333)) // { state: 'idle', ... }

// ✅ Verifies: Each (userId, telegramId) pair has independent state
```

---

## 🧹 Cleanup & Memory Management

### Auto-cleanup behavior:

1. **Trigger:** Every call to `getOrder()` or `getHistory()`
2. **Action:** Scan timestamps, delete entries > 24 hours old
3. **Frequency:** Lightweight scan (O(n) but n is small)
4. **Benefit:** No background jobs needed, passive cleanup

### Memory estimates (typical load):

```
- 100 active users
- 5 telegram chats per user = 500 (userId, telegramId) pairs
- Per order state: ~200 bytes
- Per chat history: ~5KB (20 messages × 250 bytes)
- Total: (500 × 200) + (500 × 5000) = ~2.6 GB worst case
- Typical (cleanup): ~200MB after 24-hour cleanup
```

---

## 🔄 Integration Checklist (Phase 4 → Phase 2)

Before starting Phase 2 (handlers), verify:

- [x] order.js updated with composite keys
- [x] session.js updated with composite keys
- [x] Cleanup mechanism implemented
- [x] Statistics functions added
- [ ] Handlers updated to pass both userId + telegramId
- [ ] gemini.js updated to use (userId, telegramId) for history
- [ ] Testing with 2+ simultaneous users
- [ ] Verify no memory leaks after 48h runtime

---

## 📝 Quick Reference

### Key size format:

```
"${userId}:${telegramId}"
e.g., "1:123456789"
```

### Function signatures summary:

```javascript
// order.js (UPDATED)
export function getOrder(userId, telegramId)
export function setOrder(userId, telegramId, data)
export function resetOrder(userId, telegramId)
export function generateOrderId()
export function getOrderStats()

// session.js (UPDATED)
export function getHistory(userId, telegramId)
export function addMessage(userId, telegramId, role, text)
export function clearHistory(userId, telegramId)
export function getActiveSessionCount()
export function getSessionStats()
```

---

## 🚀 Next Steps (Phase 2 - Handlers)

Now that state management is multi-tenant ready:

1. **Update messageHandler.js** — use `addMessage(userId, telegramId, ...)`
2. **Update orderHandler.js** — use `getOrder(userId, telegramId)`, etc.
3. **Update gemini.js** — pass `(userId, telegramId)` for history
4. **Test multi-user** — verify state isolation
5. **Monitor memory** — check for leaks

---

**Phase 4 Status:** ✅ COMPLETE  
**Total Implementation Time:** ~30 minutes  
**Next Phase:** Phase 2 - Handler Refactoring  
**Estimated Phase 2 Time:** 3-4 hours
