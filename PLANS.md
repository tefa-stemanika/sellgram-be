# Customer Database — Backend Development Guide

Panduan pengembangan fitur Customer Database untuk Telegram Bot SaaS platform.  
Scope: backend only (Prisma schema, services, API endpoints, BullMQ integration).

---

## 1. Update Prisma Schema

### Tambah Model Customer

```prisma
// prisma/schema.prisma

model Customer {
  id           String    @id @default(uuid()) @db.Uuid
  userId       String    @map("user_id") @db.Uuid

  // ── Identifiers ──────────────────────────────────────────
  // Minimal salah satu harus diisi (enforced di service layer)
  telegramId   BigInt?   @map("telegram_id")
  email        String?   @db.VarChar(255)
  phone        String?   @db.VarChar(20)

  // ── Info ─────────────────────────────────────────────────
  name         String?   @db.VarChar(100)
  username     String?   @db.VarChar(100)   // Telegram username
  notes        String?   @db.Text           // catatan internal admin

  // ── Channel flags (untuk blast ke depan) ─────────────────
  // Apakah customer ini bisa dihubungi via channel tertentu
  hasTelegram  Boolean   @default(false) @map("has_telegram")
  hasWhatsapp  Boolean   @default(false) @map("has_whatsapp")
  hasEmail     Boolean   @default(false) @map("has_email")

  // ── Agregasi order (denormalized) ─────────────────────────
  firstOrderAt DateTime? @map("first_order_at")
  lastOrderAt  DateTime? @map("last_order_at")
  totalOrders  Int       @default(0) @map("total_orders")
  totalSpent   Int       @default(0) @map("total_spent") // IDR

  // ── Source ───────────────────────────────────────────────
  source       CustomerSource @default(ORDER)

  // ── Timestamps ───────────────────────────────────────────
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  orders       Order[]

  // Unique per tenant per identifier
  @@unique([userId, telegramId])
  @@unique([userId, email])
  @@unique([userId, phone])
  @@index([userId, lastOrderAt])
  @@index([userId, totalSpent])
  @@index([userId, source])
  @@map("customers")
}

enum CustomerSource {
  ORDER    // otomatis dari order masuk
  MANUAL   // dibuat manual oleh admin
  IMPORT   // dari CSV import (fase berikutnya)
}
```

### Update Model yang Sudah Ada

```prisma
model User {
  // ... existing fields
  customers  Customer[]
}

model Order {
  // ... existing fields
  customerId  String?   @map("customer_id") @db.Uuid
  customer    Customer? @relation(fields: [customerId], references: [id])
}
```

Setelah edit schema, jalankan:

```bash
npm run db:push
# atau jika pakai migration history:
npm run db:migrate
```

---

## 2. Struktur File Baru

```
src/
├── services/
│   └── customerService.js
├── api/
│   ├── controllers/
│   │   └── customerController.js
│   └── routes/
│       └── customerRoutes.js
scripts/
└── backfill-customers.js   # jalankan sekali untuk data lama
```

---

## 3. customerService.js

```js
// src/services/customerService.js
import prisma from '../utils/prisma.js'

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Tentukan where clause upsert berdasarkan identifier yang tersedia.
 * Prioritas: telegramId > phone > email
 */
function resolveIdentifier(userId, { telegramId, phone, email }) {
  if (telegramId)
    return { userId_telegramId: { userId, telegramId: BigInt(telegramId) } }
  if (phone) return { userId_phone: { userId, phone } }
  if (email) return { userId_email: { userId, email } }
  return null
}

/**
 * Validasi minimal satu identifier tersedia.
 */
function validateIdentifier({ telegramId, phone, email }) {
  if (!telegramId && !phone && !email) {
    throw new Error(
      'Minimal satu identifier harus diisi: telegramId, phone, atau email',
    )
  }
}

// ─────────────────────────────────────────────────────────────
// AUTO UPSERT — dipanggil dari BullMQ payment-success worker
// ─────────────────────────────────────────────────────────────

/**
 * Buat atau update customer dari data order yang baru selesai bayar.
 * Idempotent — aman dipanggil berulang kali untuk order yang sama.
 */
export async function upsertCustomerFromOrder(order, userId) {
  const {
    telegramId,
    customerPhone,
    customerName,
    firstName,
    username,
    totalPrice,
    createdAt,
  } = order

  const identifier = resolveIdentifier(userId, {
    telegramId,
    phone: customerPhone,
  })

  // Tidak ada identifier — skip, jangan buat customer
  if (!identifier) return null

  const customer = await prisma.customer.upsert({
    where: identifier,
    create: {
      userId,
      telegramId: telegramId ? BigInt(telegramId) : null,
      phone: customerPhone ?? null,
      name: customerName ?? firstName ?? null,
      username: username ?? null,
      source: 'ORDER',
      hasTelegram: !!telegramId,
      hasWhatsapp: !!customerPhone,
      firstOrderAt: createdAt,
      lastOrderAt: createdAt,
      totalOrders: 1,
      totalSpent: totalPrice,
    },
    update: {
      // Jangan overwrite nama yang sudah ada dengan null
      ...(customerName || firstName ? { name: customerName ?? firstName } : {}),
      // Update username Telegram jika ada yang baru
      ...(username ? { username } : {}),
      // Aktifkan channel flag jika belum
      ...(telegramId ? { hasTelegram: true } : {}),
      ...(customerPhone ? { hasWhatsapp: true } : {}),
      lastOrderAt: createdAt,
      totalOrders: { increment: 1 },
      totalSpent: { increment: totalPrice },
    },
  })

  // Hubungkan order ke customer
  await prisma.order.update({
    where: { id: order.id },
    data: { customerId: customer.id },
  })

  return customer
}

// ─────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────

/**
 * Query params yang didukung:
 * - search     : cari nama, username, email, phone
 * - source     : ORDER | MANUAL | IMPORT
 * - hasTelegram, hasWhatsapp, hasEmail : "true" | "false"
 * - sortBy     : createdAt | lastOrderAt | totalSpent | totalOrders (default: createdAt)
 * - sortDir    : asc | desc (default: desc)
 * - page, limit
 */
export async function getCustomers(userId, filters = {}) {
  const {
    search,
    source,
    hasTelegram,
    hasWhatsapp,
    hasEmail,
    sortBy = 'createdAt',
    sortDir = 'desc',
    page = 1,
    limit = 20,
  } = filters

  const ALLOWED_SORT = [
    'createdAt',
    'lastOrderAt',
    'totalSpent',
    'totalOrders',
    'name',
  ]
  const safeSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'createdAt'
  const safeSortDir = sortDir === 'asc' ? 'asc' : 'desc'

  const where = {
    userId,
    ...(source && { source }),
    ...(hasTelegram !== undefined && { hasTelegram: hasTelegram === 'true' }),
    ...(hasWhatsapp !== undefined && { hasWhatsapp: hasWhatsapp === 'true' }),
    ...(hasEmail !== undefined && { hasEmail: hasEmail === 'true' }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    }),
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { [safeSortBy]: safeSortDir },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        telegramId: true,
        hasTelegram: true,
        hasWhatsapp: true,
        hasEmail: true,
        source: true,
        totalOrders: true,
        totalSpent: true,
        lastOrderAt: true,
        createdAt: true,
      },
    }),
    prisma.customer.count({ where }),
  ])

  return {
    customers,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
  }
}

// ─────────────────────────────────────────────────────────────
// GET BY ID
// ─────────────────────────────────────────────────────────────

export async function getCustomerById(customerId, userId) {
  return prisma.customer.findFirst({
    where: { id: customerId, userId },
    include: {
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          orderId: true,
          source: true,
          status: true,
          totalPrice: true,
          paidAt: true,
          createdAt: true,
          orderItems: {
            include: {
              product: { select: { id: true, name: true, emoji: true } },
            },
          },
        },
      },
    },
  })
}

// ─────────────────────────────────────────────────────────────
// CREATE MANUAL
// ─────────────────────────────────────────────────────────────

/**
 * Dibuat manual oleh admin — untuk persiapan blast channel ke depan.
 * Minimal satu identifier harus diisi.
 */
export async function createCustomer(userId, data) {
  const { telegramId, email, phone, name, username, notes, hasWhatsapp } = data

  validateIdentifier({ telegramId, email, phone })

  // Cek duplikat manual
  await checkDuplicate(userId, { telegramId, email, phone })

  return prisma.customer.create({
    data: {
      userId,
      telegramId: telegramId ? BigInt(telegramId) : null,
      email: email ?? null,
      phone: phone ?? null,
      name: name ?? null,
      username: username ?? null,
      notes: notes ?? null,
      source: 'MANUAL',
      hasTelegram: !!telegramId,
      hasWhatsapp: hasWhatsapp ?? !!phone,
      hasEmail: !!email,
    },
  })
}

// ─────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────

/**
 * Update field yang tidak bisa diambil otomatis dari order:
 * email, notes, hasWhatsapp, hasEmail, name (koreksi manual)
 */
export async function updateCustomer(customerId, userId, data) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId },
  })
  if (!customer) throw new Error('Customer not found')

  const { email, phone, name, username, notes, hasWhatsapp, hasEmail } = data

  // Jika update email/phone, cek duplikat dulu
  if (email && email !== customer.email) {
    await checkDuplicate(userId, { email }, customerId)
  }
  if (phone && phone !== customer.phone) {
    await checkDuplicate(userId, { phone }, customerId)
  }

  return prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(name !== undefined && { name }),
      ...(username !== undefined && { username }),
      ...(email !== undefined && { email, hasEmail: !!email }),
      ...(phone !== undefined && { phone }),
      ...(notes !== undefined && { notes }),
      ...(hasWhatsapp !== undefined && { hasWhatsapp }),
      ...(hasEmail !== undefined && { hasEmail }),
    },
  })
}

// ─────────────────────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────────────────────

export async function deleteCustomer(customerId, userId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId },
  })
  if (!customer) throw new Error('Customer not found')

  // Putus relasi ke orders sebelum hapus
  await prisma.order.updateMany({
    where: { customerId },
    data: { customerId: null },
  })

  return prisma.customer.delete({ where: { id: customerId } })
}

// ─────────────────────────────────────────────────────────────
// HELPER — cek duplikat
// ─────────────────────────────────────────────────────────────

async function checkDuplicate(
  userId,
  { telegramId, email, phone },
  excludeId = null,
) {
  const checks = []

  if (telegramId) checks.push({ userId, telegramId: BigInt(telegramId) })
  if (email) checks.push({ userId, email })
  if (phone) checks.push({ userId, phone })

  for (const condition of checks) {
    const existing = await prisma.customer.findFirst({
      where: {
        ...condition,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    })
    if (existing) {
      const field = Object.keys(condition).find((k) => k !== 'userId')
      throw new Error(`Customer dengan ${field} ini sudah terdaftar`)
    }
  }
}
```

---

## 4. customerController.js

```js
// src/api/controllers/customerController.js
import { ok, fail } from '../utils/response.js'
import * as customerService from '../../services/customerService.js'

export async function listCustomers(req, res) {
  try {
    const result = await customerService.getCustomers(req.user.id, req.query)
    return ok(res, result)
  } catch (e) {
    return fail(res, e.message)
  }
}

export async function getCustomer(req, res) {
  try {
    const customer = await customerService.getCustomerById(
      req.params.customerId,
      req.user.id,
    )
    if (!customer) return fail(res, 'Customer not found', 404)
    return ok(res, customer)
  } catch (e) {
    return fail(res, e.message)
  }
}

export async function createCustomer(req, res) {
  try {
    const customer = await customerService.createCustomer(req.user.id, req.body)
    return ok(res, customer, 201)
  } catch (e) {
    // Tangkap error duplikat dari Prisma unique constraint
    if (e.code === 'P2002' || e.message.includes('sudah terdaftar')) {
      return fail(res, e.message, 409)
    }
    return fail(res, e.message)
  }
}

export async function updateCustomer(req, res) {
  try {
    const customer = await customerService.updateCustomer(
      req.params.customerId,
      req.user.id,
      req.body,
    )
    return ok(res, customer)
  } catch (e) {
    if (e.code === 'P2002' || e.message.includes('sudah terdaftar')) {
      return fail(res, e.message, 409)
    }
    return fail(res, e.message)
  }
}

export async function deleteCustomer(req, res) {
  try {
    await customerService.deleteCustomer(req.params.customerId, req.user.id)
    return ok(res, { message: 'Customer deleted' })
  } catch (e) {
    return fail(res, e.message)
  }
}
```

---

## 5. customerRoutes.js

```js
// src/api/routes/customerRoutes.js
import { Router } from 'express'
import { authenticate } from '../middlewares/auth.js'
import * as cc from '../controllers/customerController.js'

const router = Router()
router.use(authenticate)

router.get('/', cc.listCustomers)
router.post('/', cc.createCustomer)
router.get('/:customerId', cc.getCustomer)
router.patch('/:customerId', cc.updateCustomer)
router.delete('/:customerId', cc.deleteCustomer)

export default router
```

---

## 6. Register Route di app.js

```js
// src/app.js
import customerRoutes from './api/routes/customerRoutes.js'

// ... existing routes
app.use('/api/customers', customerRoutes)
```

---

## 7. Integrasi BullMQ — Auto Upsert dari Order

Edit payment-success worker yang sudah ada:

```js
// Di dalam handlePaymentSuccess(job)
import { upsertCustomerFromOrder } from '../customerService.js'

async function handlePaymentSuccess(job) {
  const { orderId, userId } = job.data

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { orderItems: { include: { product: true } } },
  })

  // Existing
  await sendBuyerNotification(order)
  await sendAdminNotification(order)
  await createTicketFromOrder(order, userId) // sudah ada

  // NEW
  await upsertCustomerFromOrder(order, userId)
}
```

---

## 8. Backfill Data Lama

Jalankan **sekali** untuk mengisi tabel `customers` dari data `orders` yang sudah ada:

```js
// scripts/backfill-customers.js
import prisma from '../src/utils/prisma.js'
import { upsertCustomerFromOrder } from '../src/services/customerService.js'

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: 'COMPLETED',
      customerId: null, // hanya yang belum punya customer
    },
    orderBy: { createdAt: 'asc' }, // asc agar firstOrderAt akurat
  })

  console.log(`Backfilling ${orders.length} orders...`)

  let success = 0
  let skipped = 0

  for (const order of orders) {
    const result = await upsertCustomerFromOrder(order, order.userId)
    if (result) success++
    else skipped++
  }

  console.log(`Done. Success: ${success}, Skipped (no identifier): ${skipped}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

Jalankan:

```bash
node scripts/backfill-customers.js
```

---

## 9. Ringkasan Endpoint

| Method   | Path                 | Fungsi                 | Query Params                                                                                       |
| -------- | -------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/customers`     | List customer          | `search`, `source`, `hasTelegram`, `hasWhatsapp`, `hasEmail`, `sortBy`, `sortDir`, `page`, `limit` |
| `POST`   | `/api/customers`     | Buat customer manual   | —                                                                                                  |
| `GET`    | `/api/customers/:id` | Detail + history order | —                                                                                                  |
| `PATCH`  | `/api/customers/:id` | Update data customer   | —                                                                                                  |
| `DELETE` | `/api/customers/:id` | Hapus customer         | —                                                                                                  |

### Contoh Request Body POST `/api/customers`

```json
{
  "name": "Budi Santoso",
  "phone": "08123456789",
  "email": "budi@gmail.com",
  "telegramId": "123456789",
  "username": "budisantoso",
  "notes": "Customer VIP, selalu perpanjang tiap bulan",
  "hasWhatsapp": true
}
```

Minimal satu dari `telegramId`, `phone`, atau `email` harus diisi.

### Contoh Request Body PATCH `/api/customers/:id`

```json
{
  "email": "budi.baru@gmail.com",
  "notes": "Sudah pindah nomor WA",
  "hasWhatsapp": false
}
```

Semua field opsional — hanya field yang dikirim yang akan diupdate.

---

## 10. Catatan untuk Fitur Blast ke Depan

Field `hasTelegram`, `hasWhatsapp`, dan `hasEmail` sengaja didesain sebagai flag boolean agar nanti query target blast mudah:

```js
// Contoh query untuk blast Telegram
const targets = await prisma.customer.findMany({
  where: { userId, hasTelegram: true },
  select: { telegramId: true, name: true },
})

// Contoh query untuk blast WhatsApp
const targets = await prisma.customer.findMany({
  where: { userId, hasWhatsapp: true },
  select: { phone: true, name: true },
})
```

---

## 11. Urutan Implementasi

1. **Update schema** — tambah model `Customer` dan update `Order`, jalankan `db:push`
2. **customerService.js** — buat semua fungsi
3. **customerController.js** + **customerRoutes.js**
4. **Register route** di `app.js`
5. **Integrasi BullMQ** — tambah `upsertCustomerFromOrder` di payment-success worker
6. **Backfill** — jalankan `scripts/backfill-customers.js` untuk data lama
7. **Test** — buat order baru → bayar → cek customer terbuat otomatis
