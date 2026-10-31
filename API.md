# API Documentation

Base URL: `http://localhost:3000/api`

## Authentication

All protected endpoints require a JWT Bearer token.

### Register

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "secret123",
    "name": "Admin"
  }'
```

Response:

```json
{
  "success": true,
  "message": "Register success",
  "data": {
    "user": { "id": "uuid", "email": "admin@example.com", "name": "Admin", "plan": "FREE", "isActive": true },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "secret123"
  }'
```

Response:

```json
{
  "success": true,
  "message": "Login success",
  "data": {
    "user": { "id": "uuid", "email": "admin@example.com", "name": "Admin", "plan": "FREE" },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

Simpan `token` dan kirim sebagai header untuk endpoint selanjutnya.

### Format respons error

```json
{
  "success": false,
  "message": "Broadcast lewat WHATSAPP belum didukung. Kanal yang tersedia: TELEGRAM.",
  "code": "channel_not_supported"
}
```

`code` hanya dikirim untuk error yang punya status HTTP eksplisit (mis. `channel_not_supported`, `PLAN_LIMIT_EXCEEDED`, `FEATURE_NOT_ALLOWED`). Error tak terduga hanya mengirim `success` + `message`.

---

## Dashboard

### GET /api/dashboard

Ringkasan statistik untuk halaman dashboard utama.

```bash
curl -X GET http://localhost:3000/api/dashboard \
  -H "Authorization: Bearer <token>"
```

Response:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "activeProducts": 12,
    "totalOrders": 287,
    "pendingOrders": 8,
    "totalRevenue": 45850000,
    "revenueGrowth": 15.3,
    "recentOrders": [
      {
        "id": "uuid-1",
        "orderId": "ORD-20260601-1234",
        "source": "TELEGRAM",
        "firstName": "Budi",
        "username": "budi123",
        "customerName": null,
        "customerPhone": null,
        "status": "COMPLETED",
        "totalPrice": 150000,
        "createdAt": "2026-06-07T10:30:00.000Z"
      },
      {
        "id": "uuid-2",
        "orderId": "ORD-20260601-5678",
        "source": "WHATSAPP",
        "firstName": "Siti",
        "username": null,
        "customerName": "Siti Aminah",
        "customerPhone": "6281234567890",
        "status": "PENDING",
        "totalPrice": 75000,
        "createdAt": "2026-06-07T09:15:00.000Z"
      }
    ],
    "ordersBySource": {
      "TELEGRAM": 200,
      "WHATSAPP": 60,
      "WEBSITE": 27
    },
    "revenueBySource": {
      "TELEGRAM": 30000000,
      "WHATSAPP": 12000000,
      "WEBSITE": 3850000
    },
    "tickets": {
      "total": 14,
      "open": 5,
      "closed": 9
    }
  }
}
```

#### Field Reference

| Field | Type | Description |
|---|---|---|
| `activeProducts` | number | Jumlah produk dengan `isAvailable = true` dan belum di-soft delete |
| `totalOrders` | number | Total seluruh order (semua status) |
| `pendingOrders` | number | Order dengan status `PENDING` + `PAYMENT_PENDING` |
| `totalRevenue` | number | Total pendapatan order `COMPLETED` bulan berjalan |
| `revenueGrowth` | number | Persentase perubahan revenue vs bulan lalu (1 desimal); `100` bila bulan lalu nol dan bulan ini ada revenue |
| `recentOrders` | array | 5 order terbaru. `username` hanya terisi untuk order Telegram; `customerName`/`customerPhone` dipakai order WhatsApp/Website — keduanya bisa `null`, jadi jangan andalkan satu field saja |
| `ordersBySource` | object | Jumlah order per kanal: `TELEGRAM`, `WHATSAPP`, `WEBSITE` |
| `revenueBySource` | object | Total revenue order `COMPLETED` per kanal (key sama dengan `ordersBySource`) |
| `tickets.total` | number | Seluruh ticket tenant |
| `tickets.open` | number | Ticket berstatus `OPEN`, `IN_PROGRESS`, atau `WAITING_CUSTOMER` |
| `tickets.closed` | number | `total - open` |

---

## Products

### GET /api/products

```bash
curl -X GET http://localhost:3000/api/products \
  -H "Authorization: Bearer <token>"
```

### GET /api/products/:id

```bash
curl -X GET http://localhost:3000/api/products/0a1b2c3d-... \
  -H "Authorization: Bearer <token>"
```

### POST /api/products

```bash
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Converse Chuck 70",
    "description": "Sepatu canvas klasik high-top",
    "price": 450000,
    "emoji": "👟",
    "isAvailable": true
  }'
```

### PUT /api/products/:id

```bash
curl -X PUT http://localhost:3000/api/products/0a1b2c3d-... \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "price": 475000,
    "isAvailable": false
  }'
```

### DELETE /api/products/:id

```bash
curl -X DELETE http://localhost:3000/api/products/0a1b2c3d-... \
  -H "Authorization: Bearer <token>"
```

---

## Orders

### GET /api/orders

```bash
curl -X GET http://localhost:3000/api/orders \
  -H "Authorization: Bearer <token>"
```

Query params: `?limit=10&status=COMPLETED`

### GET /api/orders/:id

```bash
curl -X GET http://localhost:3000/api/orders/0a1b2c3d-... \
  -H "Authorization: Bearer <token>"
```

---

## Bot Config

### GET /api/bot-config

```bash
curl -X GET http://localhost:3000/api/bot-config \
  -H "Authorization: Bearer <token>"
```

### PUT /api/bot-config/:id

```bash
curl -X PUT http://localhost:3000/api/bot-config/uuid \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "midtransIsProduction": true
  }'
```

---

## Credentials

### GET /api/bot-credentials

```bash
curl -X GET http://localhost:3000/api/bot-credentials \
  -H "Authorization: Bearer <token>"
```

### POST /api/bot-credentials

```bash
curl -X POST http://localhost:3000/api/bot-credentials \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "credentials": {
      "TELEGRAM_BOT_TOKEN": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      "MIDTRANS_SERVER_KEY_SANDBOX": "SB-Mid-server-xxxxxxxxxxxxx",
      "MIDTRANS_CLIENT_KEY_SANDBOX": "SB-Mid-client-xxxxxxxxxxxxx"
    }
  }'
```

### PUT /api/bot-credentials/:id

```bash
curl -X PUT http://localhost:3000/api/bot-credentials/uuid \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "value": "new-value-here"
  }'
```

### DELETE /api/bot-credentials/:id

```bash
curl -X DELETE http://localhost:3000/api/bot-credentials/uuid \
  -H "Authorization: Bearer <token>"
```

---

## Bots (Instance Management)

### GET /api/bots

```bash
curl -X GET http://localhost:3000/api/bots \
  -H "Authorization: Bearer <token>"
```

### POST /api/bots/restart

```bash
curl -X POST http://localhost:3000/api/bots/restart \
  -H "Authorization: Bearer <token>"
```

### GET /api/bots/health

Cek kesehatan bot: validitas token (`getMe`), status webhook (`getWebhookInfo`), runtime, dan aktivitas update terakhir. Hasil di-cache 60 detik; tambahkan `?refresh=true` untuk cek live.

```bash
curl -X GET "http://localhost:3000/api/bots/health?refresh=true" \
  -H "Authorization: Bearer <token>"
```

```json
{
  "success": true,
  "message": "Bot health retrieved",
  "data": {
    "userId": "uuid",
    "status": "healthy",
    "cached": false,
    "checkedAt": "2026-10-30T10:00:00.000Z",
    "cacheTtlSeconds": 60,
    "checks": {
      "token": { "status": "ok", "botId": 123, "username": "toko_bot", "firstName": "Toko", "error": null },
      "webhook": { "status": "ok", "url": "https://app.example.com/api/webhook/telegram/uuid", "expectedUrl": "https://app.example.com/api/webhook/telegram/uuid", "pendingUpdateCount": 0, "lastErrorAt": null, "lastErrorMessage": null, "error": null },
      "runtime": { "active": true },
      "activity": { "lastUpdateAt": "2026-10-30T09:58:12.000Z" },
      "whatsapp": { "status": "ok", "instance": "tenant-uuid", "instanceExists": true, "state": "open", "connected": true, "webhookSynced": true, "error": null }
    },
    "issues": []
  }
}
```

`status`: `healthy` | `degraded` (ada warning) | `unhealthy` (masalah kritis) | `unknown` (Telegram tidak dapat dihubungi). Kode issue kritis: `TOKEN_MISSING`, `TOKEN_INVALID`, `WEBHOOK_URL_MISSING`, `WEBHOOK_URL_INVALID`, `WEBHOOK_URL_MISMATCH`, `WHATSAPP_WEBHOOK_NOT_SYNCED`. Warning: `TELEGRAM_API_UNREACHABLE`, `CONFIG_UNAVAILABLE`, `WEBHOOK_LAST_ERROR_RECENT`, `WEBHOOK_PENDING_BACKLOG`, `WEBHOOK_CHECK_FAILED`, `BOT_NOT_SPAWNED`, `WHATSAPP_NOT_CONNECTED`, `WHATSAPP_CHECK_FAILED`.

`checks.whatsapp.status`: `not_configured` (tenant tidak memakai WhatsApp atau instance belum dibuat — tidak memengaruhi `status` keseluruhan), `ok`, `disconnected`, `error`, `skipped`.

Monitor background berjalan tiap `BOT_HEALTH_MONITOR_INTERVAL_MS` (default 5 menit, `<= 0` untuk mematikan) dan mencatat peringatan `[BotHealth]` di log saat status bot berubah. Sweep mencakup semua bot Telegram aktif **ditambah** tenant yang punya credential Evolution (langsung dicek walau bot Telegram-nya mati), sehingga instance WhatsApp yang logout ketahuan tanpa perlu membuka dashboard.

### GET /api/bots/whatsapp/status

Cek status instance WhatsApp di Evolution API dan konfigurasi webhook-nya. Membutuhkan credential `EVOLUTION_API_URL` dan `EVOLUTION_API_KEY` (per tenant atau fallback env). Nama instance selalu diturunkan backend dari `userId` (`tenant-<userId tanpa tanda baca>`) dan tidak dapat diatur lewat env maupun client.

```bash
curl -X GET http://localhost:3000/api/bots/whatsapp/status \
  -H "Authorization: Bearer <token>"
```

```json
{
  "success": true,
  "message": "Get WhatsApp status success",
  "data": {
    "userId": "uuid",
    "configured": true,
    "instance": "tenant-<uuid-tanpa-dash>",
    "instanceExists": true,
    "needsCreate": false,
    "instanceLimit": 1,
    "apiUrl": "https://evolution.example.com",
    "state": "open",
    "connected": true,
    "webhook": {
      "url": "https://app.example.com/api/webhook/whatsapp/uuid",
      "enabled": true,
      "events": ["MESSAGES_UPSERT"],
      "expectedUrl": "https://app.example.com/api/webhook/whatsapp/uuid",
      "synced": true
    },
    "errors": []
  }
}
```

`instance` selalu turunan `userId` dan dikelola backend — tenant tidak bisa mengganti nama instance. `instanceExists: false` / `needsCreate: true` berarti instance belum ada di server Evolution — panggil endpoint create instance. `webhook.synced: false` berarti webhook belum menunjuk ke endpoint tenant; panggil create/connect/restart untuk menyinkronkannya. `instanceLimit` selalu `1` (satu instance per user).

### POST /api/bots/whatsapp/instance

Membuat instance Evolution milik tenant (idempotent — instance yang sudah ada tidak dibuat ulang). Nama instance deterministik dan dikelola backend: `tenant-<userId tanpa tanda baca>`; nilainya tidak disimpan sebagai credential dan tidak dapat diatur tenant. Maksimal **1 instance per user**; bila terdeteksi lebih dari satu, endpoint mengembalikan `409 instance_limit_reached`.

Webhook otomatis dipasang setelah instance berhasil dibuat/ditemukan, dengan URL berdasarkan userId: `${PUBLIC_BASE_URL}/api/webhook/whatsapp/:userId`, header `x-evolution-webhook-secret`, dan event `MESSAGES_UPSERT`. Bila webhook sudah sesuai, `/webhook/set` tidak dipanggil ulang (`action: "unchanged"`).

```bash
curl -X POST http://localhost:3000/api/bots/whatsapp/instance \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "number": "6281234567890" }'
```

Body opsional. `number` (8-15 digit) membuat Evolution menampilkan pairing code sebagai alternatif scan QR.

```json
{
  "success": true,
  "message": "Instance WhatsApp berhasil dibuat",
  "data": {
    "userId": "uuid",
    "created": true,
    "instance": "tenant-<uuid-tanpa-dash>",
    "instanceLimit": 1,
    "apiUrl": "https://evolution.example.com",
    "state": "connecting",
    "connected": false,
    "qr": { "base64": "data:image/png;base64,...", "code": "2@...", "pairingCode": null, "count": 1 },
    "webhook": {
      "success": true,
      "action": "created",
      "webhookUrl": "https://app.example.com/api/webhook/whatsapp/uuid",
      "events": ["MESSAGES_UPSERT"]
    }
  }
}
```

`webhook.action`: `created` | `updated` | `unchanged`. Status HTTP `201` saat instance baru dibuat, `200` saat sudah ada.

### GET /api/bots/whatsapp/connect

Ambil QR / pairing code untuk menghubungkan WhatsApp seperti WhatsApp Web. Response Evolution dinormalisasi ke field `base64`, `code`, `pairingCode`, dan `count`. Webhook tenant juga dipastikan terpasang (idempotent) saat connect.

```bash
curl -X GET "http://localhost:3000/api/bots/whatsapp/connect?number=6281234567890" \
  -H "Authorization: Bearer <token>"
```

Query `number` opsional. Bila instance sudah terhubung (`state: "open"`), QR tidak dikembalikan.

```json
{
  "success": true,
  "message": "QR WhatsApp berhasil dibuat, silakan scan",
  "data": {
    "userId": "uuid",
    "instance": "tenant-<uuid-tanpa-dash>",
    "state": "connecting",
    "connected": false,
    "base64": "data:image/png;base64,...",
    "code": "2@...",
    "pairingCode": null,
    "count": 1,
    "webhook": {
      "success": true,
      "action": "unchanged",
      "webhookUrl": "https://app.example.com/api/webhook/whatsapp/uuid"
    }
  }
}
```

Kode error: `instance_missing` (404 — panggil create instance dulu), `invalid_number` (400), `connect_failed` (502/503).

### POST /api/bots/whatsapp/restart

Restart instance Evolution, paksa set ulang webhook ke `PUBLIC_BASE_URL`, lalu kembalikan status terbaru. Gunakan bila instance bermasalah, QR tidak muncul, atau webhook perlu disinkronkan ulang. `POST /api/bots/whatsapp/reconnect` tetap tersedia sebagai alias endpoint ini.

```bash
curl -X POST http://localhost:3000/api/bots/whatsapp/restart \
  -H "Authorization: Bearer <token>"
```

Response berisi `restarted`, `restartError`, `webhookUrl`, `webhook` (dengan `action: "updated"`), dan objek `status` (bentuk sama dengan GET status).

`success` hanya `true` bila restart **dan** sinkronisasi webhook sama-sama berhasil. Kode error: `restart_failed` (Evolution menolak restart — HTTP 502, atau 503 bila timeout/unreachable), `webhook_failed` (restart jalan tapi webhook tidak terpasang), `instance_missing` (404, instance belum dibuat), `not_configured` (400).

#### Perintah bot WhatsApp

Bot hanya membaca pesan teks. Menu produk ditampilkan sebagai daftar bernomor; nomor atau nama produk yang diketik dipilih langsung.

| Perintah | Alternatif tanpa slash | Catatan |
|---|---|---|
| `/start` | `start`, `mulai` | Greeting + menu; di-dedup 24 jam per chat (`welcome_sent:{userId}:{chatId}`) agar link click-to-chat tidak mengirim menu berulang |
| `/menu` | `menu` | Membatalkan order berjalan lalu menampilkan menu |
| `/pesan` | `pesan`, `order` | Mulai order baru |
| `/batal` | `batal`, `cancel` | Batalkan order berjalan |
| `/status` | `status` | Status order berjalan |
| `/help` | `help`, `bantuan` | Daftar perintah |
| `/konfirmasi` (atau `/confirm`) | — | **Wajib slash.** Membuat order + link pembayaran Midtrans |
| `/reset` | — | **Wajib slash.** Hapus riwayat percakapan |

Perintah yang menyentuh uang atau menghapus sesi sengaja tidak menerima bentuk kata biasa, supaya kalimat seperti "bayar nanti" atau "reset dulu" tidak memicu aksi. Nomor 1–99 untuk memilih produk/jumlah tetap diproses sesuai state sesi.

Saat `/konfirmasi`, harga & ketersediaan produk dibaca ulang dari database; bila berubah sejak ringkasan, pelanggan diberi tahu total barunya. Kalau Midtrans gagal setelah order tersimpan, order ditandai `PAYMENT_FAILED` dan sesi di-reset supaya retry tidak menghasilkan order duplikat.

Jika pesan masuk memakai JID `@lid`, backend memetakan ke nomor telepon; bila tidak bisa dipetakan, order tetap dibuat dengan `whatsappId` berupa `@lid` dan tanpa `customerPhone` (notifikasi ke nomor itu bisa gagal di Evolution < 2.3.x).

Webhook WhatsApp: `POST /api/webhook/whatsapp/:userId` (tanpa JWT, wajib header `x-evolution-webhook-secret`). Hanya event `messages.upsert` yang diproses.

Jika `key.remoteJid` berakhiran `@lid`, backend memetakan ke nomor telepon lewat `key.remoteJidAlt`/`key.senderPn`/`key.participantAlt` (tersedia di Evolution >= 2.3.x). Untuk Evolution 2.2.x yang belum mengirim field tersebut, backend memakai fallback kontak dengan `profilePicUrl` identik dan kandidat tunggal; balasan selalu dikirim ke JID telepon bila pemetaan berhasil. Pemetaan di-cache di Redis (`whatsapp_lid:{userId}:{lid}`).

---

## Public API (No Auth)

Public endpoints untuk web catalog & checkout. Tidak memerlukan JWT token. Semua endpoint dilindungi rate limit (30 req/min per IP).

### GET /api/public/profile/:userId

Profil toko untuk halaman public. Digunakan untuk menampilkan nama toko (e.g. "Selamat datang di toko [name]").

```bash
curl http://localhost:3000/api/public/profile/0a1b2c3d-...
```

Response:

```json
{
  "success": true,
  "message": "Get user profile success",
  "data": {
    "name": "Toko Sejahtera"
  }
}
```

---

### GET /api/public/products/:userId

Daftar produk yang tersedia (hanya produk dengan `isAvailable = true`).

```bash
curl http://localhost:3000/api/public/products/0a1b2c3d-...
```

Response:

```json
{
  "success": true,
  "message": "Get products success",
  "data": [
    {
      "id": "uuid",
      "name": "Converse Chuck 70",
      "description": "Sepatu canvas klasik high-top",
      "price": 450000,
      "emoji": "👟",
      "isAvailable": true,
      "createdAt": "2026-06-07T10:30:00.000Z"
    },
    {
      "id": "uuid",
      "name": "Nike Air Force 1",
      "description": "Sepatu sneakers ikonik",
      "price": 750000,
      "emoji": "👟",
      "isAvailable": true,
      "createdAt": "2026-06-07T10:30:00.000Z"
    }
  ]
}
```

---

### GET /api/public/products/:userId/:productId

Detail satu produk.

```bash
curl http://localhost:3000/api/public/products/0a1b2c3d.../uuid-product
```

Response:

```json
{
  "success": true,
  "message": "Get product success",
  "data": {
    "id": "uuid",
    "name": "Converse Chuck 70",
    "description": "Sepatu canvas klasik high-top",
    "price": 450000,
    "emoji": "👟",
    "isAvailable": true,
    "createdAt": "2026-06-07T10:30:00.000Z"
  }
}
```

---

### POST /api/public/orders

Membuat order baru dari website. Menghasilkan payment URL Midtrans Snap untuk redirect pembayaran.

```bash
curl -X POST http://localhost:3000/api/public/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "0a1b2c3d-...",
    "productId": "uuid-product",
    "quantity": 2,
    "customerName": "Budi Santoso",
    "customerPhone": "08123456789"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | string | yes | ID tenant (pemilik toko) |
| `productId` | string | yes | ID produk yang dibeli |
| `quantity` | number | yes | Jumlah (1-99) |
| `customerName` | string | yes | Nama pembeli |
| `customerPhone` | string | no | Nomor HP pembeli |

Response (201):

```json
{
  "success": true,
  "message": "Order created successfully",
  "data": {
    "orderId": "INV-20240601-001",
    "paymentUrl": "https://app.sandbox.midtrans.com/snap/v2/redirection/snap-token",
    "snapToken": "snap-token-xyz",
    "totalPrice": 900000
  }
}
```

Frontend harus me-redirect user ke `paymentUrl` (Midtrans Snap) setelah order berhasil dibuat.

---

### GET /api/public/orders/:orderId

Cek status order setelah pembayaran. Berguna untuk halaman redirect/sukses di frontend setelah user selesai bayar di Midtrans.

```bash
curl http://localhost:3000/api/public/orders/INV-20240601-001
```

Response:

```json
{
  "success": true,
  "message": "Get order status success",
  "data": {
    "orderId": "INV-20240601-001",
    "source": "WEBSITE",
    "status": "PAYMENT_PENDING",
    "totalPrice": 900000,
    "paymentUrl": "https://app.sandbox.midtrans.com/snap/v2/redirection/snap-token",
    "customerName": "Budi Santoso",
    "customerPhone": "08123456789",
    "paidAt": null,
    "createdAt": "2026-06-07T10:30:00.000Z"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `orderId` | string | Nomor invoice |
| `source` | string | `"WEBSITE"` untuk order dari web |
| `status` | string | Status payment (lihat referensi di bawah) |
| `totalPrice` | number | Total harga dalam rupiah |
| `paymentUrl` | string? | URL pembayaran Midtrans Snap |
| `customerName` | string? | Nama pembeli |
| `customerPhone` | string? | Nomor HP pembeli |
| `paidAt` | string (ISO) | Waktu pembayaran (null jika belum bayar) |
| `createdAt` | string (ISO) | Waktu order dibuat |

### POST /api/public/orders/:orderId/verify

Verifikasi pembayaran langsung ke Midtrans API. Panggil endpoint ini dari frontend **setelah user selesai redirect** dari Snap (saat halaman sukses/gagal dimuat). Endpoint ini mengecek status transaksi ke Midtrans dan mengupdate status order di database.

```bash
curl -X POST http://localhost:3000/api/public/orders/INV-20240601-001
```

Response (pembayaran berhasil):

```json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "status": "COMPLETED"
  }
}
```

Response (pembayaran masih pending):

```json
{
  "success": true,
  "message": "Payment still pending",
  "data": {
    "status": "PAYMENT_PENDING"
  }
}
```

**Saran implementasi frontend:** Panggil endpoint ini di halaman redirect/sukses setelah Snap. Jika status `COMPLETED`, tampilkan halaman sukses. Jika masih `PAYMENT_PENDING`, polling setiap 3 detik sampai status berubah atau timeout 30 detik.

---



## Health

### GET /api/health

```bash
curl http://localhost:3000/api/health
```

Response:

```json
{
  "status": "ok",
  "redis": "ok",
  "db": "ok"
}
```

---

## Order Status Reference

| Status | Description |
|---|---|
| `PENDING` | Menunggu pembayaran |
| `PAYMENT_PENDING` | Pembayaran diverifikasi |
| `CONFIRMED` | Dikonfirmasi |
| `PROCESSING` | Diproses |
| `COMPLETED` | Selesai |
| `CANCELLED` | Dibatalkan |
| `PAYMENT_FAILED` | Pembayaran gagal |

## User Plan Reference

| Plan | Description |
|---|---|
| `FREE` | Gratis |
| `STARTER` | Starter |
| `PRO` | Pro |

## Batasan yang Diketahui

| Area | Batasan | Perilaku backend |
|---|---|---|
| Broadcast WhatsApp/email | Belum diimplementasikan | `POST /api/broadcasts`, `POST /api/broadcasts/from-template`, `PATCH /api/broadcasts/:id` (bila mengirim `channel`), dan `POST /api/broadcasts/:id/send` menolak dengan HTTP 400 `code: "channel_not_supported"`. Hanya `TELEGRAM` yang didukung. |
| Stok vs pembayaran | Pesanan dibuat sebelum pembayaran selesai | `validateStock` dicek saat konfirmasi, tapi stok tetap bisa oversold bila ada pemesanan paralel sebelum salah satu lunas. Pengurangan stok final terjadi pada webhook pembayaran. |
| Pemetaan `@lid` | Butuh Evolution API >= 2.3.x | Pada Evolution 2.2.x, `key.remoteJidAlt` tidak dikirim. Backend mencoba fallback mencocokkan kontak lewat `pushName` + `profilePicUrl`; bila ambigu, order tetap memakai JID `@lid` dan nomor telepon tidak dapat dipulihkan. |
| Secret webhook WhatsApp | Harus diisi di produksi | Bila `EVOLUTION_WEBHOOK_SECRET` tidak di-set, secret diturunkan dari `ENCRYPTION_KEY`. Mengubah `ENCRYPTION_KEY` mengubah seluruh secret webhook tenant. |
| `ENCRYPTION_KEY` | Tidak boleh berubah setelah kredensial terenkripsi | Kredensial `bot_credentials` dienkripsi AES-256-GCM dengan key ini. Rotasi membuat kredensial lama tidak terbaca. |
| Skema database | Deploy pakai `prisma db push` | Tidak ada `prisma/migrations/`. Perubahan schema diterapkan saat container start, jadi migrasi manual/rollback tidak tersedia. |
| Instance WhatsApp per tenant | Maksimal satu | Nama instance selalu diturunkan backend dari `userId` (`tenant-<uuid>`); klien tidak bisa memilih nama instance. |
