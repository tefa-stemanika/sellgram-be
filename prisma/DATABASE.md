# DATABASE.md — Dokumentasi Database

ORM: **Prisma**
Database: **MySQL / MariaDB**
Client singleton: `src/services/db.js`

---

## Schema Saat Ini

### `bot_config`
Konfigurasi umum bot — nilai non-sensitif.

| Kolom | Type | Default | Keterangan |
|---|---|---|---|
| id | Int PK | autoincrement | |
| ai_enabled | Boolean | false | Toggle AI mode (Gemini) vs Button UI |
| gemini_model | VarChar(50) | gemini-2.0-flash | Model Gemini yang digunakan |
| midtrans_is_production | Boolean | false | Sandbox vs Production |
| is_active | Boolean | true | Hanya row dengan is_active=true yang diambil |
| created_at | DateTime | now() | |
| updated_at | DateTime | auto | |

**Catatan:** Saat ini hanya ada 1 row (single-tenant). Saat M6, tambahkan `user_id FK`.

---

### `bot_credentials`
Credentials sensitif — **semua value tersimpan terenkripsi AES-256-GCM**.

| Kolom | Type | Keterangan |
|---|---|---|
| id | Int PK | |
| key | VarChar(100) UNIQUE | Nama credential |
| value | Text | Ciphertext: `"iv:authTag:ciphertext"` |
| created_at | DateTime | |
| updated_at | DateTime | |

**Keys yang tersimpan:**

| Key | Asal `.env` | Keterangan |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `TELEGRAM_BOT_TOKEN` | Token bot utama |
| `ADMIN_BOT_TOKEN` | `ADMIN_BOT_TOKEN` | Token bot admin notifikasi |
| `ADMIN_CHAT_ID` | `ADMIN_CHAT_ID` | Chat ID pemilik toko |
| `GEMINI_API_KEY` | `GEMINI_API_KEY` | Google AI Studio API key |
| `MIDTRANS_SERVER_KEY` | `MIDTRANS_SERVER_KEY` | Midtrans server key |
| `MIDTRANS_CLIENT_KEY` | `MIDTRANS_CLIENT_KEY` | Midtrans client key |

---

### `products`
Katalog produk yang dijual.

| Kolom | Type | Keterangan |
|---|---|---|
| id | Int PK | Digunakan sebagai product_id di order dan Gemini |
| name | VarChar(100) | Nama produk (max 50 char dikirim ke Midtrans) |
| description | Text | Deskripsi produk |
| price | Int | Harga dalam Rupiah (tanpa desimal) |
| emoji | VarChar(10) | Emoji untuk tampilan di bot |
| is_available | Boolean | false = tidak tampil di menu |
| created_at | DateTime | |
| updated_at | DateTime | |

---

### `orders`

| Kolom | Type | Keterangan |
|---|---|---|
| id | Int PK | |
| order_id | VarChar(30) UNIQUE | Format: `ORD-YYYYMMDD-XXXX` |
| telegram_id | BigInt | ID user Telegram (bisa sangat besar) |
| username | VarChar(100)? | Username Telegram (tanpa @) |
| first_name | VarChar(100)? | Nama depan user |
| total_price | Int | Total harga dalam Rupiah |
| status | Enum | Lihat tabel status di bawah |
| payment_url | Text? | URL halaman Snap Midtrans |
| qr_string | Text? | QR string (reserved, belum dipakai) |
| midtrans_order_id | VarChar(50)? UNIQUE | Sama dengan order_id (untuk lookup) |
| paid_at | DateTime? | Waktu pembayaran diterima dari webhook |
| created_at | DateTime | |
| updated_at | DateTime | |

**Status order:**

| Status | Kapan diset |
|---|---|
| `PENDING` | Default awal (belum dipakai aktif, langsung ke PAYMENT_PENDING) |
| `PAYMENT_PENDING` | Order dibuat, menunggu pembayaran |
| `CONFIRMED` | (reserved untuk konfirmasi manual admin) |
| `PROCESSING` | (reserved untuk proses pengiriman) |
| `COMPLETED` | Pembayaran diterima dari webhook Midtrans |
| `CANCELLED` | Order dibatalkan user |
| `PAYMENT_FAILED` | Pembayaran gagal/expired dari webhook Midtrans |

---

### `order_items`
Detail item per order. Saat ini 1 order = 1 item (belum multi-item).

| Kolom | Type | Keterangan |
|---|---|---|
| id | Int PK | |
| order_id | Int FK | Relasi ke `orders.id` |
| product_id | Int FK | Relasi ke `products.id` |
| quantity | Int | Jumlah yang dipesan |
| unit_price | Int | **Snapshot harga saat order dibuat** (bukan harga saat ini) |

**Penting:** `unit_price` adalah snapshot — harga produk bisa berubah, tapi invoice tetap mencatat harga asli saat order.

---

## Schema Target M6 (Multi-User)

```prisma
model User {
  id           Int      @id @default(autoincrement())
  email        String   @unique @db.VarChar(255)
  passwordHash String   @map("password_hash") @db.Text
  name         String   @db.VarChar(100)
  plan         UserPlan @default(FREE)
  isActive     Boolean  @default(true) @map("is_active")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  botConfig    BotConfig[]
  credentials  BotCredential[]
  products     Product[]
  orders       Order[]

  @@map("users")
}

// Tambah user_id ke semua tabel yang ada:
model BotConfig {
  // ... kolom yang ada ...
  userId    Int  @map("user_id")
  user      User @relation(fields: [userId], references: [id])
}

model BotCredential {
  // ... kolom yang ada ...
  userId    Int  @map("user_id")
  user      User @relation(fields: [userId], references: [id])
  // CATATAN: unique constraint berubah dari (key) ke (userId, key)
  @@unique([userId, key])
}

model Product {
  // ... kolom yang ada ...
  userId    Int  @map("user_id")
  user      User @relation(fields: [userId], references: [id])
}

model Order {
  // ... kolom yang ada ...
  userId    Int  @map("user_id")
  user      User @relation(fields: [userId], references: [id])
}

enum UserPlan {
  FREE
  STARTER
  PRO
}
```

---

## Query Patterns

### Ambil config aktif (single-tenant saat ini)
```js
const config = await prisma.botConfig.findFirst({
  where: { isActive: true },
  orderBy: { id: "asc" },
});
```

### Ambil semua credentials
```js
const creds = await prisma.botCredential.findMany();
// Lalu decrypt masing-masing value
```

### Simpan order baru
```js
const order = await prisma.order.create({
  data: {
    orderId,
    telegramId: BigInt(telegramId),  // perhatian: BigInt
    totalPrice,
    status: "PAYMENT_PENDING",
    orderItems: {
      create: { productId, quantity, unitPrice: product.price },
    },
  },
  include: {
    orderItems: { include: { product: true } },
  },
});
```

### Update status setelah webhook
```js
await prisma.order.update({
  where: { orderId },
  data: { status: "COMPLETED", paidAt: new Date() },
});
```

### Serialisasi BigInt
Prisma mengembalikan `telegramId` sebagai BigInt. Untuk kirim ke Telegram API atau JSON:
```js
const chatId = Number(order.telegramId);  // atau String(order.telegramId)
```

---

## npm Scripts Database

```bash
npm run db:push        # Push schema ke DB (tanpa migration history) — untuk dev
npm run db:generate    # Generate ulang Prisma client setelah schema berubah
npm run db:seed        # Isi data produk awal (dari prisma/seed.js)
npm run db:seed-config # Migrasi credentials dari .env ke DB (prisma/seed-config.js)
npm run db:studio      # Buka GUI Prisma Studio di http://localhost:5555
```
