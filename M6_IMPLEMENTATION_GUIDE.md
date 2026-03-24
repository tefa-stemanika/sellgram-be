# M6 IMPLEMENTATION GUIDE — Multi-Tenant Migration

**Status:** ✅ Core infrastructure completed  
**Next:** Handler refactoring + Webhooks update

---

## ✅ Completed Infrastructure Tasks

### 1. Database Schema (`prisma/schema.prisma`)

- ✅ Added `User` model (tenant)
- ✅ Added `user_id` FK to `BotConfig`, `BotCredential`, `Product`, `Order`
- ✅ Added unique constraints: `(userId, key)` for credentials, `(userId, orderId)` for orders
- ✅ Added cascade delete for data integrity

### 2. User Service (`src/services/userService.js`)

- ✅ `createUser()` — create new tenant
- ✅ `getUserById()` — fetch user with relations
- ✅ `verifyUserPassword()` — authentication
- ✅ `canCreateNewBot()` — plan-based limit check
- ✅ `getAllActiveUsers()` — for bot startup

### 3. Bot Manager (`src/services/botManager.js`)

- ✅ `spawnBotForUser(userId)` — start bot instance
- ✅ `stopBotForUser(userId)` — stop bot instance
- ✅ `spawnAllActiveBots()` — startup all bots
- ✅ `getBotForUser(userId)` — access bot instance
- ✅ Maintains `Map<userId, BotInstance>`

### 4. Tenant Resolver (`src/services/tenantResolver.js`)

- ✅ `initializeTenantMap()` — cache token→userId at startup
- ✅ `resolveUserIdFromToken()` — lookup user from bot token
- ✅ `findUserFromOrderId()` — useful for webhooks
- ✅ Token mapping auto-loads from encrypted database

### 5. Config Service Multi-Tenant (`src/services/configService.js`)

- ✅ Multi-user: `loadConfigForUser(userId)`, `getBotConfigForUser(userId)`, etc.
- ✅ Per-user caching: `Map<userId, { config, creds }>`
- ✅ Backwards-compat: legacy functions (DEFAULT_USER_ID=1)
- ✅ Can migrate single-tenant apps without rewrite

### 6. Product & Order Services

- ✅ `getAllProducts(userId)` — per-user products
- ✅ `getProductById(userId, id)` — scoped lookup
- ✅ `saveOrder({ userId, ... })` — orders belong to user
- ✅ `getOrderByOrderId(userId, orderId)` — scoped query
- ✅ Admin functions added: `getAllProductsAdmin()`, `createProduct()`

### 7. Migration Seed (`prisma/seed-migration-m6.js`)

- ✅ Migrates existing data from single-tenant to multi-tenant
- ✅ Creates default user (ID=1) if not exists
- ✅ Updates all FK references automatically
- ✅ Run: `npm run db:seed-migration-m6`

### 8. Entry Point M6 (`src/index-m6.js`)

- ✅ Multi-bot initialization pattern
- ✅ Tenant map init at startup
- ✅ Spawn all active bot instances
- ✅ Webhook server for all tenants
- ✅ Graceful shutdown

---

## 🔜 Remaining Tasks

### Task 1: Refactor Handlers for Multi-Tenant

Handlers saat ini mengasumsikan **global** `AI_ENABLED` dan config. Perlu diubah untuk:

- Accept `userId` sebagai parameter
- Look up config per user: `isAiEnabledForUser(userId)`
- Track order state per (user, telegram_id), bukan hanya telegram_id

**Files to update:**

- `src/handlers/messageHandler.js` — conditional routing
- `src/handlers/orderHandler.js` — order state machine
- `src/handlers/buttonHandler.js` — callback routing
- `src/services/order.js` — in-memory state (consider Redis for multi-instance)
- `src/services/session.js` — chat history per user

**Pattern untuk handler:**

```javascript
// OLD (single-tenant)
export async function handleStart(bot, msg) {
  const aiEnabled = AI_ENABLED // global
  // ...
}

// NEW (multi-tenant)
export async function handleStart(bot, msg, userId) {
  const { isAiEnabledForUser } = await import('./configService.js')
  const aiEnabled = isAiEnabledForUser(userId)
  // ...
}

// Wrapper di bot instance:
bot.onText(/\/start/, async (msg) => {
  const userId = getTenantContext(msg) // dari bot instance atau token
  handleStart(bot, msg, userId)
})
```

### Task 2: Update Webhook untuk Multi-Tenant

File: `src/webhook.js`

Webhook Midtrans hanya tahu `order_id`, perlu cari user:

```javascript
// OLD
const order = await getOrderByOrderId(orderId)

// NEW
const userId = await findUserFromOrderId(orderId)
const order = await getOrderByOrderId(userId, orderId)
```

Method sudah ada di `tenantResolver.js`:

- `findUserFromOrderId(orderId)` — cari userId dari order
- `findUserFromTelegramId(telegramId)` — cari userId dari telegram ID

### Task 3: Update Admin Bot Initialization

File: `src/services/adminBot.js`

Saat ini, admin bot adalah global untuk satu store. Multi-tenant: setiap user bisa punya—bot admin sendiri:

```javascript
export async function initAdminBotForUser(userId) {
  const token = getAdminBotTokenForUser(userId)
  const chatId = getAdminChatIdForUser(userId)
  // spawn bot instance untuk notifikasi
}

export async function notifyAdminForUser(userId, message) {
  // kirim ke admin bot user tersebut
}
```

### Task 4: Update State Machines untuk Multi-User

Files:

- `src/services/order.js` — order state per (userId, telegramId)
- `src/services/session.js` — chat history per (userId, telegramId)

Current structure: `Map<telegramId, state>`  
New structure: `Map<userIdTelegramId, state>` atau `Map<userId, Map<telegramId, state>>`

```javascript
// Option A: flat key
const orderKey = `${userId}:${telegramId}`
const state = orderState.get(orderKey)

// Option B: nested map (cleaner untuk multi-user)
const userOrders = orderState.get(userId) || new Map()
const state = userOrders.get(telegramId)
```

**Catatan:** Untuk production dengan multiple bot instances (clustering), gunakan **Redis** untuk state persistence.

### Task 5: Bot Registration untuk Setiap User

Saat ini di `index-m6.js`, bots sudah di-spawn. Namun, perlu register handler untuk setiap instance:

```javascript
// dst/index-m6.js snippet
for (const [userId, { bot, config }] of activeBots.entries()) {
  // Register handlers untuk bot instance user ini
  registerHandlersForUser(bot, userId, config)
}

function registerHandlersForUser(bot, userId, config) {
  const aiEnabled = config.aiEnabled

  bot.onText(/\/start/, (msg) => handleStart(bot, msg, userId))
  bot.onText(/\/help/, (msg) => handleHelp(bot, msg, userId))
  // ... semua handlers dengan userId
}
```

---

## 📋 Checklist Migrasi Lengkap

### Phase 1: Setup ✅

- [x] Update Prisma schema
- [x] Create userService
- [x] Create botManager
- [x] Create tenantResolver
- [x] Update configService
- [x] Update productService & orderService
- [x] Create migration seed
- [x] Create index-m6.js

### Phase 2: Handler Refactoring (TODO)

- [ ] Update messageHandler.js
- [ ] Update orderHandler.js
- [ ] Update buttonHandler.js
- [ ] Create handler registration function
- [ ] Update index-m6.js with handler registration

### Phase 3: Webhook & Admin (TODO)

- [ ] Update webhook.js untuk multi-tenant
- [ ] Update adminBot.js per-user
- [ ] Test webhook forwarding

### Phase 4: State Management (TODO)

- [ ] Update order.js state machine
- [ ] Update session.js chat history
- [ ] Add userId to state keys
- [ ] (Optional) Migrate to Redis

### Phase 5: Testing & Deployment (TODO)

- [ ] Database migration test
- [ ] Multi-user bot test
- [ ] Webhook integration test
- [ ] Load test (multiple bots)
- [ ] Deploy to production

---

## 🚀 Quick Start: Try M6 Now

### 1. Update Database

```bash
# Apply schema changes
npm run db:push

# Migrate existing data
npm run db:seed-migration-m6
```

### 2. Create Test User (Optional)

```bash
node -e "
const { createUser } = await import('./src/services/userService.js');
const user = await createUser({
  email: 'store2@example.com',
  password: 'test123',
  name: 'Store #2',
  plan: 'STARTER'
});
console.log('User created:', user);
"
```

### 3. Set Credentials untuk User

```bash
# Gunakan prisma studio atau SQL untuk set credentials user
npm run db:studio

# Atau: Ambil seed config, modify untuk user_id=2, jalankan ulang
```

### 4. Start dengan M6 Mode

```bash
# Terminal 1: Single-tenant (backwards-compat)
npm start

# Terminal 2: Multi-tenant (M6)
node src/index-m6.js
```

---

## 🔗 Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│           Telegram API                              │
│  Bot1 Token    Bot2 Token    Bot3 Token             │
└───────┬───────────┬───────────┬─────────────────────┘
        │           │           │
    [TenantResolver] (maps token → userId)
        │           │           │
    ┌───▼───┐   ┌───▼───┐   ┌──▼────┐
    │User 1 │   │User 2 │   │User 3 │
    │       │   │       │   │       │
    │Bot    │   │Bot    │   │Bot    │
    │ ├─Config  │ ├─Config  │ ├─Config
    │ ├─Creds   │ ├─Creds   │ ├─Creds
    │ └─Handlers│ └─Handlers│ └─Handlers
    │       │   │       │   │       │
    └───┬───┘   └───┬───┘   └──┬────┘
        │           │           │
        └───────────┼───────────┘
                    │
            ┌───────▼──────────┐
            │  Webhook Server  │  (localhost:3000)
            │  /health         │
            │  /webhook/       │
            │  midtrans        │
            └──────┬───────────┘
                   │
            ┌──────▼─────────┐
            │  Database      │
            │  users         │
            │  bot_config    │
            │  credentials   │
            │  products      │
            │  orders        │
            └────────────────┘
```

---

## 💡 Tips & Troubleshooting

### Issue: Token sudah kedaluwarsa saat spawn

**Solution:** Refresh token dari telegram bot API yang benar

### Issue: State hilang saat bot restart

**Solution:** Use Redis untuk persistent session (M7 dashboard dapat handle)

### Issue: Webhook kirim ke bot yang salah

**Solution:** Ensure `findUserFromOrderId()` di webhook.js berfungsi benar

### Issue: Config tidak ter-cache dengan baik

**Solution:** Call `reloadConfigForUser(userId)` setelah update via dashboard

---

## 📚 Related Documents

- [PLAN.md](../PLAN.md) — Roadmap lengkap
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Arsitektur sistem
- [DATABASE.md](./DATABASE.md) — Schema details
- [SERVICES.md](../src/services/SERVICES.md) — Service documentation
- [HANDLERS.md](../src/handlers/HANDLERS.md) — Handler patterns

---

**Status:** M6 Phase 1 ✅ complete  
**Next:** Start Phase 2 (Handler Refactoring)  
**Estimated effort:** ~4-6 hours for full implementation
