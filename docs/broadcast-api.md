# Broadcast — API Documentation

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
| `FAILED` | Gagal dikirim (blocked, invalid ID, dll) |

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

---

### POST /broadcasts

Buat broadcast campaign baru. Status otomatis `DRAFT`. Jika `scheduledAt` diisi, status jadi `SCHEDULED`.

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
    "message": "Halo! 🎉\n\nDapatkan diskon 50% untuk semua produk!\n\nKlik /pesan untuk order sekarang.",
    "channel": "TELEGRAM",
    "filters": {
      "hasTelegram": "true",
      "totalSpentMin": 100000
    }
  }' \
  http://localhost:3000/api/broadcasts
```

**Contoh — Terjadwal:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ucapan HUT",
    "message": "Selamat ulang tahun! 🎂\n\nNikmati voucher diskon spesial untuk kamu.",
    "channel": "TELEGRAM",
    "filters": {},
    "scheduledAt": "2025-07-01T08:00:00.000Z"
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
    "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
    "name": "Promo Akhir Tahun",
    "channel": "TELEGRAM",
    "status": "DRAFT",
    "message": "Halo! 🎉\n\nDapatkan diskon 50%...",
    "filters": {
      "hasTelegram": "true",
      "totalSpentMin": 100000
    },
    "totalCustomers": 42,
    "sentCount": 0,
    "failedCount": 0,
    "scheduledAt": null,
    "sentAt": null,
    "createdAt": "2025-06-20T10:00:00.000Z",
    "updatedAt": "2025-06-20T10:00:00.000Z"
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

**Response (400 — tidak ada customer cocok):**

```json
{
  "success": false,
  "message": "Tidak ada customer yang cocok dengan filter"
}
```

---

### POST /broadcasts/preview

Preview jumlah customer yang cocok dengan filter (sebelum membuat broadcast). Berguna untuk estimasi sebelum kirim.

**Request body:**

| Field | Tipe | Required | Keterangan |
|-------|------|----------|------------|
| `filters` | object | opsional | Sama seperti filter di create. Jika kosong, hitung semua customer. |

**Contoh:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "hasTelegram": "true",
      "totalSpentMin": 50000
    }
  }' \
  http://localhost:3000/api/broadcasts/preview
```

**Response (200):**

```json
{
  "success": true,
  "message": "Preview berhasil",
  "data": {
    "customers": [
      {
        "id": "customer-uuid-1",
        "name": "Budi Santoso",
        "telegramId": "123456789",
        "hasTelegram": true,
        "phone": "08123456789",
        "email": "budi@example.com"
      }
    ],
    "total": 42
  }
}
```

> `customers` hanya berisi maksimal 20 sample. Gunakan `total` untuk estimasi jumlah sebenarnya.

---

### GET /broadcasts/:id

Detail satu broadcast — termasuk sent/failed/pending counts real-time.

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
    "userId": "a1b2c3d4-1234-5678-9abc-def012345678",
    "name": "Promo Akhir Tahun",
    "channel": "TELEGRAM",
    "status": "SENDING",
    "message": "Halo! 🎉 Dapatkan diskon 50%...",
    "filters": { "hasTelegram": "true" },
    "totalCustomers": 250,
    "sentCount": 120,
    "failedCount": 3,
    "pendingCount": 127,
    "isPaused": false,
    "scheduledAt": null,
    "sentAt": null,
    "createdAt": "2025-06-20T10:00:00.000Z",
    "updatedAt": "2025-06-20T10:05:00.000Z"
  }
}
```

> Field `pendingCount` dan `isPaused` adalah computed — tidak ada di database, dihitung real-time.

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
| `message` | string | Pesan baru |
| `channel` | enum | `TELEGRAM`, `WHATSAPP`, `EMAIL` |
| `filters` | object | Filter baru — akan recalculate `totalCustomers` |
| `scheduledAt` | string (ISO 8601) | Jadwal baru. Set `null` untuk hapus jadwal. |

> Jika broadcast berstatus `SCHEDULED` dan `name`/`message`/`filters` diubah, job terjadwal akan dibatalkan dan dibuat ulang.

**Contoh:**

```bash
curl -X PATCH -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Promo Akhir Tahun (Updated)",
    "message": "Halo! Diskon 50% berlaku sampai minggu depan! 🎉"
  }' \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Response (200):**

```json
{
  "success": true,
  "message": "Broadcast berhasil diperbarui",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "Promo Akhir Tahun (Updated)",
    "message": "Halo! Diskon 50% berlaku sampai minggu depan! 🎉",
    "status": "DRAFT",
    "updatedAt": "2025-06-20T11:00:00.000Z"
  }
}
```

**Response (400):**

```json
{
  "success": false,
  "message": "Hanya broadcast DRAFT atau SCHEDULED yang bisa diedit"
}
```

---

### DELETE /broadcasts/:id

Hapus broadcast — hanya bisa untuk status `DRAFT` atau `SCHEDULED`. Jika `SCHEDULED`, job di queue akan dibatalkan.

**Contoh:**

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

## 2. Send, Pause, Resume, Cancel

### POST /broadcasts/:id/send

Mulai kirim broadcast. Mengubah status dari `DRAFT` atau `SCHEDULED` menjadi `SENDING`, membuat `BroadcastRecipient` records, dan men-*enqueue* 1 job per recipient ke BullMQ.

**Cek sebelum kirim:**
- Monthly broadcast limit (STARTER: 50/bulan, PRO: unlimited)
- Batas recipient per broadcast (STARTER: 1000, PRO: unlimited)
- Bot Telegram aktif
- Minimal ada 1 customer yang cocok

**Contoh:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/send
```

**Response (200):**

```json
{
  "success": true,
  "message": "Broadcast sedang dikirim",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "DRAFT",
    "totalCustomers": 250
  }
}
```

> Data yang dikembalikan adalah snapshot sebelum status diubah. Gunakan `GET /broadcasts/:id` untuk cek status real-time.

**Response (403 — limit bulanan):**

```json
{
  "success": false,
  "message": "Batas broadcast bulanan plan STARTER telah tercapai. Upgrade plan untuk menambah kapasitas."
}
```

**Response (400 — limit per broadcast):**

```json
{
  "success": false,
  "message": "Plan STARTER maksimal 1000 penerima per broadcast. 1500 customer cocok. Persempit filter."
}
```

---

### POST /broadcasts/:id/pause

Pause broadcast yang sedang `SENDING`. Job yang sedang berjalan akan tetap selesai, tapi job baru akan di-*skip* (recipient tetap `PENDING`).

**Contoh:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/pause
```

**Response (200):**

```json
{
  "success": true,
  "message": "Broadcast di-pause",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "PAUSED",
    "updatedAt": "2025-06-20T12:00:00.000Z"
  }
}
```

---

### POST /broadcasts/:id/resume

Resume broadcast yang `PAUSED`. Semua recipient `PENDING` akan di-*enqueue* ulang.

**Contoh:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/resume
```

**Response (200):**

```json
{
  "success": true,
  "message": "Broadcast dilanjutkan",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "SENDING"
  }
}
```

---

### POST /broadcasts/:id/cancel

Batalkan broadcast. Semua job di queue akan dihapus, status diubah ke `FAILED`. Cocok untuk membatalkan broadcast yang `SCHEDULED` atau `SENDING`.

**Contoh:**

```bash
curl -X POST -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/cancel
```

**Response (200):**

```json
{
  "success": true,
  "message": "Broadcast dibatalkan",
  "data": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "FAILED"
  }
}
```

**Response (400):**

```json
{
  "success": false,
  "message": "Broadcast sudah selesai"
}
```

---

## 3. Broadcast Recipients

### GET /broadcasts/:id/recipients

Daftar recipient untuk suatu broadcast (paginated). Bisa difilter berdasarkan status.

**Query params:**

| Param | Tipe | Keterangan |
|-------|------|------------|
| `status` | enum | Filter: `PENDING`, `SENT`, `FAILED` |
| `page` | number | Default `1` |
| `limit` | number | Default `20` |

**Contoh:**

```bash
curl -H "Authorization: Bearer <jwt>" \
  "http://localhost:3000/api/broadcasts/f47ac10b-58cc-4372-a567-0e02b2c3d479/recipients?status=FAILED&page=1&limit=10"
```

**Response (200):**

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
      "error": "Akun Telegram tidak aktif/memblokir bot",
      "sentAt": null,
      "createdAt": "2025-06-20T10:00:00.000Z",
      "customer": {
        "id": "customer-uuid-1",
        "name": "Budi Santoso",
        "username": "budi_s",
        "telegramId": "123456789",
        "phone": "08123456789",
        "email": "budi@example.com"
      }
    }
  ],
  "metadata": { "total": 3, "page": 1, "limit": 10, "totalPages": 1 }
}
```

**Response (200 — SENT):**

```json
{
  "success": true,
  "message": "OK",
  "data": [
    {
      "id": "c1b2c3d4-2222-3333-4444-555566667777",
      "broadcastId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "customerId": "customer-uuid-2",
      "status": "SENT",
      "error": null,
      "sentAt": "2025-06-20T10:05:30.000Z",
      "createdAt": "2025-06-20T10:00:00.000Z",
      "customer": {
        "id": "customer-uuid-2",
        "name": "Siti Nurhaliza",
        "username": "siti_n",
        "telegramId": "987654321",
        "phone": null,
        "email": null
      }
    }
  ],
  "metadata": { "total": 247, "page": 1, "limit": 10, "totalPages": 25 }
}
```

---

## 4. Plan Limits

Limit broadcast berdasarkan plan tenant (didefinisikan di `planLimitService.js`):

| Plan | Bisa Broadcast? | Maks/bulan | Maks/ broadcast |
|------|----------------|------------|-----------------|
| `FREE` | ❌ Tidak | 0 | 0 |
| `STARTER` | ✅ Ya | 50 | 1.000 recipient |
| `PRO` | ✅ Ya | Tak terbatas | Tak terbatas |

---

## 5. Flow Diagram (Frontend)

### Flow DRAFT → SENDING

```
[Buat] → POST /broadcasts → DRAFT
  ↓
[Kirim] → POST /broadcasts/:id/send
  ↓
[Polling] → GET /broadcasts/:id (cek sentCount, pendingCount, failedCount)
  ↓
Status → SENT (semua pending = 0)
```

### Flow SCHEDULED

```
[Buat + scheduledAt] → POST /broadcasts → SCHEDULED
  ↓
[Menunggu] → Waktu scheduledAt tiba → otomatis SENDING
  ↓
Bisa dibatalkan via POST /broadcasts/:id/cancel
```

### Flow PAUSED

```
[SENDING] → POST /broadcasts/:id/pause → PAUSED
  ↓
POST /broadcasts/:id/resume → SENDING (lanjut kirim)
  atau
POST /broadcasts/:id/cancel → FAILED
```

---

## Summary Endpoints

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET` | `/broadcasts` | Daftar broadcast campaign |
| `POST` | `/broadcasts` | Buat broadcast baru |
| `POST` | `/broadcasts/preview` | Preview jumlah customer cocok |
| `GET` | `/broadcasts/:id` | Detail broadcast + progress |
| `PATCH` | `/broadcasts/:id` | Update broadcast (DRAFT/SCHEDULED) |
| `DELETE` | `/broadcasts/:id` | Hapus broadcast (DRAFT/SCHEDULED) |
| `POST` | `/broadcasts/:id/send` | Mulai kirim broadcast |
| `POST` | `/broadcasts/:id/pause` | Pause broadcast SENDING |
| `POST` | `/broadcasts/:id/resume` | Resume broadcast PAUSED |
| `POST` | `/broadcasts/:id/cancel` | Batalkan broadcast kapan pun |
| `GET` | `/broadcasts/:id/recipients` | Daftar recipient + filter status |
