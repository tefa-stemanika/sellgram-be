# ARCHITECTURE.md — Arsitektur Sistem (v2)

> Dokumen ini menggantikan ARCHITECTURE.md v1.
> Perubahan utama: migrasi in-memory state ke Redis, full webhook mode, idempotency guard, dan Redis cache layer untuk tenant config.

---

## Stack Teknologi

| Layer         | Teknologi                      | Keterangan                                     |
| ------------- | ------------------------------ | ---------------------------------------------- |
| Runtime       | Node.js >= 18                  | Native fetch, ESM                              |
| Web Framework | Express.js                     | REST API & Webhook receiver                    |
| Bot Library   | `node-telegram-bot-api`        | **Webhook mode only** (polling dihapus)        |
| AI            | Google Gemini API              | Native fetch, tanpa SDK                        |
| Payment       | Midtrans Snap API              | Native fetch, tanpa SDK                        |
| ORM           | Prisma                         | Connection pool dikonfigurasi eksplisit        |
| Database      | PostgreSQL                     | Source of truth semua data persisten           |
| Cache & State | Redis                          | Tenant config cache, order state, chat history |
| Enkripsi      | Node.js `crypto` — AES-256-GCM | Semua credentials di DB terenkripsi            |
| Container     | Docker + Docker Compose        | Multi-service orchestration                    |

---

## Struktur Folder

```
telegram-ai-bot/
├── docs/                        ← Dokumentasi project
├── prisma/
│   ├── schema.prisma            ← Definisi tabel database PostgreSQL
│   ├── seed.js                  ← Script seed data default
│   └── migrations/              ← Riwayat migrasi database
├── src/
│   ├── index.js                 ← Entry point (Init webhook server, graceful shutdown)
│   ├── app.js                   ← Express app setup (Middlewares, CORS)
│   ├── api/
│   │   ├── controllers/         ← Handler logika API dashboard
│   │   ├── middlewares/         ← Auth, Error handler, Rate limiter, Logger
│   │   └── routes/              ← Endpoint definitions (auth, bots, orders, products, webhooks)
│   ├── handlers/
│   │   ├── index.js             ← Pendaftaran handler per userId (Tenant)
│   │   ├── messageHandler.js    ← Router pesan masuk (AI vs button mode)
│   │   ├── orderHandler.js      ← Flow order via command/teks
│   │   └── buttonHandler.js     ← Flow order via inline keyboard
│   ├── services/
│   │   ├── botManager.js        ← Multi-tenant Bot Manager (webhook mode, tanpa polling)
│   │   ├── tenantResolver.js    ← Resolusi config tenant dengan Redis cache layer
│   │   ├── configService.js     ← Pengelola config (BotConfig)
│   │   ├── db.js                ← Prisma client singleton (dengan connection pool)
│   │   ├── redis.js             ← Redis client singleton (ioredis)
│   │   ├── gemini.js            ← Integrasi Gemini AI
│   │   ├── midtrans.js          ← Integrasi Midtrans payment
│   │   ├── adminBot.js          ← Notifikasi ke admin (Multi-tenant)
│   │   ├── userService.js       ← Logika User (Tenant)
│   │   ├── productService.js    ← CRUD Produk berdasarkan userId
│   │   ├── orderService.js      ← CRUD Order berdasarkan userId
│   │   ├── order.js             ← Order state via Redis (bukan in-memory Map)
│   │   └── session.js           ← Chat history AI via Redis (bukan in-memory Map)
│   └── utils/
│       ├── encryption.js        ← AES-256-GCM encrypt/decrypt
│       ├── jwt.js               ← JWT generator untuk Dashboard Auth
│       └── password.js          ← Bcrypt / hashing password
├── docker-compose.yml           ← Orchestration: app + redis + postgres
├── Dockerfile                   ← Build image aplikasi
├── .env                         ← DATABASE_URL, REDIS_URL, ENCRYPTION_KEY, dst.
└── package.json
```

---

## Arsitektur SaaS Multi-Tenant (v2)

```text
.env (infrastruktur)
  DATABASE_URL, REDIS_URL, ENCRYPTION_KEY, JWT_SECRET, WEBHOOK_SECRET, PORT
         │
         ▼
    index.js (Startup)
         │
         ├──► 1. redis.js         (Init Redis client singleton)
         │
         ├──► 2. tenantResolver.js (Init — set webhook URL tiap tenant aktif ke Telegram)
         │
         └──► 3. app.js           (Mulai Express server)
                 │
                 ├──► POST /api/webhook/telegram/:userId  ← Pesan masuk dari Telegram
                 ├──► POST /api/webhook/midtrans          ← Notifikasi payment dari Midtrans
                 └──► /api/*                              ← REST API Dashboard Panel
```

> **Perubahan dari v1:** `botManager` tidak lagi spawn instance bot dengan polling.
> Semua pesan masuk melalui satu webhook endpoint per tenant.
> Tidak ada koneksi idle ke Telegram API.

---

## Flow Lengkap: Webhook Telegram

### 1. Pesan Masuk

```
Telegram POST /api/webhook/telegram/:userId
```

### 2. Validasi Request

```js
// middleware: validateTelegramWebhook
if (
  req.headers['x-telegram-bot-api-secret-token'] !== process.env.WEBHOOK_SECRET
) {
  return res.status(403).end()
}
```

### 3. Tenant Resolver — Cache Layer

```text
Redis GET tenant_config:{userId}
  │
  ├── HIT  → config langsung digunakan (< 1ms)
  │
  └── MISS → query PostgreSQL (bot_config + bot_credentials)
               → decrypt AES-256-GCM tiap credential
               → Redis SET tenant_config:{userId} EX 600
               → config siap digunakan
```

### 4. Message Routing

```text
messageHandler.js
  │
  ├── AI mode   → Gemini API → Redis RPUSH session:{userId}:{telegramId} (max 20 item)
  │
  └── Button mode → buttonHandler.js
                     → Redis GET order:{userId}:{telegramId}
                         │
                         ├── IDLE       → kirim menu produk
                         ├── SELECTING  → proses pilihan, update state di Redis
                         └── CONFIRMING → lanjut ke orderHandler
```

### 5. Order Handler — Buat Pembayaran

```text
orderHandler.js
  → orderService.saveOrder(userId, ...) → DB: status=PAYMENT_PENDING
  → midtrans.createSnapTransaction(orderId, userId)
  → orderService.updateOrderPayment()  → DB: simpan payment_url + qr_string
  → Redis DEL order:{userId}:{telegramId}  ← hapus state order setelah selesai
  → Bot kirim link pembayaran ke user via Telegram
```

---

## Flow Lengkap: Webhook Midtrans

### 1. Notifikasi Masuk

```
Midtrans POST /api/webhook/midtrans
```

### 2. Verifikasi Signature HMAC

```js
const expectedSig = SHA512(orderId + statusCode + grossAmount + serverKey)
if (req.body.signature_key !== expectedSig) {
  return res.status(403).end()
}
```

> `serverKey` diambil dari Redis cache tenant (decrypt on-demand), bukan hardcoded.

### 3. Idempotency Check

```js
const order = await db.orders.findUnique({ where: { orderId } })

// Cegah proses duplikat (Midtrans retry bila tidak dapat 200)
if (order.status === 'COMPLETED') {
  return res.status(200).json({ message: 'already processed' })
}
```

### 4. Update Database & Notifikasi

```text
DB: update order → status=COMPLETED, paid_at=now()
  │
  ├── botManager → kirim notif sukses ke buyer (via Telegram)
  └── adminBot   → kirim notif ke admin / pemilik toko (tenant)
  │
  └── return HTTP 200 ke Midtrans
```

---

## Redis — Skema Key & TTL

| Key                             | Isi                                                      | TTL        | Keterangan                           |
| ------------------------------- | -------------------------------------------------------- | ---------- | ------------------------------------ |
| `tenant_config:{userId}`        | JSON config + credentials (sudah didekripsi)             | 600 detik  | Invalidate saat tenant update config |
| `order:{userId}:{telegramId}`   | JSON state order (IDLE / SELECTING / CONFIRMING + items) | 3600 detik | Auto-expire bila user tidak lanjut   |
| `session:{userId}:{telegramId}` | Array riwayat chat Gemini (max 20 item)                  | 1800 detik | Reset via command `/reset`           |
| `ratelimit:{ip}`                | Counter request (sliding window)                         | 60 detik   | Dikelola middleware rate limiter     |

---

## Database Schema (PostgreSQL)

```text
users (Tenant Utama)
  id (UUID), email, password_hash, name, plan, is_active
  created_at, updated_at
       │
       ├──► bot_config      (userId FK) → Bot mode, AI mode, Gemini model, Midtrans env
       ├──► bot_credentials (userId FK) → TELEGRAM_BOT_TOKEN, API keys (Terenkripsi AES-256-GCM)
       ├──► products        (userId FK) → Katalog produk
       └──► orders          (userId FK) → Riwayat transaksi

bot_config
  id, user_id (FK), midtrans_is_production
  is_active, created_at, updated_at

bot_credentials
  id, user_id (FK), key (unique per user), value (terenkripsi AES-256-GCM)
  created_at, updated_at

products
  id, user_id (FK), name, description, price, emoji, is_available
  created_at, updated_at

orders
  id, user_id (FK), order_id (unique per user), telegram_id, username, first_name
  total_price, status, payment_url, qr_string, midtrans_order_id, paid_at
  created_at, updated_at

order_items
  id, order_id (FK), product_id (FK), quantity, unit_price
```

---

## Enkripsi & Keamanan

**Algoritma:** AES-256-GCM (Authenticated Encryption)

Semua token dan credential (Telegram, Midtrans, Gemini, Admin Bot) di tabel `bot_credentials` disimpan sebagai ciphertext.

**Format di database:**

```
iv:authTag:ciphertext
(dipisah titik dua, base hex)
```

**Flow Enkripsi/Dekripsi:**

- `ENCRYPTION_KEY` (64-karakter hex / 32 bytes) dari `.env` — tidak boleh berubah tanpa re-enkripsi ulang seluruh database.
- Decrypt dilakukan di application layer saat cache miss, hasilnya disimpan ke Redis (tidak ke DB lagi).
- Redis instance wajib tidak exposed ke publik — hanya accessible dari internal Docker network.

**Validasi Webhook:**

- Telegram: `X-Telegram-Bot-Api-Secret-Token` header divalidasi di setiap request.
- Midtrans: HMAC SHA-512 signature diverifikasi menggunakan `serverKey` milik tenant.

---

## Alur Pembayaran (Midtrans) — Ringkasan

```text
User klik "Konfirmasi & Bayar"
  → orderService.saveOrder()          → DB: status=PAYMENT_PENDING
  → midtrans.createSnapTransaction()  → Midtrans API
  → orderService.updateOrderPayment() → DB: simpan payment_url + qr_string
  → Redis DEL order state
  → Bot kirim link pembayaran ke user

User bayar via Midtrans
  → Midtrans POST /api/webhook/midtrans
  → Verifikasi HMAC signature
  → Idempotency check (skip bila sudah COMPLETED)
  → DB: status=COMPLETED, paid_at=now()
  → Notif buyer via bot
  → Notif admin via adminBot
  → HTTP 200 ke Midtrans
```

---

## Docker Compose

```yaml
version: '3.8'

services:
  app:
    build: .
    restart: unless-stopped
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://user:pass@postgres:5432/botdb?connection_limit=20&pool_timeout=10
      - REDIS_URL=redis://redis:6379
    ports:
      - '3000:3000'
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:3000/health']
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 512M

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 3

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: botdb
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U user -d botdb']
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  redis_data:
  pg_data:
```

---

## Graceful Shutdown

```js
// src/index.js
process.on('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM received, draining...')

  // Stop terima request baru
  server.close()

  // Tunggu request aktif selesai (max 30 detik)
  await new Promise((resolve) => setTimeout(resolve, 30000))

  // Tutup koneksi
  await prisma.$disconnect()
  await redis.quit()

  console.log('[shutdown] Clean exit.')
  process.exit(0)
})
```

---

## Health Check Endpoint

```js
// src/app.js
app.get('/health', async (req, res) => {
  const redisOk = await redis
    .ping()
    .then((r) => r === 'PONG')
    .catch(() => false)
  const dbOk = await prisma.$queryRaw`SELECT 1`
    .then(() => true)
    .catch(() => false)

  const status = redisOk && dbOk ? 'ok' : 'degraded'
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    uptime: process.uptime(),
    redis: redisOk,
    db: dbOk,
  })
})
```

---

## In-Memory State (Dihapus di v2)

> State berikut **tidak lagi disimpan di memory Node.js**.
> Keduanya telah dimigrasikan ke Redis agar survive restart dan aman untuk scale horizontal.

| State                | v1 (lama)               | v2 (baru)                                              |
| -------------------- | ----------------------- | ------------------------------------------------------ |
| Order flow per buyer | `Map()` di `order.js`   | Redis key `order:{userId}:{telegramId}` TTL 1 jam      |
| Chat history Gemini  | `Map()` di `session.js` | Redis key `session:{userId}:{telegramId}` TTL 30 menit |

---

## Catatan Scaling

- **Horizontal scaling (k8s / multi-instance):** Aman. Semua state ada di Redis — tidak ada state lokal yang perlu di-sync antar instance.
- **Redis persistence:** `appendonly yes` di Docker Compose memastikan data tidak hilang saat container restart.
- **Connection pool Prisma:** Dikonfigurasi via `connection_limit=20` di `DATABASE_URL`. Sesuaikan dengan jumlah vCPU VPS.
- **Rate limiting:** Implementasi sliding window via Redis key `ratelimit:{ip}` di middleware Express — tidak butuh library eksternal tambahan.
- **Webhook vs Polling:** Full webhook mode menghilangkan N koneksi idle ke Telegram API. Tidak ada bot instance yang "menunggu" di memory.
