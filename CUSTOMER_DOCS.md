# Customer Database API

Base URL: `https://your-domain.com/api`

Semua endpoint membutuhkan **Bearer Token** (JWT) di header `Authorization`.

---

## Daftar Customer

```
GET /api/customers
```

### Query Params

| Param | Type | Default | Description |
|---|---|---|---|
| `search` | string | — | Cari berdasarkan nama, username, email, atau phone |
| `source` | string | — | Filter source customer: `ORDER`, `MANUAL`, `IMPORT` |
| `orderSource` | string | — | Filter customer berdasarkan source order: `TELEGRAM`, `WEBSITE`, `API` |
| `hasTelegram` | string | — | `"true"` atau `"false"` |
| `hasWhatsapp` | string | — | `"true"` atau `"false"` |
| `hasEmail` | string | — | `"true"` atau `"false"` |
| `sortBy` | string | `createdAt` | `createdAt`, `lastOrderAt`, `totalSpent`, `totalOrders`, `name` |
| `sortDir` | string | `desc` | `asc` atau `desc` |
| `page` | number | `1` | Halaman |
| `limit` | number | `20` | Item per halaman |

### Contoh Request

```bash
curl -H "Authorization: Bearer <token>" \
  "https://your-domain.com/api/customers?search=budi&sortBy=totalSpent&page=1&limit=10"
```

### Contoh Response

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "uuid-customer-1",
      "name": "Budi Santoso",
      "username": "budisantoso",
      "email": "budi@gmail.com",
      "phone": "08123456789",
      "telegramId": "123456789",
      "hasTelegram": true,
      "hasWhatsapp": true,
      "hasEmail": true,
      "source": "ORDER",
      "totalOrders": 5,
      "totalSpent": 250000,
      "lastOrderAt": "2025-06-01T10:00:00.000Z",
      "createdAt": "2025-01-15T08:30:00.000Z"
    }
  ],
  "metadata": {
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

## Detail Customer

```
GET /api/customers/:customerId
```

### Contoh Request

```bash
curl -H "Authorization: Bearer <token>" \
  "https://your-domain.com/api/customers/uuid-customer-1"
```

### Contoh Response

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "uuid-customer-1",
    "userId": "uuid-user",
    "telegramId": "123456789",
    "email": "budi@gmail.com",
    "phone": "08123456789",
    "name": "Budi Santoso",
    "username": "budisantoso",
    "notes": "Customer VIP",
    "hasTelegram": true,
    "hasWhatsapp": true,
    "hasEmail": true,
    "firstOrderAt": "2025-01-15T08:30:00.000Z",
    "lastOrderAt": "2025-06-01T10:00:00.000Z",
    "totalOrders": 5,
    "totalSpent": 250000,
    "source": "ORDER",
    "createdAt": "2025-01-15T08:30:00.000Z",
    "updatedAt": "2025-06-01T10:00:00.000Z",
    "orders": [
      {
        "id": "uuid-order-1",
        "orderId": "INV-001",
        "source": "TELEGRAM",
        "status": "COMPLETED",
        "totalPrice": 50000,
        "paidAt": "2025-06-01T10:00:00.000Z",
        "createdAt": "2025-06-01T09:00:00.000Z",
        "orderItems": [
          {
            "id": "uuid-order-item-1",
            "quantity": 1,
            "unitPrice": 50000,
            "product": {
              "id": "uuid-product-1",
              "name": "Produk A",
              "emoji": "🚀"
            }
          }
        ]
      }
    ]
  }
}
```

---

## Buat Customer Manual

```
POST /api/customers
```

### Request Body

Minimal satu identifier (`telegramId`, `phone`, atau `email`) wajib diisi.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✗ | Nama customer |
| `telegramId` | string | ✗* | ID Telegram (angka) |
| `phone` | string | ✗* | Nomor HP |
| `email` | string | ✗* | Email |
| `username` | string | ✗ | Username Telegram |
| `notes` | string | ✗ | Catatan internal admin |
| `hasWhatsapp` | boolean | ✗ | Default: `true` jika `phone` diisi, `false` jika tidak |

### Contoh Request

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Budi Santoso",
    "phone": "08123456789",
    "email": "budi@gmail.com",
    "telegramId": "123456789",
    "username": "budisantoso",
    "notes": "Customer VIP, selalu perpanjang tiap bulan",
    "hasWhatsapp": true
  }' \
  "https://your-domain.com/api/customers"
```

### Contoh Response (201 Created)

```json
{
  "success": true,
  "message": "Customer created",
  "data": {
    "id": "uuid-customer-baru",
    "userId": "uuid-user",
    "telegramId": "123456789",
    "email": "budi@gmail.com",
    "phone": "08123456789",
    "name": "Budi Santoso",
    "username": "budisantoso",
    "notes": "Customer VIP, selalu perpanjang tiap bulan",
    "hasTelegram": true,
    "hasWhatsapp": true,
    "hasEmail": true,
    "source": "MANUAL",
    "firstOrderAt": null,
    "lastOrderAt": null,
    "totalOrders": 0,
    "totalSpent": 0,
    "createdAt": "2025-06-08T12:00:00.000Z",
    "updatedAt": "2025-06-08T12:00:00.000Z"
  }
}
```

### Error Duplikat (409)

```json
{
  "success": false,
  "message": "Customer dengan telegramId ini sudah terdaftar"
}
```

---

## Update Customer

```
PATCH /api/customers/:customerId
```

Semua field opsional — hanya field yang dikirim yang akan diupdate.

| Field | Type | Description |
|---|---|---|
| `name` | string | Koreksi nama |
| `username` | string | Username Telegram |
| `email` | string | Email (akan cek duplikat) |
| `phone` | string | Nomor HP (akan cek duplikat) |
| `notes` | string | Catatan internal |
| `hasWhatsapp` | boolean | Flag WA |
| `hasEmail` | boolean | Flag email |

### Contoh Request

```bash
curl -X PATCH -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "budi.baru@gmail.com",
    "notes": "Sudah pindah nomor WA",
    "hasWhatsapp": false
  }' \
  "https://your-domain.com/api/customers/uuid-customer-1"
```

### Contoh Response

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "uuid-customer-1",
    "userId": "uuid-user",
    "name": "Budi Santoso",
    "email": "budi.baru@gmail.com",
    "phone": "08123456789",
    "notes": "Sudah pindah nomor WA",
    "hasWhatsapp": false,
    "hasEmail": true
  }
}
```

### Error Not Found (404)

```json
{
  "success": false,
  "message": "Customer not found"
}
```

---

## Hapus Customer

```
DELETE /api/customers/:customerId
```

⚠️ Akan memutus relasi `customerId` di semua order yang terhubung (set ke `null`), lalu menghapus customer.

### Contoh Request

```bash
curl -X DELETE -H "Authorization: Bearer <token>" \
  "https://your-domain.com/api/customers/uuid-customer-1"
```

### Contoh Response

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "message": "Customer deleted"
  }
}
```

---

## Catatan Penting

1. **Auto Upsert**: Customer dibuat otomatis dari order yang berhasil bayar (`payment-success`). Idempotent — aman dipanggil berkali-kali.
2. **Channel Flags**: `hasTelegram`, `hasWhatsapp`, `hasEmail` dipakai untuk target blast ke depan.
3. **Source**: `ORDER` (dari order), `MANUAL` (dibuat admin via API), `IMPORT` (dari CSV — belum tersedia).
4. **Identifier**: Prioritas unik per tenant — `telegramId`, `email`, `phone` masing-masing unique dalam satu user.
