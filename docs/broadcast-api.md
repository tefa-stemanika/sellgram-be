# Broadcast & Template — API Documentation

> Base URL: `/api`  
> Auth: All endpoints require `Authorization: Bearer <jwt>` header.  
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
    "limit": 20,
    "totalPages": 5
  }
}
```

Error response:

```json
{
  "success": false,
  "message": "Broadcast not found"
}
```

---

## Enums

### BroadcastChannel

| Value | Keterangan |
|-------|------------|
| `TELEGRAM` | Kirim pesan via Telegram bot (default) |
| `WHATSAPP` | (Coming soon) |
| `EMAIL` | (Coming soon) |

### BroadcastStatus

| Value | Keterangan |
|-------|------------|
| `DRAFT` | Baru dibuat, belum dikirim |
| `SCHEDULED` | Terjadwal, akan dikirim otomatis |
| `SENDING` | Sedang dikirim ke customer |
| `SENT` | Selesai dikirim ke semua recipient |
| `PAUSED` | Dihentikan sementara oleh admin |
| `FAILED` | Gagal/dibatalkan |

### BroadcastRecipientStatus

| Value | Keterangan |
|-------|------------|
| `PENDING` | Menunggu dikirim |
| `SENT` | Berhasil terkirim |
| `FAILED` | Gagal dikirim |

### SourceType (Variable Mapping)

| Value | Keterangan |
|-------|------------|
| `CUSTOMER_FIELD` | Ambil nilai dari field `Customer` (`name`, `phone`, `email`, `username`) |
| `STATIC_VALUE` | Nilai statis yang sama untuk semua customer |
| `DERIVED_FIELD` | Nilai turunan dari data order customer |

### DerivedFieldType

| Value | Keterangan |
|-------|------------|
| `TOTAL_ORDERS` | Jumlah order COMPLETED customer |
| `TOTAL_SPENT` | Total belanja customer (format Rp) |
| `LAST_ORDER_DATE` | Tanggal order terakhir |
| `LAST_PRODUCT_NAME` | Nama produk dari order terakhir |

### RecipientFailureType

| Value | Keterangan |
|-------|------------|
| `VALIDATION` | Gagal karena data customer tidak lengkap |
| `SEND_ERROR` | Gagal karena error pengiriman (blocked, network, dll) |

---

## 1. Broadcast Campaigns

### GET /broadcasts

Daftar semua broadcast campaign (paginated).

**Query params:**

| Param | Tipe | Keterangan |
|-------|------|------------|
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `100` |
| `status` | enum | Filter: `DRAFT`, `SCHEDULED`, `SENDING`, `SENT`, `PAUSED`, `FAILED` |
| `sortBy` | string | `createdAt` (default), `name`, `status`, `totalCustomers`, `sentCount`, `updatedAt` |
| `sortDir` | string | `desc` (default) atau `asc` |

**Contoh:**

```bash
curl -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/broadcasts?page=1&limit=10&status=SENDING"
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
      "name": "Promo Akhir Tahun",
      "channel": "TELEGRAM",
      "status": "SENDING",
      "message": "Halo! Dapatkan diskon 50%...",
      "templateId": null,
      "filters": { "hasTelegram": "true", "totalSpentMin": "100000" },
      "totalCustomers": 250,
      "sentCount": 120,
      "failedCount": 3,
      "scheduledAt": null,
      "sentAt": null,
      "createdAt": "2025-06-20T10:00:00.000Z",
      "updatedAt": "2025-06-20T10:05:00.000Z"
    }
  ],
  "metadata": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }
}
```

> `templateId` akan terisi jika broadcast dibuat dari template. `message` berisi snapshot teks template (tidak berubah jika template diedit setelah broadcast dikirim).

---

### POST /broadcasts

Buat broadcast campaign biasa (tanpa template). Status otomatis `DRAFT`. Jika `scheduledAt` diisi, status jadi `SCHEDULED`.

**Request body:**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `name` | string | ✅ | Nama campaign (internal, tidak dikirim ke customer) |
| `message` | string | ✅ | Isi pesan broadcast (Markdown didukung) |
| `channel` | enum | opsional | `TELEGRAM` (default) |
| `filters` | object | opsional | Filter customer — lihat tabel di bawah |
| `scheduledAt` | string (ISO 8601) | opsional | Jadwal pengiriman. Jika diisi, broadcast langsung terjadwal. |

**Filter keys (`filters`):**

| Key | Tipe | Keterangan |
|-----|------|------------|
| `search` | string | Cari berdasarkan nama, username, email, atau phone |
| `hasTelegram` | string | `"true"` atau `"false"` |
| `hasWhatsapp` | string | `"true"` atau `"false"` |
| `hasEmail` | string | `"true"` atau `"false"` |
| `source` | string | `ORDER`, `MANUAL`, `IMPORT` |
| `totalSpentMin` | number | Minimal total belanja (dalam IDR) |
| `totalSpentMax` | number | Maksimal total belanja (dalam IDR) |

> Jika channel `TELEGRAM` dan filter `hasTelegram` tidak diset, secara otomatis akan diisi `hasTelegram: "true"` saat pengiriman.

**Contoh — DRAFT biasa:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Promo Akhir Tahun",
    "message": "Halo! 🎉 Dapatkan diskon 50%...",
    "channel": "TELEGRAM",
    "filters": { "hasTelegram": "true" }
  }' \
  http://localhost:3000/api/broadcasts
```

**Response (201):**

```json
{
  "success": true,
  "message": "Broadcast berhasil dibuat",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "Promo Akhir Tahun",
    "status": "DRAFT",
    "message": "Halo! 🎉 Dapatkan diskon 50%...",
    "templateId": null,
    "totalCustomers": 42,
    "createdAt": "2025-06-20T10:00:00.000Z"
  }
}
```

**Response (403 — FREE plan):**

```json
{
  "success": false,
  "code": "FEATURE_NOT_ALLOWED",
  "message": "Fitur ini tidak tersedia di plan FREE"
}
```

---

### POST /broadcasts/from-template

Buat broadcast baru dari template. Sistem akan menyimpan mapping variabel dan snapshot teks template.

**Request body:**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `name` | string | ✅ | Nama campaign |
| `templateId` | string (UUID) | ✅ | ID template yang akan digunakan |
| `mappings` | array | ✅ | Array mapping variabel — lihat tabel di bawah |
| `channel` | enum | opsional | `TELEGRAM` (default) |
| `filters` | object | opsional | Filter customer |
| `scheduledAt` | string (ISO 8601) | opsional | Jadwal pengiriman |

**Mapping item (`mappings[]`):**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `variableIndex` | number | ✅ | Nomor variabel (`1`, `2`, `3`, dst) |
| `sourceType` | string | ✅ | `CUSTOMER_FIELD`, `STATIC_VALUE`, atau `DERIVED_FIELD` |
| `sourceValue` | string | ✅ | Nama field / nilai statis / tipe derived |

**Mapping sourceValue berdasarkan sourceType:**

| sourceType | sourceValue | Contoh |
|------------|-------------|--------|
| `CUSTOMER_FIELD` | `name`, `phone`, `email`, `username` | `"name"` |
| `STATIC_VALUE` | Nilai teks bebas | `"PROMO50"` |
| `DERIVED_FIELD` | `TOTAL_ORDERS`, `TOTAL_SPENT`, `LAST_ORDER_DATE`, `LAST_PRODUCT_NAME` | `"TOTAL_SPENT"` |

**Validasi:**
- Semua variabel yang terdeteksi di template (`{{1}}`, `{{2}}`, ...) WAJIB di-mapping
- `sourceType` harus salah satu dari: `CUSTOMER_FIELD`, `STATIC_VALUE`, `DERIVED_FIELD`
- `sourceValue` wajib diisi

**Contoh:**

Template yang dipakai: `"Halo {{1}}, promo {{2}} buat kamu! Total belanja: {{3}}"`

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Promo dari Template",
    "templateId": "template-uuid-123",
    "mappings": [
      { "variableIndex": 1, "sourceType": "CUSTOMER_FIELD", "sourceValue": "name" },
      { "variableIndex": 2, "sourceType": "STATIC_VALUE", "sourceValue": "DISKON50" },
      { "variableIndex": 3, "sourceType": "DERIVED_FIELD", "sourceValue": "TOTAL_SPENT" }
    ],
    "filters": { "hasTelegram": "true" }
  }' \
  http://localhost:3000/api/broadcasts/from-template
```

**Response (201):**

```json
{
  "success": true,
  "message": "Broadcast dari template berhasil dibuat",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "Promo dari Template",
    "templateId": "template-uuid-123",
    "status": "DRAFT",
    "message": "Halo {{1}}, promo {{2}} buat kamu! Total belanja: {{3}}",
    "totalCustomers": 150,
    "createdAt": "2025-06-20T10:00:00.000Z"
  }
}
```

**Response (400 — mapping tidak lengkap):**

```json
{
  "success": false,
  "message": "Variabel {{3}} belum di-mapping. Semua variabel template harus di-mapping."
}
```

---

### POST /broadcasts/preview

Preview jumlah customer yang cocok dengan filter (sebelum membuat broadcast).

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"filters": { "hasTelegram": "true" } }' \
  http://localhost:3000/api/broadcasts/preview
```

**Response (200):**

```json
{
  "success": true,
  "message": "Preview berhasil",
  "data": { "customers": [...], "total": 42 }
}
```

---

### GET /broadcasts/:id

Detail satu broadcast — termasuk sent/failed/pending counts real-time dan informasi template.

**Contoh:**

```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "Promo dari Template",
    "channel": "TELEGRAM",
    "status": "SENDING",
    "message": "Halo {{1}}, promo {{2}} buat kamu! Total belanja: {{3}}",
    "templateId": "template-uuid-123",
    "filters": { "hasTelegram": "true" },
    "totalCustomers": 150,
    "sentCount": 120,
    "failedCount": 3,
    "pendingCount": 27,
    "isPaused": false,
    "scheduledAt": null,
    "sentAt": null,
    "createdAt": "2025-06-20T10:00:00.000Z",
    "updatedAt": "2025-06-20T10:05:00.000Z"
  }
}
```

> Jika broadcast dibuat dari template, `message` berisi snapshot teks template dengan placeholder (`{{1}}`, `{{2}}`, dst).  
> Gunakan `POST /broadcasts/:id/preview-render` untuk melihat hasil render dengan data customer asli.

**Response (404):**

```json
{
  "success": false,
  "message": "Broadcast tidak ditemukan"
}
```

---

### PATCH /broadcasts/:id

Update broadcast — hanya bisa untuk status `DRAFT` atau `SCHEDULED`.

**Request body:** (semua field opsional)

| Field | Tipe | Keterangan |
|-------|------|------------|
| `name` | string | Nama baru |
| `message` | string | Pesan baru (hanya jika tanpa template) |
| `channel` | enum | `TELEGRAM`, `WHATSAPP`, `EMAIL` |
| `filters` | object | Filter baru — akan recalculate `totalCustomers` |
| `scheduledAt` | string (ISO 8601) | Jadwal baru. Set `null` untuk hapus jadwal. |

**Response (200):**

```json
{
  "success": true,
  "message": "Broadcast berhasil diperbarui",
  "data": { "name": "Promo (Updated)", "status": "DRAFT" }
}
```

---

### DELETE /broadcasts/:id

Hapus broadcast — hanya bisa untuk status `DRAFT` atau `SCHEDULED`.

```bash
curl -X DELETE -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Response (200):**

```json
{
  "success": true,
  "message": "Broadcast berhasil dihapus",
  "data": null
}
```

---

## 2. Preview & Dry-Run (Template)

### POST /broadcasts/:id/preview-render

Preview hasil render pesan untuk 1 sample customer. Berguna untuk cek apakah mapping sudah benar sebelum kirim.

Untuk broadcast dari template: sistem akan mengambil 1 customer sample, resolve semua mapping, dan menampilkan teks final. Jika ada variabel yang gagal di-resolve (data customer kosong), akan muncul di `errors`.

Untuk broadcast tanpa template: mengembalikan `message` langsung.

**Contoh:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/preview-render
```

**Response (200 — sukses):**

```json
{
  "success": true,
  "message": "Preview render berhasil",
  "data": {
    "rendered": "Halo Budi Santoso, promo DISKON50 buat kamu! Total belanja: Rp 250.000",
    "errors": []
  }
}
```

**Response (200 — ada error validasi):**

```json
{
  "success": true,
  "message": "Preview render berhasil",
  "data": {
    "rendered": "Halo [Sample {{1}}], promo DISKON50 buat kamu! Total belanja: [Sample {{3}}]",
    "errors": [
      "Variabel {{1}} (Customer.name) kosong untuk customer ini",
      "Variabel {{3}} (TOTAL_SPENT) gagal di-resolve untuk customer ini"
    ]
  }
}
```

> `rendered` tetap diisi dengan sample/placeholder untuk variabel yang gagal, supaya UI tetap bisa menampilkan preview.

---

### POST /broadcasts/:id/dry-run

Dry-run validasi — menghitung berapa customer yang akan gagal validasi (data tidak lengkap) tanpa benar-benar mengirim pesan. Berguna untuk estimasi sebelum trigger send.

Sistem akan mengambil sample 500 customer pertama, render template untuk masing-masing, dan melaporkan jumlah yang gagal beserta sample error-nya.

**Contoh:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/dry-run
```

**Response (200):**

```json
{
  "success": true,
  "message": "Dry-run selesai",
  "data": {
    "total": 500,
    "invalidCount": 12,
    "invalidSamples": [
      {
        "customerId": "cust-uuid-1",
        "name": "Budi Santoso",
        "errors": [
          "Variabel {{1}} (Customer.name) kosong untuk customer ini"
        ]
      }
    ]
  }
}
```

> Dry-run hanya memproses 500 customer pertama. Untuk total keseluruhan, lihat `GET /broadcasts/:id` → `totalCustomers`.

---

## 3. Send, Pause, Resume, Cancel

### POST /broadcasts/:id/send

Mulai kirim broadcast. Untuk broadcast dari template, sistem akan:
1. Cek semua variabel template sudah di-mapping
2. Per recipient: render template → validasi data → kirim (atau skip jika validasi gagal)

**Cek sebelum kirim:**
- Monthly broadcast limit (STARTER: 50/bulan, PRO: unlimited)
- Batas recipient per broadcast (STARTER: 1000, PRO: unlimited)
- Bot Telegram aktif
- Minimal ada 1 customer yang cocok
- (Jika dari template) Semua variabel sudah di-mapping

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/send
```

---

### POST /broadcasts/:id/pause

Pause broadcast yang sedang `SENDING`.

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/pause
```

---

### POST /broadcasts/:id/resume

Resume broadcast yang `PAUSED`. Semua recipient `PENDING` akan di-*enqueue* ulang.

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/resume
```

---

### POST /broadcasts/:id/cancel

Batalkan broadcast. Status diubah ke `FAILED`.

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/cancel
```

---

## 4. Broadcast Recipients

### GET /broadcasts/:id/recipients

Daftar recipient untuk suatu broadcast (paginated). Bisa difilter berdasarkan status dan failureType.

**Query params:**

| Param | Tipe | Keterangan |
|-------|------|------------|
| `status` | enum | Filter: `PENDING`, `SENT`, `FAILED` |
| `page` | number | Default `1` |
| `limit` | number | Default `20` |

**Contoh — filter FAILED:**

```bash
curl -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/recipients?status=FAILED&page=1&limit=10"
```

**Response (200 — FAILED karena VALIDATION):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "b1b2c3d4-1111-2222-3333-444455556666",
      "broadcastId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "customerId": "customer-uuid-1",
      "status": "FAILED",
      "failureType": "VALIDATION",
      "error": "Variabel {{1}} (Customer.name) kosong untuk customer ini",
      "sentAt": null,
      "createdAt": "2025-06-20T10:00:00.000Z",
      "customer": {
        "id": "customer-uuid-1",
        "name": null,
        "username": "budi_s",
        "telegramId": "123456789",
        "phone": "08123456789",
        "email": "budi@example.com"
      }
    }
  ],
  "metadata": { "total": 12, "page": 1, "limit": 10, "totalPages": 2 }
}
```

**Response (200 — FAILED karena SEND_ERROR):**

```json
{
  "success": true,
  "data": [
    {
      "id": "b1b2c3d4-2222-3333-4444-555566667777",
      "status": "FAILED",
      "failureType": "SEND_ERROR",
      "error": "Akun Telegram tidak aktif/memblokir bot",
      "customer": {
        "id": "customer-uuid-2",
        "name": "Siti Nurhaliza",
        "telegramId": "987654321"
      }
    }
  ],
  "metadata": { "total": 3, "page": 1, "limit": 10, "totalPages": 1 }
}
```

> `failureType` memudahkan frontend membedakan:
> - `VALIDATION` → data customer tidak lengkap, perlu dilengkapi dulu
> - `SEND_ERROR` → masalah teknis (blocked, network), bisa di-retry

---

## 5. Campaign Templates

### GET /templates

Daftar semua template (paginated).

**Query params:**

| Param | Tipe | Keterangan |
|-------|------|------------|
| `page` | number | Default `1` |
| `limit` | number | Default `20` |
| `sortBy` | string | `createdAt` (default), `name`, `updatedAt`, `variableCount` |
| `sortDir` | string | `desc` (default) atau `asc` |

**Contoh:**

```bash
curl -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/templates?page=1&limit=20"
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "template-uuid-123",
      "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
      "name": "Promo Umum",
      "channel": "TELEGRAM",
      "content": "Halo {{1}}, promo {{2}} buat kamu!",
      "variableCount": 2,
      "variables": [
        { "index": 1, "label": "Nama Customer", "sample": "Budi Santoso" },
        { "index": 2, "label": "Kode Promo", "sample": "PROMO50" }
      ],
      "createdAt": "2025-06-20T10:00:00.000Z",
      "updatedAt": "2025-06-20T10:00:00.000Z"
    }
  ],
  "metadata": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

---

### POST /templates

Buat template baru. Sistem akan auto-detect jumlah variabel dari `{{n}}` di teks. Setiap variabel WAJIB memiliki label.

**Request body:**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `name` | string | ✅ | Nama template |
| `content` | string | ✅ | Teks dengan placeholder `{{1}}`, `{{2}}`, dst |
| `channel` | enum | opsional | `TELEGRAM` (default) |
| `variables` | array | ✅ | Array metadata variabel — lihat tabel di bawah |

**Variable item (`variables[]`):**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `index` | number | ✅ | Nomor variabel (`1`, `2`, dst) |
| `label` | string | ✅ | Label deskriptif (ditampilkan di UI saat mapping) |
| `sample` | string | opsional | Contoh nilai untuk preview. Default: `"[Sample {{n}}]"` |

**Validasi:**
- Setiap `{{n}}` yang terdeteksi di `content` WAJIB memiliki item di `variables` dengan `index` yang sesuai
- Setiap variabel di `variables` WAJIB memiliki `label`
- Maksimal 20 variabel per template

**Contoh:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Promo Umum",
    "content": "Halo {{1}}, promo {{2}} buat kamu! Total belanja: {{3}}",
    "variables": [
      { "index": 1, "label": "Nama Customer", "sample": "Budi Santoso" },
      { "index": 2, "label": "Kode Promo", "sample": "PROMO50" },
      { "index": 3, "label": "Total Belanja", "sample": "Rp 50.000" }
    ]
  }' \
  http://localhost:3000/api/templates
```

**Response (201):**

```json
{
  "success": true,
  "message": "Template berhasil dibuat",
  "data": {
    "id": "template-uuid-123",
    "name": "Promo Umum",
    "channel": "TELEGRAM",
    "content": "Halo {{1}}, promo {{2}} buat kamu! Total belanja: {{3}}",
    "variableCount": 3,
    "variables": [
      { "index": 1, "label": "Nama Customer", "sample": "Budi Santoso" },
      { "index": 2, "label": "Kode Promo", "sample": "PROMO50" },
      { "index": 3, "label": "Total Belanja", "sample": "Rp 50.000" }
    ],
    "createdAt": "2025-06-20T10:00:00.000Z"
  }
}
```

**Response (400 — variabel tanpa label):**

```json
{
  "success": false,
  "message": "Variabel {{2}} wajib memiliki label"
}
```

**Response (403 — limit template):**

```json
{
  "success": false,
  "code": "PLAN_LIMIT_EXCEEDED",
  "message": "Plan STARTER hanya mendukung 5 template"
}
```

---

### GET /templates/:id

Detail satu template — termasuk preview hasil render dengan sample values.

**Contoh:**

```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/templates/template-uuid-123
```

**Response (200):**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "id": "template-uuid-123",
    "name": "Promo Umum",
    "content": "Halo {{1}}, promo {{2}} buat kamu!",
    "variableCount": 2,
    "variables": [
      { "index": 1, "label": "Nama Customer", "sample": "Budi Santoso" },
      { "index": 2, "label": "Kode Promo", "sample": "PROMO50" }
    ],
    "preview": "Halo Budi Santoso, promo PROMO50 buat kamu!",
    "createdAt": "2025-06-20T10:00:00.000Z",
    "updatedAt": "2025-06-20T10:00:00.000Z"
  }
}
```

> Field `preview` adalah hasil render `content` dengan sample values dari `variables[]`.

---

### PATCH /templates/:id

Update template. Hanya field yang dikirim yang akan diubah.

**Request body:** (semua field opsional)

| Field | Tipe | Keterangan |
|-------|------|------------|
| `name` | string | Nama baru |
| `content` | string | Teks baru (akan re-detect variableCount) |
| `variables` | array | Metadata variabel baru (wajib jika `content` diubah) |

> Jika `content` diubah, `variables` wajib mencakup semua variabel yang terdeteksi.

**Contoh:**

```bash
curl -X PATCH -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Promo Umum (Updated)"
  }' \
  http://localhost:3000/api/templates/template-uuid-123
```

**Response (200):**

```json
{
  "success": true,
  "message": "Template berhasil diperbarui",
  "data": {
    "id": "template-uuid-123",
    "name": "Promo Umum (Updated)",
    "updatedAt": "2025-06-20T11:00:00.000Z"
  }
}
```

---

### DELETE /templates/:id

Hapus template. Hanya bisa jika tidak ada broadcast aktif (`DRAFT`, `SCHEDULED`, `SENDING`) yang masih menggunakan template ini. Broadcast yang sudah `SENT` atau `FAILED` tidak masalah (template sudah di-snapshot di `Broadcast.message`).

```bash
curl -X DELETE -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/templates/template-uuid-123
```

**Response (200):**

```json
{
  "success": true,
  "message": "Template berhasil dihapus",
  "data": null
}
```

**Response (400 — masih dipakai):**

```json
{
  "success": false,
  "message": "Tidak bisa menghapus template yang masih dipakai oleh 2 broadcast aktif."
}
```

---

## 6. Plan Limits

| Plan | Broadcast | Maks/bulan | Maks/ broadcast | Templates |
|------|-----------|------------|-----------------|-----------|
| `FREE` | ❌ | 0 | 0 | 1 |
| `STARTER` | ✅ | 50 | 1.000 recipient | 5 |
| `PRO` | ✅ | Tak terbatas | Tak terbatas | Tak terbatas |

---

## 7. Flow Diagram (Frontend)

### Flow Template → Broadcast

```
[Buat Template] → POST /templates → (auto-detect variables)
     ↓
[Halaman Template] → GET /templates/:id (lihat preview)
     ↓
[Buat Campaign dari Template] → POST /broadcasts/from-template
     ↓  mapping: {{1}} → Customer.name, {{2}} → static "PROMO50"
[DRAFT]
     ↓
[Preview Render] → POST /broadcasts/:id/preview-render
     ↓
[Dry-Run] → POST /broadcasts/:id/dry-run (cek validasi)
     ↓
[Kirim] → POST /broadcasts/:id/send
     ↓
[Polling] → GET /broadcasts/:id (sentCount, failedCount, pendingCount)
     ↓
[Selesai] → SENT / FAILED
```

### Flow FAILED → Investigasi

```
GET /broadcasts/:id/recipients?status=FAILED
     ↓
failureType: "VALIDATION"    → data customer tidak lengkap → lengkapi → broadcast ulang
failureType: "SEND_ERROR"    → teknis (blocked)          → retry / skip
```

---

## 8. Additional Endpoints

### GET /api/bots/quota

Lihat pemakaian plan saat ini (used/total).

```bash
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/bots/quota
```

```json
{
  "success": true,
  "message": "User quota retrieved",
  "data": {
    "plan": "STARTER",
    "products": { "used": 6, "total": 50 },
    "broadcastsPerMonth": { "used": 3, "total": 50 },
    "ordersPerMonth": { "used": 30, "total": 200 }
  }
}
```

---

### POST /api/bots/reconnect

Reconnect bot Telegram (restart instance + set webhook ulang). Berguna jika ada perubahan URL/webhook.

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/bots/reconnect
```

---

## Summary Endpoints

### Broadcast Campaigns

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/broadcasts` | Daftar broadcast campaign |
| `POST` | `/broadcasts` | Buat broadcast baru (tanpa template) |
| `POST` | `/broadcasts/from-template` | Buat broadcast dari template |
| `POST` | `/broadcasts/preview` | Preview jumlah customer cocok |
| `GET` | `/broadcasts/:id` | Detail broadcast + progress |
| `PATCH` | `/broadcasts/:id` | Update broadcast (DRAFT/SCHEDULED) |
| `DELETE` | `/broadcasts/:id` | Hapus broadcast (DRAFT/SCHEDULED) |
| `POST` | `/broadcasts/:id/preview-render` | Preview hasil render pesan (1 sample) |
| `POST` | `/broadcasts/:id/dry-run` | Dry-run validasi (estimasi gagal) |
| `POST` | `/broadcasts/:id/send` | Mulai kirim broadcast |
| `POST` | `/broadcasts/:id/pause` | Pause broadcast SENDING |
| `POST` | `/broadcasts/:id/resume` | Resume broadcast PAUSED |
| `POST` | `/broadcasts/:id/cancel` | Batalkan broadcast kapan pun |
| `GET` | `/broadcasts/:id/recipients` | Daftar recipient + filter status |

### Templates

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/templates` | Daftar template pesan |
| `POST` | `/templates` | Buat template baru |
| `GET` | `/templates/:id` | Detail template + preview |
| `PATCH` | `/templates/:id` | Update template |
| `DELETE` | `/templates/:id` | Hapus template |

### System

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/bots/quota` | Lihat pemakaian plan (used/total) |
| `POST` | `/bots/reconnect` | Reconnect bot Telegram |
