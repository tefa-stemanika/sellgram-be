# Subscription & Billing API

Dokumentasi endpoint manajemen subscription dan billing untuk admin dashboard panel.

---

## Base URL

```
/api/subscription
/api/invoices
```

Semua endpoint **wajib JWT auth** (`requireAuth` middleware) dan multi-tenant per `userId`.

---

## Subscription

### GET /api/subscription

Dapatkan status subscription aktif + plan limits.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "plan": "STARTER",
    "subscription": {
      "id": "uuid",
      "plan": "STARTER",
      "status": "ACTIVE",
      "interval": "MONTHLY",
      "currentPeriodStart": "2025-06-01T00:00:00.000Z",
      "currentPeriodEnd": "2025-07-01T00:00:00.000Z",
      "gracePeriodEnd": "2025-07-04T00:00:00.000Z",
      "cancelledAt": null,
      "cancelReason": null
    },
    "limits": {
      "botConfigs": 3,
      "products": 50,
      "canBroadcast": true,
      "canUseFulfillment": true
    }
  }
}
```

**Notes:**
- `subscription` = `null` jika user FREE (belum pernah subscribe).
- `limits` mengikuti `plan` saat ini.

---

### POST /api/subscription/upgrade

Buat invoice + Midtrans Snap transaction untuk upgrade plan.

**Request Body:**

```json
{
  "plan": "STARTER",
  "interval": "MONTHLY"
}
```

| Field      | Type   | Required | Default   | Valid Values               |
| ---------- | ------ | -------- | --------- | -------------------------- |
| `plan`     | string | Yes      | —         | `STARTER`, `PRO`           |
| `interval` | string | No       | `MONTHLY` | `MONTHLY`, `YEARLY`        |

**Response 200:**

```json
{
  "success": true,
  "message": "Invoice berhasil dibuat. Silakan lakukan pembayaran.",
  "data": {
    "invoice": {
      "id": "uuid",
      "invoiceNumber": "INV-20250614-0001",
      "amount": 99000,
      "plan": "STARTER",
      "interval": "MONTHLY",
      "periodStart": "2025-06-14T00:00:00.000Z",
      "periodEnd": "2025-07-14T00:00:00.000Z"
    },
    "paymentUrl": "https://app.midtrans.com/snap/v2/..."
  }
}
```

**Errors:**

| Status | Code                       | Description                         |
| ------ | -------------------------- | ----------------------------------- |
| 400    | —                          | Plan/interval tidak valid           |
| 400    | —                          | User sudah di plan yg sama/lebih    |
| 500    | —                          | Midtrans server key belum dikonfig  |

**Notes:**
- `midtransOrderId` = `SUB-{invoiceNumber}` (prefix berbeda dari order produk).
- Menggunakan `PLATFORM_MIDTRANS_SERVER_KEY` dari env (key platform, bukan key tenant).
- Invoice expired dalam 24 jam.

---

### POST /api/subscription/cancel

Batalkan subscription. Akses tetap aktif sampai `currentPeriodEnd`.

**Request Body:**

```json
{
  "reason": "Tidak butuh lagi"
}
```

| Field    | Type   | Required | Description      |
| -------- | ------ | -------- | ---------------- |
| `reason` | string | No       | Alasan pembatalan |

**Response 200:**

```json
{
  "success": true,
 "message": "Subscription dibatalkan. Akses tetap aktif sampai periode berakhir.",
  "data": {
    "cancelled": true
  }
}
```

**Errors:**

| Status | Description                               |
| ------ | ----------------------------------------- |
| 404    | Tidak ada subscription aktif              |
| 400    | Subscription tidak dalam status ACTIVE    |

---

## Invoices

### GET /api/invoices

Daftar invoice dengan pagination.

**Query Parameters:**

| Param    | Type   | Default | Description                         |
| -------- | ------ | ------- | ----------------------------------- |
| `page`   | number | 1       | Halaman                             |
| `limit`  | number | 20      | Item per halaman                    |
| `status` | string | —       | Filter: `PENDING`, `PAID`, `EXPIRED`|

**Response 200:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "invoiceNumber": "INV-20250614-0001",
      "plan": "STARTER",
      "interval": "MONTHLY",
      "amount": 99000,
      "status": "PAID",
      "paymentUrl": "https://...",
      "paidAt": "2025-06-14T10:00:00.000Z",
      "paymentMethod": "qris",
      "periodStart": "2025-06-14T00:00:00.000Z",
      "periodEnd": "2025-07-14T00:00:00.000Z",
      "expiredAt": "2025-06-15T00:00:00.000Z",
      "createdAt": "2025-06-14T09:00:00.000Z"
    }
  ],
  "metadata": {
    "total": 25,
    "page": 1,
    "limit": 20,
    "totalPages": 2
  }
}
```

---

### GET /api/invoices/:id

Detail satu invoice.

**Response 200:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "invoiceNumber": "INV-20250614-0001",
    "plan": "STARTER",
    "interval": "MONTHLY",
    "amount": 99000,
    "status": "PAID",
    "midtransOrderId": "SUB-INV-20250614-0001",
    "paymentUrl": "https://...",
    "paidAt": "2025-06-14T10:00:00.000Z",
    "paymentMethod": "qris",
    "periodStart": "2025-06-14T00:00:00.000Z",
    "periodEnd": "2025-07-14T00:00:00.000Z",
    "expiredAt": "2025-06-15T00:00:00.000Z",
    "createdAt": "2025-06-14T09:00:00.000Z"
  }
}
```

---

## Plan Feature Enforcement

Middleware `planGuard.js` dipasang di route level:

| Middleware                      | Route           | Effect                                              |
| ------------------------------ | --------------- | --------------------------------------------------- |
| `requireActiveSubscription`    | Global (app.js) | Blokir PAST_DUE, warning header utk EXPIRED         |
| `resource('botConfig')`        | POST bot-config | Tolak jika melebihi limit plan                      |
| `resource('product')`          | POST produk     | Tolak jika melebihi limit plan                      |
| `feature('canBroadcast')`      | POST broadcast  | Tolak jika fitur tidak tersedia di plan             |
| `feature('canUseFulfillment')` | Fulfillment     | Tolak jika fitur tidak tersedia di plan             |

**PAST_DUE response (402):**

```json
{
  "success": false,
  "code": "SUBSCRIPTION_REQUIRED",
  "message": "Subscription Anda telah berakhir. Silakan perpanjang untuk melanjutkan."
}
```

**PLAN_LIMIT_EXCEEDED response (403):**

```json
{
  "success": false,
  "code": "PLAN_LIMIT_EXCEEDED",
  "message": "Plan FREE hanya mendukung 1 bot config"
}
```

---

## Alur Payment (Webhook)

```
POST /api/subscription/upgrade
  → createInvoice() → Midtrans Snap → simpan invoice (PENDING)
  → return paymentUrl ke frontend
      ↓
User bayar via Midtrans
      ↓
Midtrans POST /api/webhook/midtrans (payment handler)
  → activateSubscription(midtransOrderId, paymentMethod)
    → update invoice → PAID
    → upsert subscription → ACTIVE
    → update user.plan → STARTER/PRO
```

File: `src/services/subscriptionService.js` — `activateSubscription()`
File: `src/services/invoiceService.js` — `createInvoice()`

---

## Cron Jobs

| Job                           | What it does                                    | Schedule |
| ----------------------------- | ----------------------------------------------- | -------- |
| `expirePendingInvoices()`     | PENDING → EXPIRED (24h no pay)                  | Every 1h |
| `updateExpiredStatuses()`     | ACTIVE → EXPIRED (grace period mulai)           | Daily    |
| `getOverdueSubscriptions()`   | EXPIRED/CANCELLED → PAST_DUE + downgrade FREE   | Daily    |
| `getSubscriptionsForReminder()` | Kirim reminder H-3 dan H-1 sebelum expired    | Daily    |

File: `src/services/subscriptionService.js`
File: `src/services/invoiceService.js` — `expirePendingInvoices()`

---

## Schema Database

### Subscription

| Field              | Type               | Notes                                     |
| ------------------ | ------------------ | ----------------------------------------- |
| id                 | UUID               | PK                                        |
| userId             | UUID (unique)      | 1-to-1 dengan User                        |
| plan               | UserPlan           | STARTER / PRO                             |
| status             | SubscriptionStatus | ACTIVE / EXPIRED / CANCELLED / PAST_DUE   |
| interval           | PlanInterval       | MONTHLY / YEARLY                          |
| currentPeriodStart | DateTime           | Mulai periode                             |
| currentPeriodEnd   | DateTime           | Akhir periode (tanggal jatuh tempo)       |
| gracePeriodEnd     | DateTime           | currentPeriodEnd + 3 hari                 |
| cancelledAt        | DateTime?          | Diisi saat cancel                         |
| cancelReason       | String?            | Alasan pembatalan                         |

### Invoice

| Field           | Type         | Notes                               |
| --------------- | ------------ | ----------------------------------- |
| id              | UUID         | PK                                  |
| userId          | UUID         | FK ke User                          |
| subscriptionId  | UUID?        | FK ke Subscription (null pertama)   |
| invoiceNumber   | String       | INV-YYYYMMDD-NNNN (unique)          |
| plan            | UserPlan     | Plan yang dibeli                    |
| interval        | PlanInterval | MONTHLY / YEARLY                    |
| amount          | Int          | Nominal IDR                         |
| status          | InvoiceStatus| PENDING / PAID / EXPIRED / CANCELLED|
| midtransOrderId | String?      | SUB-{invoiceNumber}                 |
| paymentUrl      | String?      | Midtrans Snap redirect URL          |
| paidAt          | DateTime?    | Timestamp pembayaran                |
| paymentMethod   | String?      | qris, bank_transfer, dll.           |
| periodStart     | DateTime     | Periode yang di-cover               |
| periodEnd       | DateTime     | Periode yang di-cover               |
| expiredAt       | DateTime     | 24 jam setelah dibuat               |

File: `prisma/schema.prisma` (lines 612–664)
