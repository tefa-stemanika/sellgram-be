# M6 IMPLEMENTATION CHECKLIST

**Status:** Phase 1 ✅ DONE | Phase 2-5 🔄 IN PROGRESS  
**Target:** Full M6 multi-tenant implementation

---

## ✅ PHASE 1: Infrastructure (COMPLETE)

### Database & Schema

- [x] Add User table to schema.prisma
- [x] Add user_id FK to BotConfig
- [x] Add user_id FK to BotCredential
- [x] Add user_id FK to Product
- [x] Add user_id FK to Order
- [x] Add cascade delete relationships
- [x] Run: `npm run db:push`

### Core Services

- [x] Create userService.js (authentication, CRUD)
- [x] Create botManager.js (spawn/stop bot per user)
- [x] Create tenantResolver.js (token → userId mapping)
- [x] Update configService.js (multi-user getters)
- [x] Update productService.js (userId param)
- [x] Update orderService.js (userId scoping)

### Supporting Files

- [x] Create password.js utility (bcrypt)
- [x] Create seed-migration-m6.js
- [x] Create index-m6.js (M6 entry point)
- [x] Update package.json (new scripts, bcrypt dependency)

### Documentation

- [x] Write M6_IMPLEMENTATION_GUIDE.md
- [x] Write M6_IMPLEMENTATION_SUMMARY.md
- [x] Write M6_NEXT_STEPS.md
- [x] Update PLAN.md

---

## 🔄 PHASE 2: Handler Refactoring (NEXT)

### messageHandler.js

- [ ] Import multi-user getters from configService
- [ ] Accept `userId` parameter in all handler functions
- [ ] Replace global `AI_ENABLED` with `isAiEnabledForUser(userId)`
- [ ] Update `handleStart(bot, msg, userId)`
- [ ] Update `handleHelp(bot, msg, userId)`
- [ ] Update `handleReset(bot, msg, userId)`
- [ ] Update `handleMessage(bot, msg, userId)` — critical!
- [ ] Update imports in msg handlers

### orderHandler.js

- [ ] Accept `userId` parameter in all functions
- [ ] Update `handleMenu(bot, msg, userId)`
- [ ] Update `handlePesan(bot, msg, userId)`
- [ ] Update `handleKonfirmasi(bot, msg, userId)` — add userId to saveOrder
- [ ] Update `handleBatal(bot, msg, userId)`
- [ ] Update `handleOrderStatus(bot, msg, userId)`
- [ ] Update `handleOrderInput(bot, msg, userId)`
- [ ] All order state calls: `getOrder(userId, telegramId)`
- [ ] All save order calls: `saveOrder({ userId, ... })`

### buttonHandler.js

- [ ] Accept `userId` parameter in all functions
- [ ] Update `handleCallbackQuery(bot, query, userId)`
- [ ] Update `showMenuButtons(bot, chatId, editMsgId, userId)`
- [ ] Update `handleSelectProduct(bot, query, userId)`
- [ ] Update `handleSelectQty(bot, query, userId)`
- [ ] Update `handleAskCustomQty(bot, query, userId)`
- [ ] Update `handleConfirmOrder(bot, query, userId)` — add userId to saveOrder
- [ ] Update `handleCancelOrder(bot, query, userId)`
- [ ] All order state calls: `getOrder(userId, telegramId)`

### order.js State Machine

- [x] Change Map key: `${userId}:${telegramId}` ✅ DONE in Phase 4
- [x] Update `getOrder(userId, telegramId)` ✅ DONE in Phase 4
- [x] Update `setOrder(userId, telegramId, data)` ✅ DONE in Phase 4
- [x] Update `resetOrder(userId, telegramId)` ✅ DONE in Phase 4
- [x] Add expiry cleanup (24h) ✅ DONE in Phase 4
- [x] Add statistics tracking ✅ DONE in Phase 4
- [x] Test state isolation between users ✅ DONE in Phase 4

### session.js Chat History

- [x] Change Map key: `${userId}:${telegramId}` ✅ DONE in Phase 4
- [x] Update `getHistory(userId, telegramId)` ✅ DONE in Phase 4
- [x] Update `addMessage(userId, telegramId, role, text)` ✅ DONE in Phase 4
- [x] Update `clearHistory(userId, telegramId)` ✅ DONE in Phase 4
- [x] Add max sessions per user (50) ✅ DONE in Phase 4
- [x] Add expiry cleanup (24h) ✅ DONE in Phase 4
- [x] Add statistics tracking ✅ DONE in Phase 4
- [x] Test chat isolation between users ✅ DONE in Phase 4

### gemini.js

- [ ] Import `getAllProducts(userId)`
- [ ] Update `askGemini()` to accept userId
- [ ] Pass userId to getAllProducts() call
- [ ] System prompt uses user's products only
- [ ] Update all Gemini function calling with userId context

### Handler Registration

- [ ] Create `src/handlers/index.js` (new file)
- [ ] Implement `registerHandlersForUser(bot, userId, config)`
- [ ] Register /start, /help, /reset, /menu, /pesan, /konfirmasi, /batal
- [ ] Register message handler with userId
- [ ] Register callback_query handler with userId

### index-m6.js

- [ ] Import handler registration from handlers/index.js
- [ ] After botManager spawns bots, register handlers for each
- [ ] Loop through activeBots, call registerHandlersForUser()
- [ ] Add logging for handler registration

---

## 🔧 PHASE 3: Webhook & Admin Bot Updates

### webhook.js

- [ ] Import tenantResolver functions
- [ ] POST /webhook/midtrans endpoint
- [ ] Find userId from order: `findUserFromOrderId(orderId)`
- [ ] Find config for user: `loadConfigForUser(userId)`
- [ ] Update order scoped to user: `updateOrderStatus(userId, orderId, ...)`
- [ ] Notify correct admin bot via adminBot.js

### adminBot.js

- [ ] Change admin bot from global to per-user
- [ ] `initAdminBotForUser(userId)` instead of initAdminBot()
- [ ] `notifyAdminForUser(userId, message)` helper
- [ ] Update webhook.js to pass userId when notifying
- [ ] Handle missing admin token gracefully

### midtrans.js

- [ ] Accept userId parameter if needed
- [ ] Use `getMidtransServerKeyForUser(userId)`
- [ ] Use `getMidtransClientKeyForUser(userId)`
- [ ] Product name truncation to 50 chars (unchanged)

---

## ✅ PHASE 4: State Management (COMPLETE)

### In-Memory State Improvements

- [x] Verify (userId, telegramId) key scoping works ✅ DONE
- [x] Add cleanup: remove old state entries after 24h ✅ DONE
- [x] Add session limits per user (50 per tenant) ✅ DONE
- [x] Create test file (tests/test-phase4.js) ✅ DONE
- [x] All tests passing ✅ DONE

### Redis Migration (Optional for clustering)

- [ ] Install redis package (defer to Phase 6)
- [ ] Create redisClient.js (defer to Phase 6)
- [ ] Migrate order.js to Redis (defer to Phase 6)
- [ ] Migrate session.js to Redis (defer to Phase 6)
- [ ] Update state expiry times (defer to Phase 6)

---

## ✅ PHASE 5: Testing & Deployment

### Functionality Testing

- [ ] Test single-tenant bot still works (backward compat)
- [ ] Create 2nd user with own credentials
- [ ] Run npm run db:seed-migration-m6 (if needed)
- [ ] Start: `npm run start:m6`
- [ ] Verify 2+ bot instances running
- [ ] Send message to bot #1 → correct user context
- [ ] Send message to bot #2 → correct user context
- [ ] No cross-tenant data leakage

### Order Flow Testing

- [ ] User 1: complete order + payment
- [ ] User 2: complete order + payment (simultaneous)
- [ ] Verify orders in DB have correct user_id
- [ ] Verify admin notifications go to correct admin

### Webhook Testing

- [ ] Midtrans webhook callback
- [ ] Webhook finds correct user from order_id
- [ ] Order status updates scoped correctly
- [ ] Admin notified via correct admin bot

### Database Testing

- [ ] Backup database before migration
- [ ] Run seed-migration-m6
- [ ] Verify all rows have user_id values
- [ ] Verify unique constraints not violated
- [ ] Verify foreign keys intact

### Load Testing

- [ ] 3-5 bots running simultaneously
- [ ] Each bot receives messages
- [ ] No memory leaks
- [ ] CPU/RAM stable

### Git & Deployment

- [ ] Commit all changes
- [ ] Tag: `v2.0-m6-phase1-complete`
- [ ] Draft release notes
- [ ] Deploy to staging
- [ ] Smoke test on staging
- [ ] Deploy to production
- [ ] Monitor logs for errors

---

## 📋 Quick Links

| File                           | Status  | Size       |
| ------------------------------ | ------- | ---------- |
| prisma/schema.prisma           | ✅ Done | +50 lines  |
| src/services/userService.js    | ✅ Done | 150 lines  |
| src/services/botManager.js     | ✅ Done | 250 lines  |
| src/services/tenantResolver.js | ✅ Done | 200 lines  |
| src/services/configService.js  | ✅ Done | +150 lines |
| src/services/productService.js | ✅ Done | +80 lines  |
| src/services/orderService.js   | ✅ Done | +80 lines  |
| src/handlers/messageHandler.js | 🔄 Todo | ~300 lines |
| src/handlers/orderHandler.js   | 🔄 Todo | ~250 lines |
| src/handlers/buttonHandler.js  | 🔄 Todo | ~300 lines |
| src/services/order.js          | 🔄 Todo | ~100 lines |
| src/services/session.js        | 🔄 Todo | ~80 lines  |
| src/webhook.js                 | 🔄 Todo | ~150 lines |
| src/index-m6.js                | ✅ Done | 80 lines   |
| package.json                   | ✅ Done | +5 lines   |

---

## 🚀 How to Use This Checklist

1. **Print it** or keep it open in an editor
2. **Check off items** as you complete them
3. **Start with Phase 2** (next immediate tasks)
4. **One file at a time** — don't skip around
5. **Test after each file** before moving to next
6. **Keep git commits small** — one file per commit

---

## 📊 Progress Tracking

```
Phase 1 (Infrastructure):  ████████████████████ 100%
Phase 2 (Handlers):         ░░░░░░░░░░░░░░░░░░░░ 0%
Phase 3 (Webhooks):         ░░░░░░░░░░░░░░░░░░░░ 0%
Phase 4 (State Mgmt):       ████████████████████ 100%
Phase 5 (Testing):          ░░░░░░░░░░░░░░░░░░░░ 0%
─────────────────────────────────────────────────────
OVERALL:                    ████████░░░░░░░░░░░░ 40%
```

**Completed:** Phase 1 + Phase 4 (Infrastructure + State Management)  
**Estimated remaining effort:** 10-12 hours  
**Estimated completion:** 1-2 days of active development

**Next:** Phase 2 - Handler Refactoring (3-4 hours)

---

**Last Updated:** March 24, 2026  
**Next Phase Starts:** Phase 2 - Handler Refactoring
