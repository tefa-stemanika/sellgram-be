# Telegram AI Bot — Project Overview

Multi-tenant Telegram bot untuk jualan online dengan integrasi pembayaran Midtrans, dukungan AI, web catalog, stock management, customer portal, dan ticketing system.

---

## Tech Stack

| Layer | Teknologi | Keterangan |
|---|---|---|
| Runtime | Node.js 18+ (ESM) | Native `fetch`, tanpa SDK tambahan untuk Midtrans |
| Web Framework | Express 5 | Routing, middleware, error handling |
| ORM | Prisma 5 | PostgreSQL adapter, single schema file |
| Database | PostgreSQL 16 | Docker `postgres:16-alpine`, port 5284 |
| Cache & State | Redis 7 | ioredis client, AOF persistence, Docker `redis:7-alpine` |
| Bot Library | `node-telegram-bot-api` | Webhook-only (`polling: false`) |
| Auth (Admin) | JWT (`jsonwebtoken`) | 7 hari expiry, untuk dashboard API |
| Auth (Customer) | JWT (`jsonwebtoken`) | 30 hari expiry, `type: 'customer'` di payload |
| Password | bcrypt | 10 salt rounds |
| Background Jobs | BullMQ | Redis-based queue: notifikasi + webhook |
| AI Provider | Gemini API + OpenRouter SDK | Function calling untuk order via chat |
| Payment | Midtrans Snap API | QRIS, GoPay, ShopeePay, Bank Transfer |
| Encryption | AES-256-GCM (Node `crypto`) | Semua credentials terenkripsi di DB |
| Container | Docker + Compose | Health checks, volume persistence |

---

## Arsitektur Multi-Tenant

Setiap user adalah **tenant** yang memiliki bot Telegram sendiri, produk sendiri, dan data terisolasi.

**Kunci isolasi:**
- Semua query DB discope oleh `userId`
- Composite unique key mencakup `userId`
- Bot instance per user di `Map<userId, botData>` (botManager.js)
- Redis key namespacing: `{userId}:{telegramId}`
- Credentials terenkripsi per user di tabel `bot_credentials`
- Plan limits: FREE = 1 bot config, STARTER = 3, PRO = 10

**Tenant resolution:**
- Dari URL path: `/api/webhook/telegram/:userId` — bukan dari bot token
- Reverse lookup via Redis `tenant_map:{sha256hash}` untuk auxiliary queries

---

## Struktur Direktori

```
src/
├── index.js                          # Entry point — init + graceful shutdown
├── app.js                            # Express app assembly
├── api/
│   ├── controllers/                  # Route handlers
│   ├── middlewares/                   # Auth, rate limit, logger, error, 404
│   ├── routes/                       # Route definitions
│   └── utils/                        # response.js (ok/fail helpers)
├── handlers/                         # Telegram bot message/callback handlers
├── services/                         # Business logic
└── utils/                            # encryption, jwt, password helpers
```

---

## Fitur-Fitur

### 1. Telegram Bot (Dua Mode)

**Button Mode:**
- User memilih produk via inline keyboard
- Flow: menu → pilih produk → pilih qty → konfirmasi → bayar via Midtrans Snap
- Callback query: `select_product`, `select_qty`, `confirm_order`, dll.

**AI Mode:**
- User pesan via natural language: "Saya mau pesan nasi goreng 2"
- AI (Gemini atau OpenRouter) memproses dengan function calling
- Function: `show_menu`, `start_order`, `cancel_order`, `confirm_order`, `get_order_status`
- System prompt menyertakan katalog produk tenant

### 2. Midtrans Payment Integration

- Snap transaction dengan QRIS, GoPay, ShopeePay, Bank Transfer
- Multi-tenant: server key per user (sandbox/production)
- Webhook signature verification (HMAC-SHA512)
- Status: `PAYMENT_PENDING` → `COMPLETED` / `PAYMENT_FAILED`
- Callback finish URL untuk redirect setelah bayar

### 3. Admin Notification Bot

- Bot Telegram terpisah untuk notifikasi admin per tenant
- Notifikasi order success: detail produk, total, customer info, payment method
- Notifikasi payment failed
- Dikirim ke `ADMIN_CHAT_ID` yang terdaftar

### 4. Dashboard API (JWT Auth)

- Ringkasan: active products, total orders, pending orders
- Revenue bulan ini + perbandingan bulan lalu
- Tren revenue: `up` / `down` / `stable`
- Orders by source: `TELEGRAM` vs `WEBSITE`
- Revenue by source
- 5 recent orders terbaru

### 5. Product Management

- CRUD produk per tenant
- Soft delete (set `isAvailable = false`)
- Field: name, description, price (integer IDR), emoji, availability

### 6. Stock Management

- Tracking stok per produk dengan `stockEnabled` flag
- `allowOversell` untuk mengizinkan order melebihi stok
- `lowStockAlert` threshold untuk notifikasi admin saat stok menipis
- **Stock Log** — audit trail setiap perubahan stok:
  - `SALE` — berkurang karena order berhasil
  - `REFUND` — bertambah karena order gagal/dibatalkan
  - `RESTOCK` — ditambah manual oleh admin
  - `ADJUSTMENT` — koreksi manual (bisa + atau -)
- Validasi stot sebelum order dibuat (kecuali `stockEnabled = false` = unlimited)
- Deduct stok otomatis saat payment success
- Refund stok otomatis saat payment failed / order dibatalkan
- Low stock alert via admin bot saat stok <= `lowStockAlert`

### 7. Order Management

- Order dari Telegram (source: TELEGRAM) dengan `telegramId`
- Order dari website (source: WEBSITE) dengan `customerName` + `customerPhone`
- Order dari portal (source: WEBSITE) ter-link ke `Customer` via `customerId`
- Status lifecycle: `PAYMENT_PENDING` → `COMPLETED` / `PAYMENT_FAILED`
- Unique order ID format: `ORD-YYYYMMDD-NNNN`

### 8. Customer Database (CRM)

- Data customer terintegrasi dari berbagai sumber:
  - **ORDER** — dibuat otomatis saat order pertama dari Telegram/Website
  - **MANUAL** — dibuat manual oleh admin atau saat register portal
  - **IMPORT** — import dari sistem lain
- Identifikasi multi-channel: telegramId, email, phone
- Flag channel: `hasTelegram`, `hasWhatsapp`, `hasEmail`
- Ringkasan otomatis: `totalOrders`, `totalSpent`, `firstOrderAt`, `lastOrderAt`
- Unique constraint per tenant: satu customer per `(userId, telegramId)`, `(userId, email)`, `(userId, phone)`

### 9. Customer Portal (Customer Auth)

Customer dapat login ke portal mereka sendiri untuk melihat riwayat pesanan.

**Arsitektur:**
- Scoped per tenant — `:userId` di URL adalah tenant ID
- JWT khusus dengan `type: 'customer'` (terpisah dari token admin)
- Token berlaku 30 hari

**Fitur:**
- Register dengan email + password + nomor telepon
- Login dengan email + password
- Lihat profil
- Update profil (nama, telepon)
- Ganti password
- Lihat riwayat orders (hanya milik sendiri)
- Lihat detail order

**Auto-link:** Saat register, jika nomor telepon sudah tercatat dari order sebelumnya (via website/Telegram), akun portal akan ter-link ke data customer yang sudah ada.

### 10. Public Web Catalog

Endpoint publik (no auth, rate-limited 30 req/min):

| Endpoint | Fungsi |
|---|---|
| `GET /api/public/profile/:userId` | Nama toko |
| `GET /api/public/products/:userId` | Daftar produk |
| `GET /api/public/products/:userId/:productId` | Detail produk |
| `POST /api/public/orders` | Buat order dari web |
| `GET /api/public/orders/:orderId` | Cek status order |
| `POST /api/public/orders/:orderId/verify` | Verifikasi pembayaran |

### 11. Bot Credential Management

- Semua credentials (bot token, Midtrans key) disimpan **terenkripsi** (AES-256-GCM)
- Encrypted format: `iv:authTag:ciphertext` (base64)
- Key per tenant: `TELEGRAM_BOT_TOKEN`, `ADMIN_BOT_TOKEN`, `ADMIN_CHAT_ID`
- Midtrans: `MIDTRANS_SERVER_KEY_SANDBOX`, `MIDTRANS_CLIENT_KEY_SANDBOX`, dan versi production
- Config caching di Redis (TTL 600s)

### 12. Ticketing System

Sistem tiket untuk customer support per order.

**Model:**
- `Ticket` — tiket utama, ter-link ke `Order` (opsional)
- `Label` — label untuk kategorisasi (multi-tenant, unique per name)
- `TicketLabel` — relasi many-to-many tiket ↔ label
- `TicketComment` — komentar internal/eksternal dalam tiket
- `TicketActivity` — log aktivitas (status change, assign, dll.)

**Status tiket:** OPEN → IN_PROGRESS → WAITING_CUSTOMER → RESOLVED → CLOSED / CANCELLED

**Prioritas:** LOW, MEDIUM, HIGH, URGENT

**Sumber tiket:**
- `ORDER` — dibuat otomatis dari order yang completed
- `MANUAL` — dibuat manual oleh admin

Fitur:
- Komentar internal (hanya terlihat admin) vs eksternal (terlihat customer)
- Activity log otomatis untuk setiap perubahan
- Label dengan warna untuk kategorisasi

### 13. Webhook System

**Midtrans Webhook:**
- Endpoint: `POST /api/webhook/midtrans`
- Signature verification per tenant
- Update status order + trigger notifikasi via BullMQ

**Telegram Webhook:**
- Endpoint: `POST /api/webhook/telegram/:userId`
- Secret token verification (SHA-256 hash of bot token)
- Queue-based serial processing per chat (Redis list + lock)
- Auto-spawn bot instance jika belum running

### 14. BullMQ Background Jobs

**Queue `telegram-notifications`:**
- `payment-success`: notifikasi ke buyer + admin
- `payment-failed`: notifikasi ke buyer + admin
- Untuk WEBSITE orders: skip notifikasi buyer (tidak ada telegramId)

**Queue `telegram-webhooks`:**
- `set-webhook`: konfigurasi webhook URL per tenant
- Retry 3 kali, exponential backoff
- Background reconciliation jika gagal

### 15. Rate Limiting

- Redis-based sliding window (default: 30 req/min per IP)
- Diterapkan di semua endpoint publik
- Return 429 + `Retry-After` header
- Graceful degradation: lanjut jika Redis error

### 16. Startup & Graceful Shutdown

**Startup sequence:**
1. Init Redis → init tenant map → spawn bot instances → start workers → start Express
2. Set periodic logging (active bot count tiap 60s)

**Graceful shutdown:**
1. Stop HTTP server → stop workers → stop bots → redis quit → prisma disconnect

---

## Alur Order

### Telegram (Button Mode)
```
User klik button → buttonHandler → set Redis state → pilih qty → confirm
→ validateStock → saveOrder (DB, PAYMENT_PENDING) → createSnapTransaction (Midtrans)
→ updateOrderPayment (simpan paymentUrl) → reset Redis state
→ kirim invoice ke user
```

### Telegram (AI Mode)
```
User chat → messageHandler → AI function calling → ekstrak product + qty
→ confirm → sama seperti button mode
```

### Website
```
Frontend POST /api/public/orders → saveOrder (source: WEBSITE)
→ createSnapTransaction (dengan customer_details)
→ return { orderId, paymentUrl } → frontend redirect ke Snap
→ setelah bayar → frontend POST /api/public/orders/:id/verify
→ checkTransactionStatus ke Midtrans → update status
```

### Payment Webhook
```
Midtrans POST /api/webhook/midtrans → verify signature
→ update status COMPLETED/PAYMENT_FAILED
→ enqueue notif ke BullMQ → worker kirim pesan ke buyer + admin
→ deductStock (jika success) / refundStock (jika failed)
→ upsertCustomerFromOrder
→ createTicketFromOrder
```

---

## API Endpoints

### Public (No Auth)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | Health check (Redis + DB) |
| GET | `/api/webhook/midtrans` | Midtrans payment notification |
| POST | `/api/webhook/telegram/:userId` | Telegram update webhook |
| GET | `/api/public/profile/:userId` | Profil toko publik |
| GET | `/api/public/products/:userId` | Daftar produk publik |
| GET | `/api/public/products/:userId/:productId` | Detail produk publik |
| POST | `/api/public/orders` | Buat order dari website |
| GET | `/api/public/orders/:orderId` | Cek status order |
| POST | `/api/public/orders/:orderId/verify` | Verifikasi pembayaran |

### Customer Portal (Customer JWT)
| Method | Path | Auth | Keterangan |
|---|---|---|---|
| POST | `/api/portal/:userId/register` | Public | Register customer portal |
| POST | `/api/portal/:userId/login` | Public | Login customer portal |
| GET | `/api/portal/:userId/me` | Customer JWT | Profil customer |
| PATCH | `/api/portal/:userId/me` | Customer JWT | Update profil |
| PATCH | `/api/portal/:userId/me/password` | Customer JWT | Ganti password |
| GET | `/api/portal/:userId/me/orders` | Customer JWT | Riwayat orders |
| GET | `/api/portal/:userId/me/orders/:orderId` | Customer JWT | Detail order |

### Admin Dashboard (JWT)
| Method | Path | Keterangan |
|---|---|---|
| POST | `/api/auth/register` | Register admin |
| POST | `/api/auth/login` | Login admin |
| GET | `/api/auth/me` | Profil admin |
| GET | `/api/dashboard` | Ringkasan dashboard |
| GET/POST/PUT/DELETE | `/api/bot-config` | Konfigurasi bot |
| GET/PUT/DELETE | `/api/bot-credentials` | Credentials bot |
| GET/POST/PUT/DELETE | `/api/products` | CRUD produk |
| POST | `/api/products/:productId/restock` | Restock manual |
| PATCH | `/api/products/:productId/stock` | Adjustment stok |
| GET | `/api/products/:productId/stock-logs` | Log perubahan stok |
| GET | `/api/orders` | Daftar orders |
| GET/POST/PUT/DELETE | `/api/tickets` | CRUD tiket |
| GET/POST/PUT/DELETE | `/api/labels` | CRUD label |
| GET/POST/PUT/DELETE | `/api/customers` | CRUD customer |
| GET | `/api/bots/status` | Status bot instances |

---

## Database Schema

### Enums

| Enum | Values |
|---|---|
| `UserPlan` | FREE, STARTER, PRO |
| `BotMode` | AI, BUTTON |
| `OrderSource` | TELEGRAM, WEBSITE |
| `OrderStatus` | PENDING, CONFIRMED, PROCESSING, COMPLETED, CANCELLED, PAYMENT_PENDING, PAYMENT_FAILED |
| `CustomerSource` | ORDER, MANUAL, IMPORT |
| `StockLogType` | SALE, REFUND, RESTOCK, ADJUSTMENT |
| `TicketStatus` | OPEN, IN_PROGRESS, WAITING_CUSTOMER, RESOLVED, CLOSED, CANCELLED |
| `TicketPriority` | LOW, MEDIUM, HIGH, URGENT |
| `TicketSource` | ORDER, MANUAL |

### Model Relationships

```
User 1─N BotConfig       (cascade delete)
User 1─N BotCredential   (cascade delete)
User 1─N Product         (cascade delete)
User 1─N Order           (cascade delete)
User 1─N Customer        (cascade delete)
User 1─N StockLog        (cascade delete)
User 1─N Ticket          (cascade delete)
User 1─N Label           (cascade delete)
User 1─N TicketComment
User 1─N TicketActivity

Product 1─N OrderItem
Product 1─N StockLog

Order 1─N OrderItem
Order 1─1 Ticket         (opsional)

Customer 1─N Order
Customer 1─1 CustomerAuth (opsional)

Ticket M─N Label         (via TicketLabel)
Ticket 1─N TicketComment
Ticket 1─N TicketActivity

Label M─N Ticket         (via TicketLabel)
```

### Models Detail

**User** — Pemilik bot (tenant).
- `id` (UUID), `email` (unique), `passwordHash`, `name`, `plan` (UserPlan), `isActive`
- Relasi ke semua model utama

**BotConfig** — Konfigurasi bot per tenant.
- `mode` (BotMode: AI/BUTTON), `midtransIsProduction`, `isActive`
- Unique: `(userId, isActive)` — hanya satu config aktif per tenant

**BotCredential** — Credentials terenkripsi per tenant.
- `key` (e.g. TELEGRAM_BOT_TOKEN), `value` (AES-256-GCM encrypted)
- Unique: `(userId, key)`

**Product** — Produk yang dijual.
- `name`, `description`, `price` (integer IDR), `emoji`, `isAvailable`
- **Stock fields:** `stock`, `stockEnabled`, `allowOversell`, `lowStockAlert`

**Order** — Pesanan.
- `orderId` (format: ORD-YYYYMMDD-NNNN), `source` (TELEGRAM/WEBSITE)
- `customerId` → Customer (opsional), `userId` → User
- Status tracking: `status`, `paidAt`, `paymentUrl`, `midtransOrderId`
- Unique: `(userId, orderId)`, `(userId, midtransOrderId)`

**OrderItem** — Item dalam pesanan.
- `orderId` → Order, `productId` → Product, `quantity`, `unitPrice`

**Customer** — Database customer multi-channel.
- Identitas: `telegramId`, `email`, `phone`, `name`, `username`
- Channel flags: `hasTelegram`, `hasWhatsapp`, `hasEmail`
- Riwayat: `totalOrders`, `totalSpent`, `firstOrderAt`, `lastOrderAt`
- `source` (ORDER/MANUAL/IMPORT), `notes`
- Unique: `(userId, telegramId)`, `(userId, email)`, `(userId, phone)`

**CustomerAuth** — Login portal customer.
- `customerId` → Customer (unique, 1-to-1), `email`, `passwordHash`
- `isVerified`, `lastLoginAt`
- Unique: `(userId, email)` — satu email per tenant

**StockLog** — Audit trail perubahan stok.
- `productId` → Product, `orderId` → Order (opsional), `type` (StockLogType)
- `delta` (+/-), `stockAfter` (snapshot), `note`
- Index: `(productId, createdAt)`

**Ticket** — Tiket customer support.
- `orderId` → Order (opsional, unique), `title`, `description`
- `status` (OPEN/IN_PROGRESS/WAITING_CUSTOMER/RESOLVED/CLOSED/CANCELLED)
- `priority` (LOW/MEDIUM/HIGH/URGENT), `source` (ORDER/MANUAL)
- `customerName`, `customerContact`, `resolvedAt`, `closedAt`
- Index: `(userId, status)`, `(userId, createdAt)`

**Label** — Label untuk kategorisasi tiket.
- `name`, `color` (hex), unique: `(userId, name)`

**TicketLabel** — Relasi M:N tiket ↔ label.

**TicketComment** — Komentar dalam tiket.
- `body`, `isInternal` (true = hanya visible admin), `ticketId` → Ticket

**TicketActivity** — Log aktivitas tiket.
- `action`, `metadata` (JSONB), `ticketId` → Ticket, `userId` → User (opsional)

---

## Redis Key Patterns

| Key | TTL | Fungsi |
|---|---|---|
| `tenant_config:{userId}` | 600s | Config + decrypted credentials cache |
| `tenant_map:{sha256}` | 600s | Token hash → userId reverse lookup |
| `order:{userId}:{telegramId}` | 3600s | Active order state machine |
| `session:{userId}:{telegramId}` | 1800s | AI chat history (max 20) |
| `webhook_queue:{userId}:{telegramId}` | 30s | Serialized webhook updates |
| `webhook_lock:{userId}:{telegramId}` | 30s | Lock for serial processing |
| `welcome_sent:{userId}:{chatId}` | 86400s | /start deduplication |
| `ratelimit:{ip}` | 60s | Rate limit counter |

---

## Testing

Plain ESM scripts (tanpa framework testing), real DB integration:

| Command | File | Coverage |
|---|---|---|
| `npm run test:integration` | `tests/integration-tests.js` | Multi-user isolation, order flow |
| `npm run test:webhook` | `tests/webhook-tests.js` | Payment notification flow |
| `npm run test:load` | `tests/load-tests.js` | Concurrent order/payment load |
| `npm run test:phase5` | — | All three sequentially |

---

## Docker

```bash
# Start semua service
docker compose up -d

# Rebuild app setelah perubahan kode
docker compose up -d --build

# Service: postgres (5284), redis (6379), app (5505)
```

---

## Key Commands

| Command | Fungsi |
|---|---|
| `npm run dev` | `node --watch src/index.js` |
| `npm start` | `node src/index.js` |
| `npm run db:push` | Push Prisma schema (dev, tanpa migration history) |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:seed` | Seed default products |
| `npm run db:seed-config` | Migrate .env → encrypted DB |
| `npm run db:studio` | Prisma Studio di port 5555 |

---

## Environment Variables

| Variable | Required | Keterangan |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection |
| `ENCRYPTION_KEY` | Yes | 64 hex chars — jangan diubah setelah encrypt |
| `JWT_SECRET` | Yes | JWT signing secret |
| `REDIS_URL` | Yes | Redis connection |
| `PORT` | Yes | Express port (default 3000, Docker 5505) |
| `PUBLIC_BASE_URL` | For webhooks | Public HTTPS URL (ngrok) |
| `GEMINI_API_KEY` | Optional | Google Gemini API key |
| `OPENROUTER_API_KEY` | Optional | OpenRouter API key |

Credentials sensitif (bot tokens, Midtrans keys) disimpan terenkripsi di database, bukan di env setelah `db:seed-config`.
