# M6 NEXT STEPS — Developer Guide

This is a quick checklist for continuing M6 implementation. **Start here if you're just picking up the work.**

---

## 🎯 Current Status

✅ **Phase 1 — Infrastructure:** DONE (45% of M6)

- User management ✅
- Bot manager ✅
- Config per-user ✅
- Data services scoped ✅
- Database schema updated ✅

🔄 **Phase 2 — Handlers:** NOT STARTED (need you!)

### What Phase 2 Entails

The **handlers** are the core message routing logic. They need to be refactored to:

1. Accept `userId` as a parameter
2. Look up user config: `isAiEnabledForUser(userId)` instead of global `AI_ENABLED`
3. Track order state per `(userId, telegramId)` instead of just `telegramId`

---

## 📝 Phase 2 Checklist (Start Here)

### Task 2.1: Update `src/handlers/messageHandler.js`

**What to change:**

```javascript
// BEFORE (global AI_ENABLED)
export const AI_ENABLED = isAiEnabled()

export async function handleStart(bot, msg) {
  if (AI_ENABLED) {
    /* AI mode */
  }
}

// AFTER (per-user)
export async function handleStart(bot, msg, userId) {
  const aiEnabled = isAiEnabledForUser(userId)
  if (aiEnabled) {
    /* AI mode */
  }
}
```

**Files to import:**

```javascript
import { isAiEnabledForUser } from '../services/configService.js'
```

**Functions to update:**

- `handleStart(bot, msg, userId)`
- `handleHelp(bot, msg, userId)`
- `handleReset(bot, msg, userId)`
- `handleMessage(bot, msg, userId)` — the main one!

**Lines to check:** ~300 total, ~150 need updates

---

### Task 2.2: Update `src/handlers/orderHandler.js`

**What to change:**

For order state machine, need to add userId:

```javascript
// Import order state handler with userId
import { getOrder, setOrder, resetOrder } from '../services/order.js'

// BEFORE:
const orderState = getOrder(telegramId)

// AFTER:
const orderState = getOrder(userId, telegramId)
```

**Functions to update:**

- `handleMenu(bot, msg, userId)`
- `handlePesan(bot, msg, userId)`
- `handleKonfirmasi(bot, msg, userId)`
- `handleBatal(bot, msg, userId)`
- `handleOrderStatus(bot, msg, userId)`
- `handleOrderInput(bot, msg, userId)` — critical validation logic

**Critical fix:**
When saving order, pass userId:

```javascript
// BEFORE:
await saveOrder({ telegramId, product, quantity })

// AFTER:
await saveOrder({ userId, telegramId, product, quantity })
```

---

### Task 2.3: Update `src/handlers/buttonHandler.js`

**What to change:**

Callback handlers need userId:

```javascript
// BEFORE:
bot.on('callback_query', (query) => {
  handleCallbackQuery(bot, query)
})

// AFTER: (in index-m6.js callback registration)
bot.on('callback_query', (query) => {
  handleCallbackQuery(bot, query, userId)
})
```

**Functions to update:**

- All handlers in `buttonHandler.js` — add `userId` param
- Use `getOrder(userId, telegramId)` for state
- Use `saveOrder({ userId, ... })` for saving

**Query handlers to update:**

- `select_product:id` → product lookup scoped
- `select_qty:n` → update order state with userId
- `confirm_order` → save with userId
- `cancel_order` → reset state with userId

---

### Task 2.4: Update `src/services/order.js`

**What to change:**

State machine needs to track by (userId, telegramId):

```javascript
// BEFORE:
const orderState = new Map() // Map<telegramId, state>

export function getOrder(telegramId) {
  return orderState.get(telegramId)
}

// AFTER:
const orderState = new Map() // Map<userIdTelegramId, state>

export function getOrder(userId, telegramId) {
  const key = `${userId}:${telegramId}`
  return orderState.get(key)
}

export function setOrder(userId, telegramId, data) {
  const key = `${userId}:${telegramId}`
  orderState.set(key, data)
}

export function resetOrder(userId, telegramId) {
  const key = `${userId}:${telegramId}`
  orderState.delete(key)
}
```

**State object:** Stays same, just the key changes

```javascript
{
  state: 'SELECTING_PRODUCT',  // or IDLE, SELECTING_QTY, etc
  selectedProduct: { id, name, price },
  quantity: 2,
  awaitingCustomQty: false
}
```

---

### Task 2.5: Update `src/services/session.js`

**Same pattern as order.js:**

```javascript
// BEFORE:
const sessions = new Map() // Map<telegramId, messages[]>

// AFTER:
const sessions = new Map() // Map<userIdTelegramId, messages[]>

export function getHistory(userId, telegramId) {
  const key = `${userId}:${telegramId}`
  return sessions.get(key) || []
}

export function addMessage(userId, telegramId, role, text) {
  const key = `${userId}:${telegramId}`
  const history = sessions.get(key) || []
  history.push({ role, text })
  // ... max 20 messages logic ...
  sessions.set(key, history)
}
```

---

### Task 2.6: Update `src/index-m6.js` Handler Registration

**Pattern (currently a skeleton):**

```javascript
// After spawnAllActiveBots()...

// Register handlers for each bot instance
import { registerHandlersForUser } from './handlers/index.js' // (new file to create)

const { activeBots } = await import('./services/botManager.js')
for (const [userId, botData] of activeBots.entries()) {
  registerHandlersForUser(botData.bot, userId, botData.config)
}

// In src/handlers/index.js (new file):
export function registerHandlersForUser(bot, userId, config) {
  const aiEnabled = config.aiEnabled

  // Register all command handlers with userId
  bot.onText(/\/start/, (msg) => handleStart(bot, msg, userId))
  bot.onText(/\/help/, (msg) => handleHelp(bot, msg, userId))
  // ... etc

  // Register message handler
  bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
      handleMessage(bot, msg, userId)
    }
  })

  // Register callback handler
  bot.on('callback_query', (query) => {
    handleCallbackQuery(bot, query, userId)
  })
}
```

---

### Task 2.7: Update `src/services/gemini.js`

**Small change — add userId to system prompt:**

```javascript
// Get products for system prompt
import { getAllProducts } from './productService.js'

export async function askGemini(msg, userId, history) {
  // Fetch user's products
  const products = await getAllProducts(userId)

  // Use in system prompt
  const systemPrompt = `
    ...
    Produk yang tersedia:
    ${products.map((p) => `${p.emoji} ${p.name} - Rp${p.price}`).join('\n')}
    ...
  `

  // ... rest of function unchanged
}
```

---

## 🔧 Implementation Tips

### Quick Wins

1. **Session keys:** Use `${userId}:${telegramId}` everywhere
2. **Function signatures:** Add `userId` as first param to all handlers
3. **Service calls:** Pass `userId` to getAllProducts, saveOrder, etc.
4. **Testing:** Test with 2 different users + 2 bots running

### Common Patterns

**When you have msg (from Telegram):**

```javascript
// Inside handler, msg.chat.id is telegramId
const telegramId = msg.chat.id
const order = getOrder(userId, telegramId) // use both
```

**When getting products:**

```javascript
// BEFORE:
const products = await getAllProducts()

// AFTER:
const products = await getAllProducts(userId)
```

**When parsing callback data:**

```javascript
// Callback data stays same: "action:payload"
// But handler gets userId from function param
const [action, payload] = query.data.split(':')
```

---

## ✅ Verification Steps

After each task:

1. **Check syntax:** `npm run db:generate`
2. **Type-check:** Run handlers in isolation
3. **Test messages:** Send test message to bot
4. **Check state:** Verify order state uses userId key

## 📊 Effort Breakdown

| Task              | Complexity | Time         |
| ----------------- | ---------- | ------------ |
| messageHandler.js | Medium     | 45 min       |
| orderHandler.js   | Medium     | 45 min       |
| buttonHandler.js  | Medium     | 45 min       |
| order.js          | Low        | 15 min       |
| session.js        | Low        | 15 min       |
| gemini.js         | Low        | 10 min       |
| index-m6.js       | Low        | 20 min       |
| Testing           | Medium     | 1 hour       |
| **TOTAL**         |            | **~4 hours** |

---

## 🚀 Next Phase After Phase 2

Once handlers are done (Phase 2):

**Phase 3:** Webhook & Admin Bot

- [ ] Update webhook.js to find userId from order
- [ ] Update adminBot.js per-user

**Phase 4:** State (if needed)

- [ ] Consider Redis for state if clustering

**Phase 5:** Testing & Deploy

- [ ] Multi-bot testing
- [ ] Webhook testing
- [ ] Production deploy

---

## 📚 Reference Files

- **M6_IMPLEMENTATION_GUIDE.md** — Full architecture & checklist
- **M6_IMPLEMENTATION_SUMMARY.md** — What's already done
- **src/services/configService.js** — Multi-user functions available
- **src/services/botManager.js** — How to access bot instances
- **prisma/schema.prisma** — Updated schema with user_id

---

**Ready?** Start with **Task 2.1: messageHandler.js**

Good luck! 🚀
