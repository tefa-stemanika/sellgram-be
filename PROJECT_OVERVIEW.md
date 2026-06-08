# Telegram AI Bot — Project Overview

Multi-tenant Telegram bot untuk jualan online dengan integrasi pembayaran Midtrans, dukungan AI, dan web catalog.

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
| Auth | JWT (`jsonwebtoken`) | 7 hari expiry, untuk dashboard API |
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
│   ├── controllers/                  # Route handlers (10 files)
│   ├── middlewares/                   # Auth, rate limit, logger, error, 404
│   ├── routes/                       # Route definitions (10 files)
│   └── utils/                        # response.js (ok/fail helpers)
├── handlers/                         # Telegram bot message/callback handlers
├── services/                         # Business logic (18 files)
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

### 6. Order Management

- Order dari Telegram (source: TELEGRAM) dengan `telegramId`
- Order dari website (source: WEBSITE) dengan `customerName` + `customerPhone`
- Status lifecycle: `PAYMENT_PENDING` → `COMPLETED` / `PAYMENT_FAILED`
- Unique order ID format: `ORD-YYYYMMDD-NNNN`

### 7. Public Web Catalog

Endpoint publik (no auth, rate-limited 30 req/min):

| Endpoint | Fungsi |
|---|---|
| `GET /api/public/profile/:userId` | Nama toko |
| `GET /api/public/products/:userId` | Daftar produk |
| `GET /api/public/products/:userId/:productId` | Detail produk |
| `POST /api/public/orders` | Buat order dari web |
| `GET /api/public/orders/:orderId` | Cek status order |
| `POST /api/public/orders/:orderId/verify` | Verifikasi pembayaran |

### 8. Bot Credential Management

- Semua credentials (bot token, Midtrans key) disimpan **terenkripsi** (AES-256-GCM)
- Encrypted format: `iv:authTag:ciphertext` (base64)
- Key per tenant: `TELEGRAM_BOT_TOKEN`, `ADMIN_BOT_TOKEN`, `ADMIN_CHAT_ID`
- Midtrans: `MIDTRANS_SERVER_KEY_SANDBOX`, `MIDTRANS_CLIENT_KEY_SANDBOX`, dan versi production
- Config caching di Redis (TTL 600s)

### 9. Webhook System

**Midtrans Webhook:**
- Endpoint: `POST /api/webhook/midtrans`
- Signature verification per tenant
- Update status order + trigger notifikasi via BullMQ

**Telegram Webhook:**
- Endpoint: `POST /api/webhook/telegram/:userId`
- Secret token verification (SHA-256 hash of bot token)
- Queue-based serial processing per chat (Redis list + lock)
- Auto-spawn bot instance jika belum running

### 10. BullMQ Background Jobs

**Queue `telegram-notifications`:**
- `payment-success`: notifikasi ke buyer + admin
- `payment-failed`: notifikasi ke buyer + admin
- Untuk WEBSITE orders: skip notifikasi buyer (tidak ada telegramId)

**Queue `telegram-webhooks`:**
- `set-webhook`: konfigurasi webhook URL per tenant
- Retry 3 kali, exponential backoff
- Background reconciliation jika gagal

### 11. Rate Limiting

- Redis-based sliding window (default: 30 req/min per IP)
- Diterapkan di semua endpoint publik
- Return 429 + `Retry-After` header
- Graceful degradation: lanjut jika Redis error

### 12. Startup & Graceful Shutdown

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
→ saveOrder (DB, PAYMENT_PENDING) → createSnapTransaction (Midtrans)
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
Midtrasn POST /api/webhook/midtrans → verify signature
→ update status COMPLETED/PAYMENT_FAILED
→ enqueue notif ke BullMQ → worker kirim pesan ke buyer + admin
```

---

## API Endpoints

### Public (No Auth)
| Method | Path |
|---|---|
| GET | `/health` |
| GET | `/api/webhook/midtrans` |
| POST | `/api/webhook/telegram/:userId` |
| GET | `/api/public/profile/:userId` |
| GET | `/api/public/products/:userId` |
| GET | `/api/public/products/:userId/:productId` |
| POST | `/api/public/orders` |
| GET | `/api/public/orders/:orderId` |
| POST | `/api/public/orders/:orderId/verify` |

### Authenticated (JWT)
| Method | Path |
|---|---|
| POST | `/api/auth/register` |
| POST | `/api/auth/login` |
| GET | `/api/auth/me` |
| GET | `/api/dashboard` |
| GET/POST/PUT/DELETE | `/api/bot-config` |
| GET/PUT/DELETE | `/api/bot-credentials` |
| GET/POST/PUT/DELETE | `/api/products` |
| GET | `/api/orders` |
| GET | `/api/bots/status` |

---

## Database Schema

### Enums
- `UserPlan`: FREE, STARTER, PRO
- `BotMode`: AI, BUTTON
- `OrderSource`: TELEGRAM, WEBSITE
- `OrderStatus`: PENDING, CONFIRMED, PROCESSING, COMPLETED, CANCELLED, PAYMENT_PENDING, PAYMENT_FAILED

### Models
```
User 1─N BotConfig       (cascade delete)
User 1─N BotCredential   (cascade delete)
User 1─N Product         (cascade delete)
User 1─N Order           (cascade delete)
Order 1─N OrderItem
Product 1─N OrderItem
```

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
