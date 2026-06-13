# Fulfillment Engine — Implementation Guide

## Goals

Otomasi pengiriman produk digital setelah Midtrans webhook `settlement` diterima — tanpa intervensi manual admin. Mendukung empat strategi pengiriman, retry otomatis via BullMQ, dan audit trail lengkap per order.

---

## Empat Strategi

| Type | Use Case | Cara Kerja |
|---|---|---|
| `STOCK_POOL` | Voucher, akun, serial key — stok disiapkan di muka | Ambil satu item dari pool, tandai `USED`, kirim ke customer |
| `SLOT_ASSIGN` | Netflix/Spotify sharing — akun induk dengan beberapa slot | Assign slot kosong ke customer, kirim credentials + slot identifier |
| `API_EXTERNAL` | Pulsa, paket data, top-up game — integrasi API supplier | HTTP POST ke API supplier dengan payload template, kirim hasil ke customer |
| `MANUAL` | Jasa custom, produk fisik, API belum tersedia | Update order ke `PROCESSING`, notifikasi admin bot untuk proses manual |

---

## Trigger Point

Fulfillment dipanggil **satu tempat**: di akhir Midtrans webhook payment success handler, setelah semua proses yang sudah ada.

```
updateOrder(COMPLETED) → deductStock → upsertCustomerFromOrder → createTicketFromOrder
→ [BARU] enqueueFulfillment(order.id, userId)
```

Queue baru BullMQ: `fulfillment-jobs` — retry 3x, exponential backoff 5s.

---

## Database Schema

### Enum Baru

```prisma
enum FulfillmentType   { STOCK_POOL SLOT_ASSIGN API_EXTERNAL MANUAL }
enum FulfillmentStatus { PENDING PROCESSING SUCCESS FAILED SKIPPED }
enum StockItemStatus   { AVAILABLE USED RESERVED EXPIRED }
enum SlotStatus        { ACTIVE AVAILABLE EXPIRED }
```

### Model: `FulfillmentConfig`

Relasi 1-to-1 dengan `Product`. Konfigurasi fulfillment per produk.

```prisma
model FulfillmentConfig {
  id        String          @id @default(uuid())
  userId    String
  productId String          @unique

  type      FulfillmentType

  // MANUAL
  manualNote String?

  // API_EXTERNAL
  apiUrl              String?
  apiMethod           String?  @default("POST")
  apiHeaders          Json?
  apiPayloadTemplate  String?  // JSON string dengan placeholder {{customer_phone}}, {{product_price}}, dll.
  apiCredentials      String?  // Terenkripsi AES-256-GCM
  apiSuccessPath      String?  // JSON path ke field sukses, contoh: "data.status"
  apiSuccessValue     String?  // Nilai yang dianggap sukses, contoh: "success"
  apiResultPath       String?  // JSON path ke hasil untuk dikirim ke customer

  // Pesan ke customer — placeholder: {{order_id}}, {{product_name}}, {{result}}
  deliveryMessage String?

  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

### Model: `StockItem`

Item individual untuk `STOCK_POOL`.

```prisma
model StockItem {
  id        String          @id @default(uuid())
  userId    String
  productId String
  content   String          // Plain text, JSON string, dll. Contoh: "user:pass", "VOUCHER-XXXXX"
  status    StockItemStatus @default(AVAILABLE)
  usedAt    DateTime?
  orderId   String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  order     Order?   @relation(fields: [orderId], references: [id])

  @@index([productId, status])
  @@index([userId])
}
```

### Model: `SlotAccount`

Akun induk untuk `SLOT_ASSIGN`.

```prisma
model SlotAccount {
  id          String   @id @default(uuid())
  userId      String
  productId   String
  label       String
  credentials String   // Terenkripsi AES-256-GCM. Isi: {"email": "x@x.com", "password": "abc"}
  totalSlots  Int
  usedSlots   Int      @default(0)
  isActive    Boolean  @default(true)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  slots       Slot[]

  @@index([productId, isActive])
  @@index([userId])
}
```

### Model: `Slot`

Slot individual dalam `SlotAccount`.

```prisma
model Slot {
  id             String      @id @default(uuid())
  userId         String
  slotAccountId  String
  productId      String
  slotIdentifier String      // Contoh: "Profile 3", "Slot B"
  additionalInfo String?     // PIN, instruksi, dll. — dikirim ke customer
  status         SlotStatus  @default(AVAILABLE)
  expiresAt      DateTime?
  assignedAt     DateTime?
  orderId        String?

  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  slotAccount    SlotAccount @relation(fields: [slotAccountId], references: [id], onDelete: Cascade)
  user           User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  order          Order?      @relation(fields: [orderId], references: [id])

  @@index([slotAccountId, status])
  @@index([productId, status])
  @@index([userId])
}
```

### Model: `FulfillmentLog`

Audit trail — satu record per order.

```prisma
model FulfillmentLog {
  id               String            @id @default(uuid())
  userId           String
  orderId          String            @unique
  productId        String
  type             FulfillmentType
  status           FulfillmentStatus @default(PENDING)
  attempts         Int               @default(0)
  maxAttempts      Int               @default(3)
  deliveredContent String?
  deliveredAt      DateTime?
  lastError        String?
  lastAttemptAt    DateTime?
  metadata         Json?

  createdAt        DateTime          @default(now())
  updatedAt        DateTime          @updatedAt

  order            Order             @relation(fields: [orderId], references: [id], onDelete: Cascade)
  user             User              @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([userId, createdAt])
}
```

### Tambahan Relasi di Model yang Sudah Ada

**`Product`**: tambah `fulfillmentConfig FulfillmentConfig?`, `stockItems StockItem[]`, `slotAccounts SlotAccount[]`, `slots Slot[]`

**`Order`**: tambah `fulfillmentLog FulfillmentLog?`, `stockItems StockItem[]`, `slots Slot[]`

**`User`**: tambah `fulfillmentConfigs FulfillmentConfig[]`, `stockItems StockItem[]`, `slotAccounts SlotAccount[]`, `slots Slot[]`, `fulfillmentLogs FulfillmentLog[]`

---

## Struktur File Baru

```
src/
├── services/fulfillment/
│   ├── fulfillmentEngine.js          # enqueueFulfillment() — entry point
│   ├── fulfillmentNotifier.js        # Kirim hasil ke customer & notif admin
│   └── strategies/
│       ├── stockPoolStrategy.js
│       ├── slotAssignStrategy.js
│       ├── apiExternalStrategy.js
│       └── manualStrategy.js
├── workers/
│   └── fulfillmentWorker.js          # BullMQ worker + queue definition
├── api/
│   ├── controllers/
│   │   ├── fulfillmentConfigController.js
│   │   ├── stockItemController.js
│   │   └── slotController.js
│   └── routes/
│       ├── fulfillmentConfig.routes.js
│       ├── stockItem.routes.js
│       ├── slot.routes.js
│       └── fulfillmentLog.routes.js
```

---

## API Endpoints

Semua menggunakan Admin JWT middleware yang sudah ada.

### Fulfillment Config
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/products/:productId/fulfillment` | Lihat config |
| POST | `/api/products/:productId/fulfillment` | Buat/update config |
| DELETE | `/api/products/:productId/fulfillment` | Hapus config |

### Stock Items (STOCK_POOL)
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/products/:productId/stock-items` | Daftar stok (filter by status) |
| POST | `/api/products/:productId/stock-items` | Upload single atau bulk (newline-separated) |
| DELETE | `/api/products/:productId/stock-items/:itemId` | Hapus item AVAILABLE |
| GET | `/api/products/:productId/stock-items/count` | Hitung stok tersedia |

### Slot Accounts & Slots (SLOT_ASSIGN)
| Method | Path | Keterangan |
|---|---|---|
| GET/POST | `/api/products/:productId/slot-accounts` | List / tambah akun induk |
| PUT/DELETE | `/api/products/:productId/slot-accounts/:accountId` | Update / hapus akun induk |
| GET/POST | `/api/products/:productId/slot-accounts/:accountId/slots` | List / tambah slot |
| PATCH | `/api/products/:productId/slots/:slotId/release` | Release slot (langganan habis) |

### Fulfillment Logs
| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/fulfillment-logs` | Daftar log (filter by status, date) |
| GET | `/api/fulfillment-logs/:orderId` | Detail log satu order |
| POST | `/api/fulfillment-logs/:orderId/retry` | Trigger retry manual untuk FAILED |

---

## Urutan Implementasi

1. **Database** — Tambah semua enum & model baru ke `schema.prisma`, tambah relasi ke model existing, jalankan `npm run db:migrate`.
2. **Core Engine** — Buat `fulfillmentEngine.js` dan `fulfillmentWorker.js`. Daftarkan worker di `index.js` dan tambahkan ke graceful shutdown.
3. **MANUAL Strategy** — Strategy paling sederhana. Buat `manualStrategy.js` + bagian admin notif di `fulfillmentNotifier.js`. Test end-to-end dari webhook → notif admin.
4. **STOCK_POOL Strategy** — Buat `stockPoolStrategy.js` + API stock-items. Gunakan `$queryRaw` dengan `FOR UPDATE SKIP LOCKED`. Test upload stok → order → item terambil.
5. **SLOT_ASSIGN Strategy** — Buat `slotAssignStrategy.js` + API slot-accounts & slots. Test setup akun+slot → order → slot terassign.
6. **API_EXTERNAL Strategy** — Buat `apiExternalStrategy.js`. Test dulu dengan `https://httpbin.org/post` sebelum koneksi ke supplier nyata.
7. **API Endpoints & Routes** — Buat semua controllers dan routes, daftarkan di `app.js`.

---

## Aturan Wajib untuk Agent

- **Enkripsi** — `apiCredentials` dan `SlotAccount.credentials` wajib menggunakan `encrypt()`/`decrypt()` dari `src/utils/encryption.js` yang sudah ada. Jangan buat mekanisme baru.
- **Multi-tenant scoping** — Setiap query DB wajib menyertakan filter `userId`.
- **`FOR UPDATE SKIP LOCKED`** — Wajib di `stockPoolStrategy` dan `slotAssignStrategy` via `prisma.$queryRaw`. Mencegah race condition saat order concurrent.
- **Idempotency** — Di awal setiap strategy, jika `log.status === 'SUCCESS'` atau `'SKIPPED'`, langsung return.
- **Jangan ubah kode existing** — `enqueueFulfillment` hanya ditambahkan di akhir payment success handler. Tidak ada kode lama yang dihapus.
- **Error propagation** — Jangan catch error di dalam strategy. Biarkan propagate ke worker agar BullMQ bisa retry.
- **Satu FulfillmentLog per Order** — Ambil `FulfillmentConfig` dari `OrderItem` pertama yang punya config aktif.