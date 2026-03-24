# 🤖 Telegram AI Bot — Panduan Setup Lengkap

Bot Telegram bertenaga **Google Gemini AI** dengan fitur order produk dan pembayaran via **Midtrans** (QRIS, GoPay, Transfer Bank). Notifikasi otomatis ke pembeli dan admin setelah pembayaran berhasil.

---

## 📋 Daftar Isi

1. [Prasyarat](#-prasyarat)
2. [Struktur Project](#-struktur-project)
3. [Setup Database MySQL](#1-setup-database-mysql)
4. [Setup Bot Telegram](#2-setup-bot-telegram)
5. [Setup Gemini AI](#3-setup-gemini-ai)
6. [Setup Midtrans Sandbox](#4-setup-midtrans-sandbox)
7. [Konfigurasi Project](#5-konfigurasi-project)
8. [Menjalankan Bot](#6-menjalankan-bot)
9. [Setup Webhook dengan ngrok](#7-setup-webhook-dengan-ngrok)
10. [Set Notification URL di Midtrans](#8-set-notification-url-di-midtrans)
11. [Testing Pembayaran](#9-testing-pembayaran)
12. [Kustomisasi Produk](#-kustomisasi-produk)
13. [Perintah Bot](#-perintah-bot)
14. [Troubleshooting](#-troubleshooting)

---

## ✅ Prasyarat

Pastikan sudah terinstall di komputer kamu:

| Software        | Versi     | Cek               |
| --------------- | --------- | ----------------- |
| Node.js         | >= 18.0.0 | `node --version`  |
| npm             | >= 9.0.0  | `npm --version`   |
| MySQL / MariaDB | >= 8.0    | `mysql --version` |

---

## 📁 Struktur Project

```
telegram-ai-bot
├─ ARCHITECTURE.md
├─ DEPLOYMENT_CHECKLIST.md
├─ FIX_SUMMARY.md
├─ M6_CHECKLIST.md
├─ M6_IMPLEMENTATION_GUIDE.md
├─ M6_IMPLEMENTATION_SUMMARY.md
├─ M6_NEXT_STEPS.md
├─ M6_PHASE3_WEBHOOK_ADMIN.md
├─ M6_PHASE4_STATE_MANAGEMENT.md
├─ PHASE5_INTEGRATION_TESTING.md
├─ PHASE5_SUMMARY.md
├─ PLAN.md
├─ README2.md
├─ WEBHOOK_ERROR_FIX.md
├─ package.json
├─ prisma
│  ├─ DATABASE.md
│  ├─ schema.prisma
│  ├─ seed-config.js
│  ├─ seed-migration-m6.js
│  └─ seed.js
├─ src
│  ├─ data
│  │  └─ products.js
│  ├─ handlers
│  │  ├─ HANDLERS.md
│  │  ├─ buttonHandler.js
│  │  ├─ index.js
│  │  ├─ messageHandler.js
│  │  └─ orderHandler.js
│  ├─ index-m6.js
│  ├─ index.js
│  ├─ services
│  │  ├─ SERVICES.md
│  │  ├─ adminBot.js
│  │  ├─ botManager.js
│  │  ├─ configService.js
│  │  ├─ db.js
│  │  ├─ gemini.js
│  │  ├─ midtrans.js
│  │  ├─ order.js
│  │  ├─ orderService.js
│  │  ├─ productService.js
│  │  ├─ session.js
│  │  ├─ tenantResolver.js
│  │  └─ userService.js
│  ├─ utils
│  │  ├─ encryption.js
│  │  └─ password.js
│  └─ webhook.js
├─ tests
│  ├─ integration-tests.js
│  ├─ load-tests.js
│  ├─ test-helpers.js
│  ├─ test-phase4.js
│  └─ webhook-tests.js
├─ troubleshoot-telegram.js
├─ validate-phase2.js
└─ validate-phase3.js
```

---

## 1. Setup Database MySQL

### Buat Database Baru

Login ke MySQL lalu buat database:

```sql
mysql -u root -p
```

```sql
CREATE DATABASE telegram_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EXIT;
```

### Install Dependencies & Migrate Schema

```bash
# Install semua package
npm install

# Buat semua tabel dari schema.prisma ke database
npm run db:push

# Generate Prisma client
npm run db:generate

# Isi data produk awal (opsional — bisa diisi manual lewat DB)
npm run db:seed
```

Setelah `db:push`, tabel berikut akan terbuat otomatis di database:

| Tabel         | Isi                     |
| ------------- | ----------------------- |
| `products`    | Data produk yang dijual |
| `orders`      | Data order dari pembeli |
| `order_items` | Detail item per order   |

### (Opsional) Buka GUI Database

```bash
npm run db:studio
```

Buka `http://localhost:5555` di browser untuk lihat dan edit data langsung.

---

## 2. Setup Bot Telegram

Project ini membutuhkan **2 bot Telegram**:

| Bot           | Fungsi                                                         |
| ------------- | -------------------------------------------------------------- |
| **Bot Utama** | Berinteraksi dengan pembeli (chat AI, order, notif pembayaran) |
| **Bot Admin** | Mengirim notifikasi order baru ke pemilik toko                 |

### Membuat Bot via @BotFather

1. Buka Telegram → cari **@BotFather**
2. Kirim perintah `/newbot`
3. Masukkan **nama bot** (contoh: `Toko Online Bot`)
4. Masukkan **username bot** — harus diakhiri `bot` (contoh: `tokoonline_bot`)
5. BotFather akan memberikan **token** — simpan baik-baik

Ulangi langkah di atas untuk membuat **Bot Admin**.

### Mendapatkan Chat ID Admin

Chat ID diperlukan agar Bot Admin tahu ke mana harus mengirim notifikasi.

1. Start **Bot Admin** dari akun Telegram kamu (klik Start)
2. Kirim pesan apapun ke bot tersebut
3. Buka URL berikut di browser (ganti `<TOKEN>` dengan token Bot Admin):

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

4. Cari bagian seperti ini di response JSON:

```json
"chat": {
  "id": 123456789,   <-- ini ADMIN_CHAT_ID kamu
  "first_name": "Nama",
  "type": "private"
}
```

5. Catat angka tersebut sebagai `ADMIN_CHAT_ID`

---

## 3. Setup Gemini AI

1. Buka [Google AI Studio](https://aistudio.google.com/)
2. Login dengan akun Google
3. Klik **Get API Key** di pojok kiri atas
4. Klik **Create API Key** → pilih project Google Cloud (atau buat baru)
5. Copy API key yang muncul

> API key Gemini gratis dengan batas penggunaan tertentu. Cukup untuk development dan skala kecil.

---

## 4. Setup Midtrans Sandbox

### Daftar Akun

1. Buka [dashboard.sandbox.midtrans.com](https://dashboard.sandbox.midtrans.com)
2. Klik **Sign Up** → isi data → verifikasi email
3. Login ke dashboard sandbox

### Ambil API Keys

1. Di dashboard, klik **Settings** (ikon gear) → **Access Keys**
2. Catat dua key berikut:
   - **Server Key** → dimulai dengan `SB-Mid-server-...`
   - **Client Key** → dimulai dengan `SB-Mid-client-...`

---

## 5. Konfigurasi Project

### Buat File .env

```bash
cp .env.example .env
```

### Isi Semua Nilai

Buka file `.env` dan isi sesuai data yang sudah dikumpulkan:

```env
# ── Bot Telegram ─────────────────────────────────────────
# Token Bot Utama (dari @BotFather)
TELEGRAM_BOT_TOKEN=1234567890:AABBccDDeeFfGgHhIiJjKkLlMmNnOoPpQq

# Token Bot Admin (bot kedua — untuk notifikasi ke pemilik toko)
ADMIN_BOT_TOKEN=9876543210:AAZZyyXxWwVvUuTtSsRrQqPpOoNnMmLlKk

# Chat ID pemilik toko (cara dapat ada di bagian Setup Bot Telegram)
ADMIN_CHAT_ID=123456789

# ── Google Gemini AI ──────────────────────────────────────
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
GEMINI_MODEL=gemini-2.0-flash

# ── Mode Bot ──────────────────────────────────────────────
# Gunakan "polling" untuk development lokal
BOT_MODE=polling

# ── Database ──────────────────────────────────────────────
# Sesuaikan user, password, port, dan nama database
DATABASE_URL=mysql://root:password@localhost:3306/telegram_bot

# ── Midtrans ──────────────────────────────────────────────
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxxxxxxxxxxxxxxxxxxxxxx
MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxxxxxxxxxxxxxxxxxxxxxx
MIDTRANS_IS_PRODUCTION=false

# Port untuk webhook server (jangan diubah kecuali konflik)
WEBHOOK_PORT=3000

# URL finish setelah bayar (bisa diisi username bot utama)
MIDTRANS_FINISH_URL=https://t.me/username_bot_utama_kamu
```

> **Penting:** Jangan pernah commit file `.env` ke Git. File ini sudah ada di `.gitignore`.

---

## 6. Menjalankan Bot

```bash
# Mode development — auto restart saat ada perubahan file
npm run dev

# Mode production
npm start
```

Jika berhasil, terminal akan menampilkan:

```
👮 Admin bot siap mengirim notifikasi.
🌐 Webhook server berjalan di http://localhost:3000
   Endpoint Midtrans: http://localhost:3000/webhook/midtrans
🤖 Bot Telegram AI dimulai...
📡 Mode: Polling (development)
✅ Bot siap menerima pesan!
```

Test bot berjalan — buka Telegram → cari bot utama → kirim `/start`.

---

## 7. Setup Webhook dengan ngrok

Midtrans perlu mengirim notifikasi pembayaran ke server kamu. Di development (localhost), kita butuh **ngrok** untuk membuat localhost bisa diakses dari internet.

### Install ngrok

```bash
# macOS (Homebrew)
brew install ngrok

# Windows — download dari https://ngrok.com/download
# Linux
snap install ngrok
```

Atau download langsung dari [ngrok.com/download](https://ngrok.com/download).

### Daftar & Autentikasi (Gratis)

1. Daftar di [ngrok.com](https://ngrok.com) → gratis
2. Setelah login, buka [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Copy authtoken kamu
4. Jalankan di terminal:

```bash
ngrok config add-authtoken <AUTHTOKEN_KAMU>
```

### Jalankan ngrok

Buka **terminal baru** (jangan tutup terminal yang menjalankan bot):

```bash
ngrok http 3000
```

Output yang muncul:

```
Session Status    online
Account           nama@email.com
Forwarding        https://abc123def456.ngrok-free.app -> http://localhost:3000
```

**Catat URL ngrok** — contoh: `https://abc123def456.ngrok-free.app`

> URL ngrok berubah setiap kali ngrok dijalankan ulang (kecuali pakai plan berbayar). Jika ngrok direstart, update Notification URL di Midtrans Dashboard.

### Verifikasi ngrok Berjalan

Buka di browser:

```
https://abc123def456.ngrok-free.app/health
```

Harus muncul response:

```json
{ "status": "ok", "timestamp": "2024-03-15T10:30:00.000Z" }
```

---

## 8. Set Notification URL di Midtrans

Ini langkah **paling penting** — tanpa ini Midtrans tidak bisa memberi tahu bot bahwa pembayaran berhasil.

1. Login ke [dashboard.sandbox.midtrans.com](https://dashboard.sandbox.midtrans.com)
2. Klik **Settings** → **Configuration**
3. Cari bagian **Payment**
4. Isi field **Payment Notification URL**:

```
https://abc123def456.ngrok-free.app/webhook/midtrans
```

5. Klik **Update**

Untuk field lainnya:

| Field                    | Nilai                                                     |
| ------------------------ | --------------------------------------------------------- |
| Payment Notification URL | `https://xxx.ngrok-free.app/webhook/midtrans` ← **wajib** |
| Finish Redirect URL      | `https://t.me/username_bot_kamu` (opsional)               |
| Unfinish Redirect URL    | Kosongkan                                                 |
| Error Redirect URL       | Kosongkan                                                 |

---

## 9. Testing Pembayaran

### Buat Order Test

1. Buka bot utama di Telegram
2. Ketik: `saya mau pesan ayam bakar 2`
3. Bot akan menampilkan ringkasan order
4. Ketik `/konfirmasi`
5. Bot akan mengirim **link pembayaran Midtrans**

### Bayar via Simulator

Buka link pembayaran → pilih metode:

**GoPay (paling stabil untuk sandbox):**

1. Pilih GoPay → klik "Bayar dengan GoPay"
2. Klik link simulator yang muncul, atau buka:
   `https://simulator.sandbox.midtrans.com/gopay/ui/index`
3. Klik **Success**

**Kartu Kredit (paling mudah):**

1. Pilih Kartu Kredit
2. Gunakan data test berikut:

| Field       | Value                 |
| ----------- | --------------------- |
| Nomor Kartu | `4811 1111 1111 1114` |
| Expired     | `01/26`               |
| CVV         | `123`                 |
| OTP         | `112233`              |

### Verifikasi Berhasil

Setelah bayar, dalam beberapa detik:

- **Pembeli** mendapat pesan: `✅ Pembayaran Berhasil!`
- **Admin** mendapat pesan: `🛎️ ORDER BARU MASUK!` dengan detail lengkap
- **Database** — status order berubah menjadi `COMPLETED`

Cek log di terminal:

```
[Webhook] Notifikasi Midtrans: ORD-20240315-4821 settlement
[Webhook] Pembayaran berhasil: ORD-20240315-4821
[AdminBot] Notifikasi order sukses terkirim ke admin: ORD-20240315-4821
```

---

## 🛍️ Kustomisasi Produk

Edit atau tambah produk langsung di database, atau ubah file seed:

```javascript
// prisma/seed.js
const seedProducts = [
  {
    name: 'Nama Produk',
    description: 'Deskripsi produk di sini',
    price: 50000, // harga dalam Rupiah
    emoji: '🍕',
    isAvailable: true, // false = tidak tampil di menu
  },
  // tambah produk lainnya...
]
```

Jalankan ulang seed setelah diubah:

```bash
npm run db:seed
```

Atau edit langsung via Prisma Studio:

```bash
npm run db:studio
# Buka http://localhost:5555
```

---

## 💬 Perintah Bot

| Perintah      | Fungsi                                      |
| ------------- | ------------------------------------------- |
| `/start`      | Tampilkan pesan selamat datang              |
| `/menu`       | Lihat daftar produk                         |
| `/pesan`      | Mulai proses order                          |
| `/konfirmasi` | Konfirmasi order → generate link pembayaran |
| `/batal`      | Batalkan order yang sedang berjalan         |
| `/reset`      | Hapus riwayat percakapan AI                 |
| `/help`       | Tampilkan bantuan                           |

Selain perintah, user juga bisa chat natural language:

- _"saya mau lihat menu"_ → tampil menu
- _"pesan jus alpukat 3"_ → langsung ke ringkasan order
- _"batalkan pesanan saya"_ → batalkan order

---

## 🔧 Script npm

| Script          | Perintah              | Fungsi                           |
| --------------- | --------------------- | -------------------------------- |
| Jalankan dev    | `npm run dev`         | Jalankan bot dengan auto-restart |
| Jalankan prod   | `npm start`           | Jalankan bot production          |
| Push schema     | `npm run db:push`     | Buat/update tabel dari schema    |
| Generate client | `npm run db:generate` | Generate ulang Prisma client     |
| Seed data       | `npm run db:seed`     | Isi data produk awal             |
| Studio          | `npm run db:studio`   | Buka GUI database di browser     |

---

## 🚨 Troubleshooting

### Bot tidak merespon

- Pastikan terminal menampilkan `✅ Bot siap menerima pesan!`
- Cek `TELEGRAM_BOT_TOKEN` di `.env` sudah benar
- Pastikan tidak ada bot lain yang menggunakan token yang sama

### Webhook tidak kena dari Midtrans

1. Pastikan ngrok berjalan: `ngrok http 3000`
2. Test health check: `curl https://xxx.ngrok-free.app/health`
3. Pastikan Notification URL di Midtrans Dashboard sudah diupdate dengan URL ngrok terbaru
4. Cek log ngrok di `http://127.0.0.1:4040`

### Error koneksi database

- Cek `DATABASE_URL` di `.env` — pastikan user, password, port, dan nama database benar
- Pastikan MySQL sedang berjalan
- Coba koneksi manual: `mysql -u root -p telegram_bot`

### Notifikasi admin tidak terkirim

- Pastikan `ADMIN_BOT_TOKEN` dan `ADMIN_CHAT_ID` sudah diisi di `.env`
- Pastikan sudah pernah `/start` ke bot admin dari akun Telegram admin
- Cek log terminal untuk pesan error `[AdminBot]`

### Error `GEMINI_API_KEY`

- Pastikan API key masih aktif di [Google AI Studio](https://aistudio.google.com/)
- Cek quota penggunaan — free tier ada batasnya

### URL ngrok berubah setiap restart

Ini normal di plan gratis ngrok. Setiap kali ngrok direstart, kamu perlu:

1. Copy URL ngrok baru
2. Update Notification URL di Midtrans Dashboard

Untuk URL permanen, gunakan ngrok plan berbayar atau deploy ke VPS.

---

## 📦 Dependencies

| Package                 | Fungsi                                 |
| ----------------------- | -------------------------------------- |
| `node-telegram-bot-api` | Telegram Bot API untuk Node.js         |
| `@prisma/client`        | ORM untuk akses database               |
| `dotenv`                | Load environment variables dari `.env` |

> Midtrans dan Gemini AI diakses menggunakan `fetch` bawaan Node.js 18+ — tidak perlu library tambahan.

---

## ⚠️ Catatan Penting

- **Jangan commit `.env`** ke Git — berisi kredensial sensitif
- **Ganti token jika bocor** — lewat @BotFather → `/mybots` → Revoke token
- **Riwayat chat AI** disimpan di memory — hilang saat bot restart. Untuk production gunakan Redis
- **URL ngrok berubah** setiap restart — update selalu di Midtrans Dashboard
- **Untuk production**, ganti `MIDTRANS_IS_PRODUCTION=true` dan gunakan key production Midtrans

```
telegram-ai-bot
├─ ARCHITECTURE.md
├─ DEPLOYMENT_CHECKLIST.md
├─ FIX_SUMMARY.md
├─ M6_CHECKLIST.md
├─ M6_IMPLEMENTATION_GUIDE.md
├─ M6_IMPLEMENTATION_SUMMARY.md
├─ M6_NEXT_STEPS.md
├─ M6_PHASE3_WEBHOOK_ADMIN.md
├─ M6_PHASE4_STATE_MANAGEMENT.md
├─ PHASE5_INTEGRATION_TESTING.md
├─ PHASE5_SUMMARY.md
├─ PLAN.md
├─ README.md
├─ WEBHOOK_ERROR_FIX.md
├─ package.json
├─ prisma
│  ├─ DATABASE.md
│  ├─ schema.prisma
│  ├─ seed-config.js
│  ├─ seed-migration-m6.js
│  └─ seed.js
├─ src
│  ├─ data
│  │  └─ products.js
│  ├─ handlers
│  │  ├─ HANDLERS.md
│  │  ├─ buttonHandler.js
│  │  ├─ index.js
│  │  ├─ messageHandler.js
│  │  └─ orderHandler.js
│  ├─ index-m6.js
│  ├─ index.js
│  ├─ services
│  │  ├─ SERVICES.md
│  │  ├─ adminBot.js
│  │  ├─ botManager.js
│  │  ├─ configService.js
│  │  ├─ db.js
│  │  ├─ gemini.js
│  │  ├─ midtrans.js
│  │  ├─ order.js
│  │  ├─ orderService.js
│  │  ├─ productService.js
│  │  ├─ session.js
│  │  ├─ tenantResolver.js
│  │  └─ userService.js
│  ├─ utils
│  │  ├─ encryption.js
│  │  └─ password.js
│  └─ webhook.js
├─ tests
│  ├─ integration-tests.js
│  ├─ load-tests.js
│  ├─ test-helpers.js
│  ├─ test-phase4.js
│  └─ webhook-tests.js
├─ troubleshoot-telegram.js
├─ validate-phase2.js
└─ validate-phase3.js

```
