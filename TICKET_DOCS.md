# Ticketing API Documentation

Base URL: `http://localhost:3000/api`

Semua endpoint ticketing memerlukan JWT Bearer token.

```
Authorization: Bearer <token>
```

---

## Tickets

### GET /api/tickets

List ticket dengan filter. Mendukung pagination.

```bash
curl -X GET http://localhost:3000/api/tickets \
  -H "Authorization: Bearer <token>"
```

**Query Parameters (opsional):**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status: `OPEN`, `IN_PROGRESS`, `WAITING_CUSTOMER`, `RESOLVED`, `CLOSED`, `CANCELLED` |
| `priority` | string | Filter by priority: `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `labelId` | string | Filter by label UUID |
| `search` | string | Cari berdasarkan `title`, `customerName`, atau `id` |
| `page` | number | Halaman (default: 1) |
| `limit` | number | Item per halaman (default: 20) |

Response:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "tickets": [
      {
        "id": "uuid-ticket",
        "userId": "uuid-user",
        "orderId": "uuid-order",
        "title": "Order ORD-20260607-1234",
        "description": "Order ID: ORD-20260607-1234\nSource: WEBSITE\nTotal: Rp 150.000\nPhone: 08123456789",
        "status": "OPEN",
        "priority": "MEDIUM",
        "source": "ORDER",
        "customerName": "Budi Santoso",
        "customerContact": "08123456789",
        "resolvedAt": null,
        "closedAt": null,
        "createdAt": "2026-06-07T10:30:00.000Z",
        "updatedAt": "2026-06-07T10:30:00.000Z",
        "labels": [
          {
            "ticketId": "uuid-ticket",
            "labelId": "uuid-label",
            "label": {
              "id": "uuid-label",
              "userId": "uuid-user",
              "name": "Urgent",
              "color": "#EF4444",
              "createdAt": "2026-06-07T10:00:00.000Z"
            }
          }
        ],
        "order": {
          "id": "uuid-order",
          "totalPrice": 150000,
          "status": "COMPLETED"
        },
        "_count": {
          "comments": 2
        }
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### GET /api/tickets/:ticketId

Detail ticket lengkap dengan komentar, aktivitas, dan data order.

```bash
curl -X GET http://localhost:3000/api/tickets/uuid-ticket \
  -H "Authorization: Bearer <token>"
```

Response:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "uuid-ticket",
    "userId": "uuid-user",
    "orderId": "uuid-order",
    "title": "Order ORD-20260607-1234",
    "description": "Order ID: ORD-20260607-1234\nSource: WEBSITE\nTotal: Rp 150.000",
    "status": "IN_PROGRESS",
    "priority": "HIGH",
    "source": "ORDER",
    "customerName": "Budi Santoso",
    "customerContact": "08123456789",
    "resolvedAt": null,
    "closedAt": null,
    "createdAt": "2026-06-07T10:30:00.000Z",
    "updatedAt": "2026-06-07T11:00:00.000Z",
    "labels": [
      {
        "ticketId": "uuid-ticket",
        "labelId": "uuid-label",
        "label": {
          "id": "uuid-label",
          "userId": "uuid-user",
          "name": "Pembayaran",
          "color": "#10B981",
          "createdAt": "2026-06-07T10:00:00.000Z"
        }
      }
    ],
    "comments": [
      {
        "id": "uuid-comment",
        "ticketId": "uuid-ticket",
        "userId": "uuid-user",
        "body": "Sedang mengecek pembayaran...",
        "isInternal": false,
        "createdAt": "2026-06-07T10:45:00.000Z",
        "updatedAt": "2026-06-07T10:45:00.000Z",
        "user": {
          "id": "uuid-user",
          "name": "Admin Toko"
        }
      }
    ],
    "activities": [
      {
        "id": "uuid-activity",
        "ticketId": "uuid-ticket",
        "userId": null,
        "action": "ticket_created",
        "metadata": {
          "source": "ORDER",
          "orderId": "ORD-20260607-1234"
        },
        "createdAt": "2026-06-07T10:30:00.000Z"
      },
      {
        "id": "uuid-activity",
        "ticketId": "uuid-ticket",
        "userId": "uuid-user",
        "action": "status_changed",
        "metadata": {
          "from": "OPEN",
          "to": "IN_PROGRESS"
        },
        "createdAt": "2026-06-07T11:00:00.000Z"
      }
    ],
    "order": {
      "id": "uuid-order",
      "userId": "uuid-user",
      "orderId": "ORD-20260607-1234",
      "source": "WEBSITE",
      "telegramId": null,
      "username": null,
      "firstName": null,
      "customerName": "Budi Santoso",
      "customerPhone": "08123456789",
      "totalPrice": 150000,
      "status": "COMPLETED",
      "paymentUrl": "https://app.sandbox.midtrans.com/snap/v4/redirection/...",
      "midtransOrderId": "ORD-20260607-1234",
      "paidAt": "2026-06-07T10:35:00.000Z",
      "createdAt": "2026-06-07T10:30:00.000Z",
      "updatedAt": "2026-06-07T10:35:00.000Z",
      "orderItems": [
        {
          "id": "uuid-order-item",
          "orderId": "uuid-order",
          "productId": "uuid-product",
          "quantity": 2,
          "unitPrice": 75000,
          "product": {
            "id": "uuid-product",
            "name": "Converse Chuck 70",
            "price": 75000,
            "emoji": "👟"
          }
        }
      ]
    }
  }
}
```

---

### PATCH /api/tickets/:ticketId/status

Ubah status ticket. Mencatat otomatis di activity log.

```bash
curl -X PATCH http://localhost:3000/api/tickets/uuid-ticket/status \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "IN_PROGRESS"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | yes | `OPEN`, `IN_PROGRESS`, `WAITING_CUSTOMER`, `RESOLVED`, `CLOSED`, `CANCELLED` |

Response:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "uuid-ticket",
    "status": "IN_PROGRESS",
    "priority": "MEDIUM",
    "resolvedAt": null,
    "closedAt": null,
    "updatedAt": "2026-06-07T11:00:00.000Z"
  }
}
```

> **Catatan:** Saat status diubah ke `RESOLVED`, field `resolvedAt` akan terisi otomatis. Saat `CLOSED`, field `closedAt` akan terisi.

---

### PATCH /api/tickets/:ticketId/priority

Ubah prioritas ticket.

```bash
curl -X PATCH http://localhost:3000/api/tickets/uuid-ticket/priority \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": "HIGH"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `priority` | string | yes | `LOW`, `MEDIUM`, `HIGH`, `URGENT` |

Response:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "uuid-ticket",
    "status": "OPEN",
    "priority": "HIGH",
    "updatedAt": "2026-06-07T11:05:00.000Z"
  }
}
```

---

### POST /api/tickets/:ticketId/labels

Attach label ke ticket.

```bash
curl -X POST http://localhost:3000/api/tickets/uuid-ticket/labels \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "labelId": "uuid-label"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `labelId` | string | yes | UUID label yang sudah dibuat |

Response:

```json
{
  "success": true,
  "message": "Label attached",
  "data": {
    "message": "Label attached"
  }
}
```

---

### DELETE /api/tickets/:ticketId/labels/:labelId

Detach label dari ticket.

```bash
curl -X DELETE http://localhost:3000/api/tickets/uuid-ticket/labels/uuid-label \
  -H "Authorization: Bearer <token>"
```

Response:

```json
{
  "success": true,
  "message": "Label detached",
  "data": {
    "message": "Label detached"
  }
}
```

---

### POST /api/tickets/:ticketId/comments

Tambah komentar ke ticket.

```bash
curl -X POST http://localhost:3000/api/tickets/uuid-ticket/comments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Pesanan sedang diproses, estimasi 2x24 jam",
    "isInternal": false
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `body` | string | yes | Isi komentar |
| `isInternal` | boolean | no | `true` = catatan internal (tidak dikirim ke customer). Default: `false` |

Response (201):

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "id": "uuid-comment",
    "ticketId": "uuid-ticket",
    "userId": "uuid-user",
    "body": "Pesanan sedang diproses, estimasi 2x24 jam",
    "isInternal": false,
    "createdAt": "2026-06-07T11:10:00.000Z",
    "updatedAt": "2026-06-07T11:10:00.000Z",
    "user": {
      "id": "uuid-user",
      "name": "Admin Toko"
    }
  }
}
```

---

### PUT /api/tickets/:ticketId/comments/:commentId

Edit komentar yang sudah ada. Hanya komentar milik sendiri yang bisa diedit.

```bash
curl -X PUT http://localhost:3000/api/tickets/uuid-ticket/comments/uuid-comment \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "Pesanan sedang diproses, estimasi 1x24 jam (diperbarui)"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `body` | string | yes | Isi komentar baru |

Response:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "uuid-comment",
    "ticketId": "uuid-ticket",
    "userId": "uuid-user",
    "body": "Pesanan sedang diproses, estimasi 1x24 jam (diperbarui)",
    "isInternal": false,
    "createdAt": "2026-06-07T11:10:00.000Z",
    "updatedAt": "2026-06-07T11:15:00.000Z",
    "user": {
      "id": "uuid-user",
      "name": "Admin Toko"
    }
  }
}
```

---

### DELETE /api/tickets/:ticketId/comments/:commentId

Hapus komentar. Hanya komentar milik sendiri yang bisa dihapus.

```bash
curl -X DELETE http://localhost:3000/api/tickets/uuid-ticket/comments/uuid-comment \
  -H "Authorization: Bearer <token>"
```

Response:

```json
{
  "success": true,
  "message": "Comment deleted",
  "data": {
    "message": "Comment deleted"
  }
}
```

---

## Labels

### GET /api/labels

Daftar semua label milik tenant, termasuk jumlah ticket yang menggunakan label tersebut.

```bash
curl -X GET http://localhost:3000/api/labels \
  -H "Authorization: Bearer <token>"
```

Response:

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "uuid-label",
      "userId": "uuid-user",
      "name": "Pembayaran",
      "color": "#10B981",
      "createdAt": "2026-06-07T10:00:00.000Z",
      "_count": {
        "tickets": 3
      }
    },
    {
      "id": "uuid-label",
      "userId": "uuid-user",
      "name": "Urgent",
      "color": "#EF4444",
      "createdAt": "2026-06-07T09:00:00.000Z",
      "_count": {
        "tickets": 1
      }
    }
  ]
}
```

---

### POST /api/labels

Buat label baru.

```bash
curl -X POST http://localhost:3000/api/labels \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pembayaran",
    "color": "#10B981"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Nama label (unique per tenant, max 50 karakter) |
| `color` | string | no | Hex color code. Default: `#3B82F6` |

Response (201):

```json
{
  "success": true,
  "message": "Created",
  "data": {
    "id": "uuid-label",
    "userId": "uuid-user",
    "name": "Pembayaran",
    "color": "#10B981",
    "createdAt": "2026-06-07T12:00:00.000Z"
  }
}
```

---

### PUT /api/labels/:labelId

Update label (nama dan/atau warna).

```bash
curl -X PUT http://localhost:3000/api/labels/uuid-label \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pembayaran - Selesai",
    "color": "#3B82F6"
  }'
```

**Request Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | no | Nama baru label |
| `color` | string | no | Warna baru (hex) |

Response:

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "uuid-label",
    "userId": "uuid-user",
    "name": "Pembayaran - Selesai",
    "color": "#3B82F6",
    "createdAt": "2026-06-07T10:00:00.000Z"
  }
}
```

---

### DELETE /api/labels/:labelId

Hapus label. Relasi ke ticket akan otomatis terhapus (cascade).

```bash
curl -X DELETE http://localhost:3000/api/labels/uuid-label \
  -H "Authorization: Bearer <token>"
```

Response:

```json
{
  "success": true,
  "message": "Label deleted",
  "data": {
    "message": "Label deleted"
  }
}
```

---

## Status & Priority Reference

### Ticket Status

| Status | Description |
|---|---|
| `OPEN` | Ticket baru, belum ada yang handle |
| `IN_PROGRESS` | Sedang dikerjakan admin |
| `WAITING_CUSTOMER` | Menunggu respons dari customer |
| `RESOLVED` | Selesai dikerjakan, menunggu konfirmasi customer |
| `CLOSED` | Final — selesai atau ditutup |
| `CANCELLED` | Dibatalkan sebelum diproses |

### Ticket Priority

| Priority | Description |
|---|---|
| `LOW` | Prioritas rendah |
| `MEDIUM` | Prioritas normal (default) |
| `HIGH` | Prioritas tinggi |
| `URGENT` | Sangat urgent |

### Ticket Source

| Source | Description |
|---|---|
| `ORDER` | Otomatis dari order yang sudah dibayar |
| `MANUAL` | Dibuat manual oleh admin (via API) |

---

## Auto-Create Ticket

Saat payment berhasil (Midtrans webhook `payment-success`), sistem **otomatis membuat ticket** dengan:

- `title`: `"Order ORD-YYYYMMDD-NNNN"`
- `status`: `OPEN`
- `priority`: `MEDIUM`
- `source`: `ORDER`
- `customerName`: dari order
- `customerContact`: `telegramId` (Telegram order) atau `customerPhone` (website order)
- `description`: detail order (ID, source, total, kontak)

Ticket tidak akan terbuat duplikat — idempotent berdasarkan `orderId`.
