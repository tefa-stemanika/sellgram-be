# ARCHITECTURE.md — Arsitektur Sistem

## Stack Teknologi

| Layer | Teknologi |
|---|---|
| Runtime | Node.js >= 18 (native fetch, ESM) |
| Bot Library | `node-telegram-bot-api` |
| AI | Google Gemini API (native fetch, tanpa SDK) |
| Payment | Midtrans Snap API (native fetch, tanpa SDK) |
| ORM | Prisma |
| Database | MySQL / MariaDB |
| Enkripsi | Node.js `crypto` — AES-256-GCM |

---

## Struktur Folder

```
telegram-ai-bot/
├── docs/                        ← Dokumentasi project
│   ├── PLAN.md                  ← Roadmap & rencana
│   ├── ARCHITECTURE.md          ← Dokumen ini
│   ├── SERVICES.md              ← Dokumentasi services
│   └── HANDLERS.md              ← Dokumentasi handlers
├── prisma/
│   ├── schema.prisma            ← Definisi tabel database
│   ├── seed.js                  ← Seed data produk awal
│   └── seed-config.js           ← Migrasi credentials dari .env ke DB
├── src/
│   ├── index.js                 ← Entry point
│   ├── webhook.js               ← HTTP server webhook Midtrans
│   ├── handlers/
│   │   ├── messageHandler.js    ← Router pesan masuk (AI vs button mode)
│   │   ├── orderHandler.js      ← Flow order via command/teks
│   │   └── buttonHandler.js     ← Flow order via inline keyboard
│   ├── services/
│   │   ├── configService.js     ← Single source of truth config dari DB
│   │   ├── db.js                ← Prisma client singleton
│   │   ├── gemini.js            ← Integrasi Gemini AI
│   │   ├── midtrans.js          ← Integrasi Midtrans payment
│   │   ├── adminBot.js          ← Bot notifikasi ke admin
│   │   ├── productService.js    ← Query produk dari DB
│   │   ├── orderService.js      ← Query & simpan order ke DB
│   │   ├── order.js             ← State machine order (in-memory)
│   │   └── session.js           ← Riwayat chat AI (in-memory)
│   └── utils/
│       └── encryption.js        ← AES-256-GCM encrypt/decrypt
├── .env                         ← Hanya DATABASE_URL, ENCRYPTION_KEY, dll
├── .env.example                 ← Template
└── package.json
```

---

## Arsitektur Saat Ini (Single-Tenant)

```
.env (infrastruktur)
  DATABASE_URL, ENCRYPTION_KEY, BOT_MODE, WEBHOOK_PORT
         │
         ▼
    index.js
    loadConfig() ──► DB: bot_config + bot_credentials (terenkripsi)
         │                    │
         │              configService.js (cache in-memory)
         │                    │
    TelegramBot ◄─────────────┤
         │                    │
    messageHandler ───────────┤
         │                    │
    ┌────┴────┐          ┌────┴──────────┐
    │ AI Mode │          │ Button Mode   │
    │ gemini  │          │ buttonHandler │
    └────┬────┘          └──────┬────────┘
         │                     │
         └─────────┬───────────┘
                   │
             orderHandler
                   │
          ┌────────┴────────┐
          │                 │
    orderService       midtrans.js
    (simpan order)   (buat transaksi)
          │                 │
          DB           Midtrans API
                            │
                     webhook.js ◄── Midtrans notifikasi
                            │
                   ┌────────┴────────┐
                   │                 │
             botInstance         adminBot.js
           (notif pembeli)    (notif admin)
```

---

## Arsitektur Target (Multi-Tenant / SaaS) — M6

Setiap user (tenant = pemilik bisnis) memiliki bot instance-nya sendiri.
Customer yang chat ke bot akan otomatis terlayani dengan config milik
user yang memiliki bot tersebut.

```
users tabel
  id, email, plan, is_active
       │
       ├──► bot_credentials (user_id FK) → TELEGRAM_BOT_TOKEN per user
       ├──► bot_config      (user_id FK) → AI mode, Gemini model per user
       ├──► products        (user_id FK) → katalog produk per user
       └──► orders          (user_id FK) → riwayat order per user

Bot Manager
  ├── spawn(userId) → buat instance bot dengan token milik userId
  ├── stop(userId)  → hentikan instance
  └── Map<userId, BotInstance>

Tenant Resolver (saat pesan masuk)
  incoming message
       │
       ▼
  Cari user_id dari bot_token yang aktif
       │
       ▼
  Load config + credentials userId tersebut
       │
       ▼
  Proses pesan dalam konteks userId
```

---

## Database Schema (Saat Ini)

```
bot_config
  id, ai_enabled, gemini_model, midtrans_is_production, is_active
  created_at, updated_at

bot_credentials
  id, key (unique), value (encrypted AES-256-GCM)
  created_at, updated_at

  Keys yang tersimpan:
  - TELEGRAM_BOT_TOKEN
  - ADMIN_BOT_TOKEN
  - ADMIN_CHAT_ID
  - GEMINI_API_KEY
  - MIDTRANS_SERVER_KEY
  - MIDTRANS_CLIENT_KEY

products
  id, name, description, price, emoji, is_available
  created_at, updated_at

orders
  id, order_id (unique), telegram_id, username, first_name
  total_price, status, payment_url, qr_string
  midtrans_order_id, paid_at
  created_at, updated_at

order_items
  id, order_id (FK), product_id (FK), quantity, unit_price
```

## Database Schema Target (M6 — Multi-User)

```
users                              ← BARU
  id, email, password_hash, name
  plan, is_active
  created_at, updated_at

bot_config    + user_id FK         ← UPDATE
bot_credentials + user_id FK       ← UPDATE
products      + user_id FK         ← UPDATE
orders        + user_id FK         ← UPDATE
```

---

## Alur Pembayaran

```
User: /konfirmasi atau klik "Konfirmasi & Bayar"
          │
          ▼
   saveOrder() → DB: status=PAYMENT_PENDING
          │
          ▼
   createSnapTransaction() → Midtrans API
          │
          ▼
   updateOrderPayment() → DB: simpan payment_url
          │
          ▼
   Kirim pesan ke user: link pembayaran + tombol "Bayar Sekarang"
          │
    User bayar via Midtrans Snap
          │
          ▼
   Midtrans POST ke /webhook/midtrans (ngrok → localhost:3000)
          │
          ▼
   verifyWebhookSignature() → validasi dari Midtrans
          │
          ▼
   DB: update status=COMPLETED, paidAt=now()
          │
          ├──► sendPaymentSuccessNotification() → user pembeli
          └──► notifyAdminOrderSuccess()        → admin
```

---

## Enkripsi Credentials

**Algoritma:** AES-256-GCM (authenticated encryption)

**Format di database:**
```
iv:authTag:ciphertext
(semua hex string, dipisah titik dua)
```

**Flow:**
```
plaintext (misal: "SB-Mid-server-xxx")
    │
    ▼ encrypt(plaintext) — src/utils/encryption.js
    │  · generate random 12-byte IV
    │  · AES-256-GCM dengan ENCRYPTION_KEY dari .env
    │
    ▼
"a1b2c3...:d4e5f6...:789abc..."  ← disimpan di DB
    │
    ▼ decrypt(encryptedString)
    │
    ▼
plaintext kembali

Key source: ENCRYPTION_KEY (64 char hex = 32 bytes) di .env
```

**Penting:** `ENCRYPTION_KEY` tidak boleh berubah setelah credentials tersimpan.
Simpan key ini di tempat aman (password manager, secret manager).

---

## In-Memory State

Dua hal yang disimpan di memory (hilang saat bot restart):

| State | File | Isi | Reset |
|---|---|---|---|
| Order flow | `order.js` | State mesin tiap user (IDLE/SELECTING/CONFIRMING) | Selesai order / /batal |
| Chat history | `session.js` | Riwayat pesan AI per user (max 20 pesan) | /reset |

**Untuk production:** pertimbangkan Redis untuk persistensi session lintas restart.
