# Fulfillment Engine — API Documentation

> Base URL: `/api`  
> Auth: All endpoints require `Authorization: Bearer <jwt>` header (kecuali disebutkan).  
> Response format: semua response mengikuti struktur berikut:

```json
{
  "success": true|false,
  "message": "OK",
  "data": { ... }
}
```

Response pagination:

```json
{
  "success": true,
  "message": "OK",
  "data": [ ... ],
  "metadata": {
    "total": 100,
    "page": 1,
    "limit": 50,
    "totalPages": 2
  }
}
```

Error response:

```json
{
  "success": false,
  "message": "Product not found"
}
```

---

## Enums

### FulfillmentType

| Value | Keterangan |
|-------|------------|
| `STOCK_POOL` | Voucher/akun/serial key — stok disiapkan di muka |
| `SLOT_ASSIGN` | Netflix/Spotify sharing — slot akun induk |
| `API_EXTERNAL` | Pulsa/paket data/top-up game — via API supplier |
| `MANUAL` | Jasa custom / produk fisik — perlu proses admin |

### FulfillmentStatus

| Value | Keterangan |
|-------|------------|
| `PENDING` | Menunggu diproses |
| `PROCESSING` | Sedang diproses |
| `SUCCESS` | Berhasil dikirim ke customer |
| `FAILED` | Gagal setelah 3x retry |
| `SKIPPED` | Dilewati (tidak ada config aktif) |

### StockItemStatus

| Value | Keterangan |
|-------|------------|
| `AVAILABLE` | Stok tersedia |
| `USED` | Sudah dipakai untuk order |
| `RESERVED` | Sedang di-reserve |
| `EXPIRED` | Masa berlaku habis |

### SlotStatus

| Value | Keterangan |
|-------|------------|
| `ACTIVE` | Slot sedang dipakai customer |
| `AVAILABLE` | Slot kosong, bisa diassign |
| `EXPIRED` | Masa berlaku slot habis |

---

## 1. Fulfillment Config

Daftar konfigurasi fulfillment per produk. Setiap produk maksimal memiliki satu config.

### GET /products/:productId/fulfillment

Lihat config fulfillment suatu produk.

**Contoh:**

```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/fulfillment
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
    "productId": "550e8400-e29b-41d4-a716-446655440000",
    "type": "STOCK_POOL",
    "manualNote": null,
    "apiUrl": null,
    "apiMethod": "POST",
    "apiHeaders": null,
    "apiPayloadTemplate": null,
    "apiCredentials": null,
    "apiSuccessPath": null,
    "apiSuccessValue": null,
    "apiResultPath": null,
    "deliveryMessage": "Terima kasih! Berikut detail pesanan Anda:\n\n{{result}}\n\nSimpan baik-baik ya 🙏",
    "isActive": true,
    "createdAt": "2025-06-09T10:00:00.000Z",
    "updatedAt": "2025-06-09T10:00:00.000Z"
  }
}
```

**Response (404):**

```json
{
  "success": false,
  "message": "Config not found"
}
```

---

### POST /products/:productId/fulfillment

Buat atau update config fulfillment suatu produk (upsert).

**Contoh (STOCK_POOL):**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "STOCK_POOL",
    "deliveryMessage": "Terima kasih! Berikut kode voucher Anda:\n\n{{result}}\n\nSimpan baik-baik ya 🙏",
    "isActive": true
  }' \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/fulfillment
```

**Contoh (SLOT_ASSIGN):**

```json
{
  "type": "SLOT_ASSIGN",
  "deliveryMessage": "Akun Anda sudah siap:\n\n{{result}}\n\nJangan bagikan password ke siapa pun!",
  "isActive": true
}
```

**Contoh (API_EXTERNAL):**

```json
{
  "type": "API_EXTERNAL",
  "apiUrl": "https://api.supplier.com/topup",
  "apiMethod": "POST",
  "apiHeaders": {
    "X-API-Key": "sk-xxx",
    "Content-Type": "application/json"
  },
  "apiPayloadTemplate": "{\"phone\": \"{{customer_phone}}\", \"amount\": {{product_price}}, \"ref_id\": \"{{order_id}}\"}",
  "apiCredentials": "{\"api_key\": \"sk-xxx\", \"secret\": \"abc123\"}",
  "apiSuccessPath": "data.status",
  "apiSuccessValue": "success",
  "apiResultPath": "data.message",
  "deliveryMessage": "Top-up berhasil! {{result}}",
  "isActive": true
}
```

**Contoh (MANUAL):**

```json
{
  "type": "MANUAL",
  "manualNote": "Produk fisik — proses pengiriman via JNE. Update resi di admin panel.",
  "deliveryMessage": "Pesanan sedang diproses, kami akan mengirimkan resi pengiriman melalui chat.",
  "isActive": true
}
```

**Response (200/201):**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
    "productId": "550e8400-e29b-41d4-a716-446655440000",
    "type": "STOCK_POOL",
    "deliveryMessage": "Terima kasih! Berikut kode voucher Anda:\n\n{{result}}\n\nSimpan baik-baik ya 🙏",
    "isActive": true,
    "createdAt": "2025-06-09T10:00:00.000Z",
    "updatedAt": "2025-06-09T10:00:00.000Z"
  }
}
```

**Placeholder yang bisa digunakan di `deliveryMessage` dan `apiPayloadTemplate`:**

| Placeholder | Diganti dengan |
|-------------|----------------|
| `{{order_id}}` | Order ID (format: INV/xxx) |
| `{{product_name}}` | Nama produk |
| `{{result}}` | Hasil dari strategy (contoh: kode voucher, credentials akun) |
| `{{customer_phone}}` | Nomor telepon customer (untuk API_EXTERNAL) |
| `{{product_price}}` | Harga produk (untuk API_EXTERNAL) |

**Body fields:**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `type` | enum | ✅ | `STOCK_POOL`, `SLOT_ASSIGN`, `API_EXTERNAL`, atau `MANUAL` |
| `manualNote` | string | untuk `MANUAL` | Catatan untuk admin yang proses manual |
| `apiUrl` | string | untuk `API_EXTERNAL` | URL endpoint API supplier |
| `apiMethod` | string | opsional | `POST` (default), `GET`, `PUT` |
| `apiHeaders` | object | opsional | Header HTTP untuk request ke API supplier |
| `apiPayloadTemplate` | string | untuk `API_EXTERNAL` | JSON string template payload |
| `apiCredentials` | string | opsional | Credential API supplier (akan dienkripsi AES-256-GCM) |
| `apiSuccessPath` | string | untuk `API_EXTERNAL` | JSON path untuk cek sukses (contoh: `data.status`) |
| `apiSuccessValue` | string | untuk `API_EXTERNAL` | Nilai yang dianggap sukses (contoh: `success`) |
| `apiResultPath` | string | untuk `API_EXTERNAL` | JSON path untuk ambil hasil kirim ke customer |
| `deliveryMessage` | string | opsional | Template pesan ke customer |
| `isActive` | boolean | opsional | Default `true` |

---

### DELETE /products/:productId/fulfillment

Hapus config fulfillment suatu produk.

```bash
curl -X DELETE -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/fulfillment
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": { "deleted": true }
}
```

---

## 2. Stock Items (STOCK_POOL)

Manage stok untuk produk tipe `STOCK_POOL`.

### GET /products/:productId/stock-items

Daftar stok items (dengan filter status).

**Query params:**

| Param | Tipe | Keterangan |
|-------|------|------------|
| `status` | enum | Filter: `AVAILABLE`, `USED`, `RESERVED`, `EXPIRED` |
| `page` | number | Default `1` |
| `limit` | number | Default `50` |

```bash
curl -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/stock-items?status=AVAILABLE&page=1&limit=20"
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "a1b2c3d4-1111-2222-3333-444455556666",
      "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
      "productId": "550e8400-e29b-41d4-a716-446655440000",
      "content": "VOUCHER-A7X3K9M2",
      "status": "AVAILABLE",
      "usedAt": null,
      "orderId": null,
      "createdAt": "2025-06-09T10:00:00.000Z",
      "updatedAt": "2025-06-09T10:00:00.000Z"
    }
  ],
  "metadata": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

---

### POST /products/:productId/stock-items

Upload stock items — single atau bulk.

**Via array `items` (single/bulk):**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      "VOUCHER-A7X3K9M2",
      "VOUCHER-B4Y2L8N5",
      "VOUCHER-C1Z5M7P3"
    ]
  }' \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/stock-items
```

**Via `content` (newline-separated):**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "user:pass123\nuser2:pass456\nuser3:pass789"
  }' \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/stock-items
```

**Response (201):**

```json
{
  "success": true,
  "message": "OK",
  "data": { "created": 3 }
}
```

---

### DELETE /products/:productId/stock-items/:itemId

Hapus stock item (hanya yang berstatus `AVAILABLE`).

```bash
curl -X DELETE -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/stock-items/a1b2c3d4-1111-2222-3333-444455556666
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": { "deleted": true }
}
```

**Response (404):**

```json
{
  "success": false,
  "message": "Item not found or already used"
}
```

---

### GET /products/:productId/stock-items/count

Hitung jumlah stok tersedia.

```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/stock-items/count
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": { "available": 47 }
}
```

---

## 3. Slot Accounts & Slots (SLOT_ASSIGN)

### GET /products/:productId/slot-accounts

Daftar akun induk untuk produk tipe `SLOT_ASSIGN`.

```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/slot-accounts
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "f47ac10b-1111-2222-3333-444455556666",
      "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
      "productId": "550e8400-e29b-41d4-a716-446655440000",
      "label": "Netflix Premium 4K",
      "credentials": "(encrypted)",
      "totalSlots": 4,
      "usedSlots": 2,
      "isActive": true,
      "createdAt": "2025-06-09T10:00:00.000Z",
      "updatedAt": "2025-06-09T10:00:00.000Z",
      "_count": { "slots": 4 }
    }
  ]
}
```

---

### POST /products/:productId/slot-accounts

Tambah akun induk baru.

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Netflix Premium 4K",
    "credentials": {
      "email": "netflix@example.com",
      "password": "supersecret123"
    },
    "totalSlots": 4
  }' \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/slot-accounts
```

**Response (201):**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "f47ac10b-1111-2222-3333-444455556666",
    "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
    "productId": "550e8400-e29b-41d4-a716-446655440000",
    "label": "Netflix Premium 4K",
    "credentials": "(encrypted)",
    "totalSlots": 4,
    "usedSlots": 0,
    "isActive": true,
    "createdAt": "2025-06-09T10:00:00.000Z",
    "updatedAt": "2025-06-09T10:00:00.000Z"
  }
}
```

**Body fields:**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `label` | string | ✅ | Nama/label akun induk |
| `credentials` | object | ✅ | Object `{email, password}` — akan dienkripsi AES-256-GCM |
| `totalSlots` | number | ✅ | Jumlah total slot (misal: 4 profile Netflix) |

---

### PUT /products/:productId/slot-accounts/:accountId

Update akun induk (partial update).

```bash
curl -X PUT -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Netflix Premium 4K (Updated)",
    "totalSlots": 5,
    "isActive": false
  }' \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/slot-accounts/f47ac10b-1111-2222-3333-444455556666
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "f47ac10b-1111-2222-3333-444455556666",
    "label": "Netflix Premium 4K (Updated)",
    "totalSlots": 5,
    "isActive": false,
    "updatedAt": "2025-06-09T11:00:00.000Z"
  }
}
```

---

### DELETE /products/:productId/slot-accounts/:accountId

Hapus akun induk (cascade ke semua slot di dalamnya).

```bash
curl -X DELETE -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/slot-accounts/f47ac10b-1111-2222-3333-444455556666
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": { "deleted": true }
}
```

---

### GET /products/:productId/slot-accounts/:accountId/slots

Daftar slot dalam suatu akun induk.

```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/slot-accounts/f47ac10b-1111-2222-3333-444455556666/slots
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "b1b2c3d4-1111-2222-3333-444455556666",
      "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
      "slotAccountId": "f47ac10b-1111-2222-3333-444455556666",
      "productId": "550e8400-e29b-41d4-a716-446655440000",
      "slotIdentifier": "Profile 1",
      "additionalInfo": "PIN: 1234",
      "status": "AVAILABLE",
      "expiresAt": null,
      "assignedAt": null,
      "orderId": null,
      "createdAt": "2025-06-09T10:00:00.000Z",
      "updatedAt": "2025-06-09T10:00:00.000Z"
    }
  ]
}
```

---

### POST /products/:productId/slot-accounts/:accountId/slots

Tambah slot baru ke akun induk (bulk).

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "slots": [
      { "slotIdentifier": "Profile 1", "additionalInfo": "PIN: 1234" },
      { "slotIdentifier": "Profile 2", "additionalInfo": "PIN: 5678" },
      { "slotIdentifier": "Profile 3", "additionalInfo": "PIN: 9012" }
    ]
  }' \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/slot-accounts/f47ac10b-1111-2222-3333-444455556666/slots
```

**Response (201):**

```json
{
  "success": true,
  "message": "OK",
  "data": { "created": 3 }
}
```

**Body fields:**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `slots` | array | ✅ | Array of slot objects |
| `slots[].slotIdentifier` | string | ✅ | Identifier slot (contoh: "Profile 1", "Slot B") |
| `slots[].additionalInfo` | string | opsional | Info tambahan (PIN, instruksi, dll) |

---

### PATCH /products/:productId/slot-accounts/:accountId/slots/:slotId/release

Release slot yang sedang dipakai customer (misal: langganan habis, slot dikosongkan).

```bash
curl -X PATCH -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/products/550e8400-e29b-41d4-a716-446655440000/slot-accounts/f47ac10b-1111-2222-3333-444455556666/slots/b1b2c3d4-1111-2222-3333-444455556666/release
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": { "released": true }
}
```

> Proses: mengubah status slot jadi `AVAILABLE`, menghapus `assignedAt`/`orderId`, dan men-decrement `usedSlots` di akun induk.

---

## 4. Fulfillment Logs

Audit trail fulfillment per order.

### GET /fulfillment-logs

Daftar semua log fulfillment.

**Query params:**

| Param | Tipe | Keterangan |
|-------|------|------------|
| `status` | enum | Filter: `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED`, `SKIPPED` |
| `page` | number | Default `1` |
| `limit` | number | Default `50` |

```bash
curl -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/fulfillment-logs?status=FAILED&page=1&limit=10"
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "c1b2c3d4-1111-2222-3333-444455556666",
      "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
      "orderId": "550e8400-0000-0000-0000-000000000001",
      "productId": "550e8400-e29b-41d4-a716-446655440000",
      "type": "STOCK_POOL",
      "status": "SUCCESS",
      "attempts": 1,
      "maxAttempts": 3,
      "deliveredContent": "Terima kasih! Berikut kode voucher Anda:\n\nVOUCHER-A7X3K9M2\n\nSimpan baik-baik ya 🙏",
      "deliveredAt": "2025-06-09T10:05:00.000Z",
      "lastError": null,
      "lastAttemptAt": "2025-06-09T10:05:00.000Z",
      "metadata": { "stockItemId": "a1b2c3d4-1111-2222-3333-444455556666" },
      "createdAt": "2025-06-09T10:05:00.000Z",
      "updatedAt": "2025-06-09T10:05:00.000Z",
      "order": {
        "orderId": "INV/20250609/xxx",
        "totalPrice": 50000
      }
    }
  ],
  "metadata": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }
}
```

---

### GET /fulfillment-logs/:orderId

Detail log fulfillment satu order (berdasarkan `orderId` field — bukan UUID).

```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/fulfillment-logs/550e8400-0000-0000-0000-000000000001
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "c1b2c3d4-1111-2222-3333-444455556666",
    "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
    "orderId": "550e8400-0000-0000-0000-000000000001",
    "productId": "550e8400-e29b-41d4-a716-446655440000",
    "type": "STOCK_POOL",
    "status": "FAILED",
    "attempts": 3,
    "maxAttempts": 3,
    "deliveredContent": null,
    "deliveredAt": null,
    "lastError": "Insufficient stock: no available items",
    "lastAttemptAt": "2025-06-09T10:10:00.000Z",
    "metadata": null,
    "createdAt": "2025-06-09T10:05:00.000Z",
    "updatedAt": "2025-06-09T10:10:00.000Z"
  }
}
```

---

### POST /fulfillment-logs/:orderId/retry

Manual retry fulfillment untuk log yang berstatus `FAILED`.

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/fulfillment-logs/550e8400-0000-0000-0000-000000000001/retry
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": { "retried": true }
}
```

**Response (404):**

```json
{
  "success": false,
  "message": "Failed log not found"
}
```

---

## 5. Ticket Fulfillment Logs (Legacy / Orders)

Fulfillment log yang terikat ke ticket (bukan ke order). Ini adalah endpoint untuk mencatat aktivitas fulfillment di level ticket.

### POST /fulfillment/:ticketId/log

Buat log fulfillment untuk suatu ticket.

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "PAYMENT_COMPLETED",
    "description": "Pembayaran berhasil untuk order INV/20250609/xxx",
    "metadata": {
      "orderId": "INV/20250609/xxx",
      "totalPrice": 50000
    }
  }' \
  http://localhost:3000/api/fulfillment/a1b2c3d4-ticket-1234-5678-9abc-def012345678/log
```

**Body fields:**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `operation` | string | ✅ | Nama operasi (contoh: `PAYMENT_COMPLETED`, `ITEM_DELIVERED`) |
| `description` | string | ✅ | Deskripsi log |
| `metadata` | object | opsional | Data tambahan (JSON) |

**Response (201):**

```json
{
  "success": true,
  "message": "Fulfillment log created",
  "data": {
    "id": "d1b2c3d4-1111-2222-3333-444455556666",
    "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
    "ticketId": "a1b2c3d4-ticket-1234-5678-9abc-def012345678",
    "operation": "PAYMENT_COMPLETED",
    "description": "Pembayaran berhasil untuk order INV/20250609/xxx",
    "metadata": { "orderId": "INV/20250609/xxx", "totalPrice": 50000 },
    "performedById": "a1b2c3d4-1234-5678-9abc-def012345678",
    "createdAt": "2025-06-09T10:05:00.000Z"
  }
}
```

---

### GET /fulfillment/:ticketId/logs

Daftar log fulfillment untuk suatu ticket (dengan pagination).

**Query params:**

| Param | Tipe | Keterangan |
|-------|------|------------|
| `page` | number | Default `1` |
| `limit` | number | Default `50` |

```bash
curl -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/fulfillment/a1b2c3d4-ticket-1234-5678-9abc-def012345678/logs"
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "d1b2c3d4-1111-2222-3333-444455556666",
      "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
      "ticketId": "a1b2c3d4-ticket-1234-5678-9abc-def012345678",
      "operation": "PAYMENT_COMPLETED",
      "description": "Pembayaran berhasil untuk order INV/20250609/xxx",
      "metadata": { "orderId": "INV/20250609/xxx", "totalPrice": 50000 },
      "performedById": "a1b2c3d4-1234-5678-9abc-def012345678",
      "createdAt": "2025-06-09T10:05:00.000Z"
    }
  ],
  "metadata": { "total": 1, "page": 1, "limit": 50, "totalPages": 1 }
}
```

---

## Summary Endpoints

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/products/:productId/fulfillment` | Lihat config fulfillment produk |
| `POST` | `/products/:productId/fulfillment` | Buat/update config fulfillment |
| `DELETE` | `/products/:productId/fulfillment` | Hapus config fulfillment |
| `GET` | `/products/:productId/stock-items` | Daftar stock items |
| `POST` | `/products/:productId/stock-items` | Upload stock items |
| `GET` | `/products/:productId/stock-items/count` | Hitung stok tersedia |
| `DELETE` | `/products/:productId/stock-items/:itemId` | Hapus stock item |
| `GET` | `/products/:productId/slot-accounts` | Daftar akun induk slot |
| `POST` | `/products/:productId/slot-accounts` | Tambah akun induk slot |
| `PUT` | `/products/:productId/slot-accounts/:accountId` | Update akun induk slot |
| `DELETE` | `/products/:productId/slot-accounts/:accountId` | Hapus akun induk slot |
| `GET` | `/products/:productId/slot-accounts/:accountId/slots` | Daftar slot |
| `POST` | `/products/:productId/slot-accounts/:accountId/slots` | Tambah slot (bulk) |
| `PATCH` | `/products/:productId/slot-accounts/:accountId/slots/:slotId/release` | Release slot |
| `GET` | `/fulfillment-logs` | Daftar log fulfillment |
| `GET` | `/fulfillment-logs/:orderId` | Detail log fulfillment |
| `POST` | `/fulfillment-logs/:orderId/retry` | Retry fulfillment FAILED |
| `POST` | `/fulfillment/:ticketId/log` | Buat log fulfillment ticket |
| `GET` | `/fulfillment/:ticketId/logs` | Daftar log fulfillment ticket |
