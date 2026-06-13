# MANUAL Fulfillment — Test Scenarios

## Field Guide for MANUAL type

Hanya field berikut yang relevan untuk `type: "MANUAL"`:

| Field | Wajib | Contoh |
|---|---|---|
| `type` | ✅ | `"MANUAL"` |
| `manualNote` | ❌ | `"Kirim via email ke customer"` |
| `deliveryMessage` | ❌ | `"Pesanan sedang diproses, tim kami akan menghubungi Anda"` |
| `isActive` | ❌ | `true` (default) |

Field **API_EXTERNAL** (apiUrl, apiMethod, apiHeaders, apiPayloadTemplate, apiCredentials, apiSuccessPath, apiSuccessValue, apiResultPath) **tidak perlu diisi** — akan diabaikan untuk MANUAL.

---

## Scenario 1: Create MANUAL Config via API

### Request
```
POST /api/products/a2cbf217-c482-4bce-98f0-50b97fd435e5/fulfillment
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "type": "MANUAL",
  "manualNote": "Kirim via WhatsApp ke nomor customer",
  "deliveryMessage": "Pesanan {{product_name}} sedang diproses manual oleh admin. Kami akan menghubungi Anda segera."
}
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "id": "...",
    "productId": "a2cbf217-c482-4bce-98f0-50b97fd435e5",
    "type": "MANUAL",
    "manualNote": "Kirim via WhatsApp ke nomor customer",
    "deliveryMessage": "Pesanan {{product_name}} sedang diproses manual oleh admin. Kami akan menghubungi Anda segera.",
    "isActive": true,
    ...
  }
}
```

---

## Scenario 2: Verify Config via API

### Request
```
GET /api/products/a2cbf217-c482-4bce-98f0-50b97fd435e5/fulfillment
Authorization: Bearer <jwt>
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "type": "MANUAL",
    "manualNote": "Kirim via WhatsApp...",
    ...
  }
}
```

Jika belum pernah create config → `{ "success": true, "data": null }` (200, not 404).

---

## Scenario 3: End-to-End — Place Order → Fulfillment Triggered

### Prerequisite
- Sudah ada MANUAL config (Scenario 1) dengan `isActive: true`
- Webhook server jalan
- Redis jalan
- BullMQ worker aktif

### Steps

1. **Customer order produk "Nasi" via Telegram**
   - Order tersimpan di DB dengan status `PAYMENT_PENDING`

2. **Customer bayar → Midtrans kirim webhook settlement**
   - Midtrans POST `/api/webhook/midtrans`
   - Order status diupdate ke `COMPLETED`
   - `enqueueFulfillment(order.id, userId)` dipanggil → job masuk BullMQ `fulfillment-jobs`

3. **FulfillmentWorker proses job**
   - Deteksi tipe `MANUAL`
   - Panggil `manualStrategy.execute()`
   - Order status diupdate ke `PROCESSING`
   - Admin bot mendapat notifikasi (jika admin bot aktif)

### Expected Result

**Di database:**
```
order.status = "PROCESSING"
fulfillmentLog.status = "SUCCESS"
fulfillmentLog.type = "MANUAL"
fulfillmentLog.attempts = 1
fulfillmentLog.deliveredContent berisi delivery message
```

**Di admin bot (jika terkonfigurasi):**
```
👷 Fulfillment Manual Diperlukan
🔖 Order: INV-xxx
📦 Produk: 🍚 Nasi x1
💵 Total: Rp 10.000
👤 User-Name @username
📞 08123456789

📝 Catatan: Kirim via WhatsApp ke nomor customer

Segera proses pesanan ini!
```

---

## Scenario 4: Idempotency — Duplicate Webhook

### Steps
1. Webhook settlement sudah diproses → order COMPLETED + fulfillment SUCCESS
2. Midtrans kirim webhook settlement lagi (duplikat)
3. Idempotency check: order.status sudah `COMPLETED` → return 200 "already processed"
4. Worker: fulfillmentLog.status sudah `SUCCESS` → skip

### Expected
FulfillmentLog tidak berubah. Stock tidak terpakai ganda.

---

## Scenario 5: Worker Retry on Failure

### Steps
1. Matikan admin bot / buat strategy throw error
2. Worker gagal → catat FAILED di FulfillmentLog
3. BullMQ retry dengan exponential backoff (5s, 10s, 20s)
4. Setelah 3x gagal → `FulfillmentLog.status = FAILED`, `attempts = 3`
5. Admin bot dikirimi notifikasi gagal (jika admin bot aktif)

### Expected
```
fulfillmentLog.status = "FAILED"
fulfillmentLog.attempts = 3
fulfillmentLog.lastError = "...error message..."
```

---

## Scenario 6: Manual Retry via API

### Steps
1. FulfillmentLog status FAILED
2. Panggil:
   ```
   POST /api/fulfillment-logs/:orderId/retry
   Authorization: Bearer <jwt>
   ```
3. Controller enqueue ulang job ke BullMQ

### Expected
```
fulfillmentLog.status = "PENDING" (setelah retry di-enqueue)
```
Worker proses ulang dari awal.

---

## Scenario 7: Update Config to Inactive

### Request
```
POST /api/products/a2cbf217-c482-4bce-98f0-50b97fd435e5/fulfillment
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "type": "MANUAL",
  "manualNote": "Kirim via WhatsApp",
  "isActive": false
}
```

### Expected
Config tersimpan dengan `isActive: false`.
Order baru untuk produk ini **tidak** trigger fulfillment (worker skip karena `!config.isActive`).

---

## Flow Diagram

```
Webhook Settlement
    │
    ▼
updateOrder(COMPLETED)
    │
    ▼
enqueueFulfillment(orderId, userId)
    │
    ▼
BullMQ: fulfillment-jobs
    │
    ▼
FulfillmentWorker
    │
    ├─ FulfillmentLog sudah SUCCESS/SKIPPED? → SKIP (idempotent)
    │
    ├─ Config tidak ada / isActive=false? → SKIP
    │
    ├─ type=MANUAL
    │      ├─ order.status → PROCESSING
    │      ├─ notify admin bot
    │      └─ FulfillmentLog → SUCCESS
    │
    └─ Kirim delivery message ke customer via Telegram
```
