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
    "revenueChange": {
      "percentage": 15.3,
      "trend": "up"
    },
    "recentOrders": [
      {
        "id": "uuid-1",
        "orderId": "INV-20240601-001",
        "firstName": "Budi",
        "username": "@budi123",
        "status": "COMPLETED",
        "totalPrice": 150000,
        "createdAt": "2026-06-07T10:30:00.000Z"
      },
      {
        "id": "uuid-2",
        "orderId": "INV-20240601-002",
        "firstName": "Siti",
        "username": "@siti456",
        "status": "PENDING",
        "totalPrice": 75000,
        "createdAt": "2026-06-07T09:15:00.000Z"
      }
    ]
  }
}
```

#### Field Reference

| Field | Type | Description |
|---|---|---|
| `activeProducts` | number | Jumlah produk dengan `isAvailable = true` |
| `totalOrders` | number | Total seluruh order (semua status) |
| `pendingOrders` | number | Order dengan status `PENDING` + `PAYMENT_PENDING` |
| `totalRevenue` | number | Total pendapatan dari order `COMPLETED` bulan ini |
| `revenueChange.percentage` | number | Persentase perubahan revenue vs bulan lalu |
| `revenueChange.trend` | string | `"up"` (>1%), `"down"` (<-1%), atau `"stable"` |
| `recentOrders` | array | 5 order terbaru |

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
