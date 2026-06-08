# Stock Management & Customer Auth — Backend Development Guide

Panduan pengembangan dua fitur:

1. **Stock Management** — stok produk dengan konfigurasi oversell per produk
2. **Customer Auth** — login portal customer per tenant (email + password)

---

## BAGIAN 1 — STOCK MANAGEMENT

---

### 1.1 Update Prisma Schema — Model Product

Tambah field stok ke model `Product` yang sudah ada:

```prisma
model Product {
  id           String   @id @default(uuid()) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  name         String   @db.VarChar(100)
  description  String   @db.Text
  price        Int
  emoji        String   @db.VarChar(10) @default("🛍️")
  isAvailable  Boolean  @default(true) @map("is_available")

  // ── Stock fields (NEW) ──────────────────────────────────
  stock        Int      @default(0)              // stok saat ini
  stockEnabled Boolean  @default(false) @map("stock_enabled") // false = tidak tracking stok (unlimited)
  allowOversell Boolean @default(false) @map("allow_oversell") // true = boleh order walau stok 0
  lowStockAlert Int     @default(5) @map("low_stock_alert")   // notif admin jika stok <= nilai ini

  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  orderItems   OrderItem[]
  stockLogs    StockLog[]   // NEW

  @@map("products")
}
```

### 1.2 Tambah Model StockLog

Audit trail setiap perubahan stok:

```prisma
model StockLog {
  id         String        @id @default(uuid()) @db.Uuid
  productId  String        @map("product_id") @db.Uuid
  userId     String        @map("user_id") @db.Uuid
  orderId    String?       @map("order_id") @db.Uuid  // null jika adjustment manual
  type       StockLogType
  delta      Int           // positif = tambah, negatif = kurang
  stockAfter Int           @map("stock_after")        // snapshot stok setelah perubahan
  note       String?       @db.VarChar(255)
  createdAt  DateTime      @default(now()) @map("created_at")

  product    Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId, createdAt])
  @@map("stock_logs")
}

enum StockLogType {
  SALE          // berkurang karena order
  REFUND        // bertambah karena order gagal/cancel
  RESTOCK       // ditambah manual oleh admin
  ADJUSTMENT    // koreksi manual (bisa + atau -)
}
```

Jalankan setelah update schema:

```bash
npm run db:push
```

---

### 1.3 stockService.js

```js
// src/services/stockService.js
import prisma from '../utils/prisma.js'

// ─────────────────────────────────────────────────────────────
// VALIDASI STOK — dipanggil sebelum order dibuat
// ─────────────────────────────────────────────────────────────

/**
 * Validasi stok untuk semua item dalam cart.
 * Melempar error jika ada produk yang stoknya tidak cukup
 * dan allowOversell = false.
 *
 * @param {Array} items - [{ productId, quantity }]
 * @param {string} userId - tenant id
 */
export async function validateStock(items, userId) {
  const productIds = items.map((i) => i.productId)

  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, userId },
    select: {
      id: true,
      name: true,
      stock: true,
      stockEnabled: true,
      allowOversell: true,
      isAvailable: true,
    },
  })

  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))
  const errors = []

  for (const item of items) {
    const product = productMap[item.productId]

    if (!product) {
      errors.push(`Produk tidak ditemukan`)
      continue
    }

    if (!product.isAvailable) {
      errors.push(`Produk "${product.name}" tidak tersedia`)
      continue
    }

    // Jika stockEnabled = false, skip pengecekan stok (unlimited)
    if (!product.stockEnabled) continue

    if (product.stock < item.quantity && !product.allowOversell) {
      errors.push(
        `Stok "${product.name}" tidak cukup. Tersedia: ${product.stock}, diminta: ${item.quantity}`,
      )
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '))
  }
}

// ─────────────────────────────────────────────────────────────
// KURANGI STOK — dipanggil saat order COMPLETED (payment success)
// ─────────────────────────────────────────────────────────────

/**
 * Kurangi stok untuk semua item dalam order.
 * Menggunakan transaction untuk konsistensi data.
 *
 * @param {string} orderId
 * @param {string} userId
 */
export async function deductStock(orderId, userId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      orderItems: {
        include: { product: true },
      },
    },
  })

  if (!order) throw new Error('Order not found')

  // Filter hanya produk yang stockEnabled
  const itemsToDeduct = order.orderItems.filter(
    (item) => item.product.stockEnabled,
  )
  if (itemsToDeduct.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const item of itemsToDeduct) {
      const updated = await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      })

      await tx.stockLog.create({
        data: {
          productId: item.productId,
          userId,
          orderId,
          type: 'SALE',
          delta: -item.quantity,
          stockAfter: updated.stock,
          note: `Order ${order.orderId}`,
        },
      })

      // Cek low stock alert
      await checkLowStockAlert(tx, updated, userId)
    }
  })
}

// ─────────────────────────────────────────────────────────────
// KEMBALIKAN STOK — dipanggil saat order CANCELLED / PAYMENT_FAILED
// ─────────────────────────────────────────────────────────────

export async function refundStock(orderId, userId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      orderItems: {
        include: { product: true },
      },
    },
  })

  if (!order) throw new Error('Order not found')

  const itemsToRefund = order.orderItems.filter(
    (item) => item.product.stockEnabled,
  )
  if (itemsToRefund.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const item of itemsToRefund) {
      const updated = await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      })

      await tx.stockLog.create({
        data: {
          productId: item.productId,
          userId,
          orderId,
          type: 'REFUND',
          delta: item.quantity,
          stockAfter: updated.stock,
          note: `Refund order ${order.orderId}`,
        },
      })
    }
  })
}

// ─────────────────────────────────────────────────────────────
// RESTOCK MANUAL — dipanggil dari dashboard admin
// ─────────────────────────────────────────────────────────────

/**
 * @param {string} productId
 * @param {string} userId
 * @param {number} quantity - jumlah yang ditambah
 * @param {string} note - opsional
 */
export async function restockProduct(productId, userId, quantity, note = null) {
  const product = await prisma.product.findFirst({
    where: { id: productId, userId },
  })
  if (!product) throw new Error('Product not found')
  if (quantity <= 0) throw new Error('Quantity harus lebih dari 0')

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: { increment: quantity } },
    })

    await tx.stockLog.create({
      data: {
        productId,
        userId,
        type: 'RESTOCK',
        delta: quantity,
        stockAfter: updated.stock,
        note: note ?? `Restock manual +${quantity}`,
      },
    })

    return updated
  })
}

/**
 * Koreksi stok — set ke nilai tertentu (bukan increment)
 */
export async function adjustStock(productId, userId, newStock, note = null) {
  const product = await prisma.product.findFirst({
    where: { id: productId, userId },
  })
  if (!product) throw new Error('Product not found')
  if (newStock < 0) throw new Error('Stok tidak boleh negatif')

  const delta = newStock - product.stock

  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: { stock: newStock },
    })

    await tx.stockLog.create({
      data: {
        productId,
        userId,
        type: 'ADJUSTMENT',
        delta,
        stockAfter: updated.stock,
        note: note ?? `Adjustment stok ke ${newStock}`,
      },
    })

    return updated
  })
}

// ─────────────────────────────────────────────────────────────
// GET STOCK LOGS
// ─────────────────────────────────────────────────────────────

export async function getStockLogs(
  productId,
  userId,
  { page = 1, limit = 20 } = {},
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, userId },
  })
  if (!product) throw new Error('Product not found')

  const [logs, total] = await Promise.all([
    prisma.stockLog.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    }),
    prisma.stockLog.count({ where: { productId } }),
  ])

  return {
    logs,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER — low stock alert via admin bot
// ─────────────────────────────────────────────────────────────

async function checkLowStockAlert(tx, product, userId) {
  if (!product.stockEnabled) return
  if (product.stock > product.lowStockAlert) return

  // Ambil admin bot credentials untuk kirim notif
  // Reuse pola adminNotifBot yang sudah ada di project
  try {
    const { sendAdminBotMessage } = await import('./adminNotifService.js')
    await sendAdminBotMessage(
      userId,
      `⚠️ *Stok Menipis!*\n\nProduk: *${product.name}*\nSisa stok: *${product.stock}*\n\nSegera lakukan restock.`,
    )
  } catch (e) {
    // Jangan gagalkan transaksi hanya karena notif gagal
    console.error('[StockAlert] Failed to send low stock alert:', e.message)
  }
}
```

---

### 1.4 Integrasi ke Order Flow

**A. Saat order dibuat — validasi stok**

```js
// src/services/orderService.js (atau di handler yang membuat order)
import { validateStock } from './stockService.js'

// Tambahkan sebelum saveOrder()
await validateStock(
  orderItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
  userId,
)
// Jika stok tidak cukup dan allowOversell = false, function ini throw Error
// Error akan tertangkap di handler dan dikirim sebagai pesan ke customer
```

**B. Saat payment success — kurangi stok**

```js
// Di dalam handlePaymentSuccess(job) di worker
import { deductStock } from '../stockService.js'

async function handlePaymentSuccess(job) {
  const { orderId, userId } = job.data
  // ... existing code ...

  await upsertCustomerFromOrder(order, userId)
  await createTicketFromOrder(order, userId)
  await deductStock(orderId, userId) // NEW
}
```

**C. Saat payment failed / order cancelled — kembalikan stok**

```js
// Di dalam handlePaymentFailed(job) atau handler cancel order
import { refundStock } from '../stockService.js'

await refundStock(orderId, userId)
```

---

### 1.5 Endpoint Stock Management

Tambah ke product routes atau buat routes terpisah:

```js
// src/api/routes/productRoutes.js — tambahkan endpoint berikut

// Restock manual
router.post('/:productId/restock', async (req, res) => {
  try {
    const { quantity, note } = req.body
    const product = await stockService.restockProduct(
      req.params.productId,
      req.user.id,
      quantity,
      note,
    )
    return ok(res, product)
  } catch (e) {
    return fail(res, e.message)
  }
})

// Adjustment stok (set ke nilai tertentu)
router.patch('/:productId/stock', async (req, res) => {
  try {
    const { stock, note } = req.body
    const product = await stockService.adjustStock(
      req.params.productId,
      req.user.id,
      stock,
      note,
    )
    return ok(res, product)
  } catch (e) {
    return fail(res, e.message)
  }
})

// Log perubahan stok
router.get('/:productId/stock-logs', async (req, res) => {
  try {
    const logs = await stockService.getStockLogs(
      req.params.productId,
      req.user.id,
      req.query,
    )
    return ok(res, logs)
  } catch (e) {
    return fail(res, e.message)
  }
})
```

---

## BAGIAN 2 — CUSTOMER AUTH (LOGIN PORTAL)

---

### 2.1 Konsep Arsitektur

```
Platform (kamu)
  └── Tenant A (reseller Budi)
        └── Customer Portal → login → lihat order milik Budi saja
  └── Tenant B (reseller Ani)
        └── Customer Portal → login → lihat order milik Ani saja
```

- Customer auth **scoped per tenant** via `userId` di setiap token dan query
- JWT customer **berbeda** dengan JWT admin/tenant — pakai `type: 'customer'` di payload
- Endpoint customer auth di bawah `/api/portal/:userId/...` agar jelas konteks tenant-nya

---

### 2.2 Update Prisma Schema — Model CustomerAuth

Pisahkan credential auth dari model `Customer` agar tetap clean:

```prisma
model CustomerAuth {
  id              String    @id @default(uuid()) @db.Uuid
  customerId      String    @unique @map("customer_id") @db.Uuid
  userId          String    @map("user_id") @db.Uuid   // tenant scope
  email           String    @db.VarChar(255)
  passwordHash    String    @map("password_hash") @db.Text
  isVerified      Boolean   @default(false) @map("is_verified")  // untuk email verify ke depan
  lastLoginAt     DateTime? @map("last_login_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  customer        Customer  @relation(fields: [customerId], references: [id], onDelete: Cascade)

  @@unique([userId, email])  // email unik per tenant
  @@map("customer_auth")
}
```

Tambah relasi balik ke `Customer`:

```prisma
model Customer {
  // ... existing fields
  auth    CustomerAuth?
}
```

Jalankan:

```bash
npm run db:push
```

---

### 2.3 Struktur File Baru

```
src/
├── services/
│   └── customerAuthService.js
├── api/
│   ├── controllers/
│   │   └── customerAuthController.js
│   ├── middlewares/
│   │   └── customerAuth.js        // middleware verify JWT customer
│   └── routes/
│       └── customerPortalRoutes.js
```

---

### 2.4 customerAuthService.js

```js
// src/services/customerAuthService.js
import prisma from '../utils/prisma.js'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const SALT_ROUNDS = 10
const TOKEN_EXPIRY = '30d' // customer token lebih panjang dari admin

// ─────────────────────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────────────────────

/**
 * Register customer baru di portal tenant tertentu.
 * Buat Customer + CustomerAuth sekaligus jika belum ada.
 */
export async function registerCustomer(
  tenantId,
  { email, password, name, phone },
) {
  if (!email || !password) throw new Error('Email dan password wajib diisi')
  if (password.length < 6) throw new Error('Password minimal 6 karakter')

  // Cek apakah email sudah terdaftar di tenant ini
  const existingAuth = await prisma.customerAuth.findUnique({
    where: { userId_email: { userId: tenantId, email } },
  })
  if (existingAuth) throw new Error('Email sudah terdaftar')

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

  // Cek apakah customer dengan email ini sudah ada (dari order sebelumnya)
  let customer = await prisma.customer.findFirst({
    where: { userId: tenantId, email },
  })

  const result = await prisma.$transaction(async (tx) => {
    if (!customer) {
      // Buat customer baru
      customer = await tx.customer.create({
        data: {
          userId: tenantId,
          email,
          name: name ?? null,
          phone: phone ?? null,
          hasEmail: true,
          source: 'MANUAL',
        },
      })
    } else {
      // Update customer yang sudah ada dengan info tambahan
      customer = await tx.customer.update({
        where: { id: customer.id },
        data: {
          ...(name ? { name } : {}),
          ...(phone ? { phone, hasWhatsapp: true } : {}),
          hasEmail: true,
        },
      })
    }

    const auth = await tx.customerAuth.create({
      data: {
        customerId: customer.id,
        userId: tenantId,
        email,
        passwordHash,
        isVerified: true, // langsung verified, tanpa email verify untuk sekarang
      },
    })

    return { customer, auth }
  })

  const token = generateToken(result.customer, tenantId)
  return { customer: sanitizeCustomer(result.customer), token }
}

// ─────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────

export async function loginCustomer(tenantId, { email, password }) {
  if (!email || !password) throw new Error('Email dan password wajib diisi')

  const auth = await prisma.customerAuth.findUnique({
    where: { userId_email: { userId: tenantId, email } },
    include: { customer: true },
  })

  if (!auth) throw new Error('Email atau password salah')

  const isMatch = await bcrypt.compare(password, auth.passwordHash)
  if (!isMatch) throw new Error('Email atau password salah')

  // Update lastLoginAt
  await prisma.customerAuth.update({
    where: { id: auth.id },
    data: { lastLoginAt: new Date() },
  })

  const token = generateToken(auth.customer, tenantId)
  return { customer: sanitizeCustomer(auth.customer), token }
}

// ─────────────────────────────────────────────────────────────
// GET PROFILE
// ─────────────────────────────────────────────────────────────

export async function getCustomerProfile(customerId, tenantId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, userId: tenantId },
    include: {
      auth: { select: { email: true, lastLoginAt: true, isVerified: true } },
    },
  })
  if (!customer) throw new Error('Customer not found')
  return sanitizeCustomer(customer)
}

// ─────────────────────────────────────────────────────────────
// UPDATE PROFILE
// ─────────────────────────────────────────────────────────────

export async function updateCustomerProfile(
  customerId,
  tenantId,
  { name, phone },
) {
  return prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(name !== undefined && { name }),
      ...(phone !== undefined && { phone, hasWhatsapp: !!phone }),
    },
  })
}

// ─────────────────────────────────────────────────────────────
// CHANGE PASSWORD
// ─────────────────────────────────────────────────────────────

export async function changePassword(
  customerId,
  tenantId,
  { oldPassword, newPassword },
) {
  if (newPassword.length < 6)
    throw new Error('Password baru minimal 6 karakter')

  const auth = await prisma.customerAuth.findUnique({
    where: { customerId },
  })
  if (!auth) throw new Error('Auth not found')

  const isMatch = await bcrypt.compare(oldPassword, auth.passwordHash)
  if (!isMatch) throw new Error('Password lama salah')

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)
  await prisma.customerAuth.update({
    where: { id: auth.id },
    data: { passwordHash },
  })

  return { message: 'Password berhasil diubah' }
}

// ─────────────────────────────────────────────────────────────
// ORDER HISTORY
// ─────────────────────────────────────────────────────────────

export async function getCustomerOrders(
  customerId,
  tenantId,
  { page = 1, limit = 10 } = {},
) {
  const where = { customerId, userId: tenantId }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
      select: {
        id: true,
        orderId: true,
        source: true,
        status: true,
        totalPrice: true,
        paymentUrl: true,
        paidAt: true,
        createdAt: true,
        orderItems: {
          include: {
            product: {
              select: { id: true, name: true, emoji: true, price: true },
            },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ])

  return {
    orders,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / Number(limit)),
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function generateToken(customer, tenantId) {
  return jwt.sign(
    {
      sub: customer.id,
      tenantId,
      type: 'customer', // penting: bedakan dari token admin
    },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY },
  )
}

function sanitizeCustomer(customer) {
  // Jangan expose passwordHash atau field sensitif
  const { ...safe } = customer
  if (safe.auth) {
    delete safe.auth.passwordHash
  }
  return safe
}
```

---

### 2.5 Middleware Customer Auth

```js
// src/api/middlewares/customerAuth.js
import jwt from 'jsonwebtoken'
import { fail } from '../utils/response.js'

/**
 * Middleware untuk endpoint customer portal.
 * Memastikan token valid, bertipe 'customer', dan tenantId cocok.
 */
export function authenticateCustomer(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return fail(res, 'Unauthorized', 401)
  }

  const token = authHeader.slice(7)

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)

    // Pastikan ini token customer, bukan token admin yang masuk ke portal
    if (payload.type !== 'customer') {
      return fail(res, 'Unauthorized', 401)
    }

    // Pastikan tenantId di token cocok dengan :userId di URL
    if (payload.tenantId !== req.params.userId) {
      return fail(res, 'Forbidden', 403)
    }

    req.customer = { id: payload.sub }
    req.tenantId = payload.tenantId
    next()
  } catch (e) {
    return fail(res, 'Token tidak valid atau sudah expired', 401)
  }
}
```

---

### 2.6 customerAuthController.js

```js
// src/api/controllers/customerAuthController.js
import { ok, fail } from '../utils/response.js'
import * as authService from '../../services/customerAuthService.js'

export async function register(req, res) {
  try {
    const result = await authService.registerCustomer(
      req.params.userId,
      req.body,
    )
    return ok(res, result, 201)
  } catch (e) {
    const status = e.message.includes('sudah terdaftar') ? 409 : 400
    return fail(res, e.message, status)
  }
}

export async function login(req, res) {
  try {
    const result = await authService.loginCustomer(req.params.userId, req.body)
    return ok(res, result)
  } catch (e) {
    return fail(res, e.message, 401)
  }
}

export async function getProfile(req, res) {
  try {
    const profile = await authService.getCustomerProfile(
      req.customer.id,
      req.tenantId,
    )
    return ok(res, profile)
  } catch (e) {
    return fail(res, e.message)
  }
}

export async function updateProfile(req, res) {
  try {
    const updated = await authService.updateCustomerProfile(
      req.customer.id,
      req.tenantId,
      req.body,
    )
    return ok(res, updated)
  } catch (e) {
    return fail(res, e.message)
  }
}

export async function updatePassword(req, res) {
  try {
    const result = await authService.changePassword(
      req.customer.id,
      req.tenantId,
      req.body,
    )
    return ok(res, result)
  } catch (e) {
    return fail(res, e.message, 400)
  }
}

export async function getOrders(req, res) {
  try {
    const result = await authService.getCustomerOrders(
      req.customer.id,
      req.tenantId,
      req.query,
    )
    return ok(res, result)
  } catch (e) {
    return fail(res, e.message)
  }
}

export async function getOrderDetail(req, res) {
  try {
    // Pastikan order ini milik customer yang login
    const order = await prisma.order.findFirst({
      where: {
        id: req.params.orderId,
        customerId: req.customer.id,
        userId: req.tenantId,
      },
      include: {
        orderItems: {
          include: { product: true },
        },
      },
    })
    if (!order) return fail(res, 'Order not found', 404)
    return ok(res, order)
  } catch (e) {
    return fail(res, e.message)
  }
}
```

---

### 2.7 customerPortalRoutes.js

```js
// src/api/routes/customerPortalRoutes.js
import { Router } from 'express'
import { authenticateCustomer } from '../middlewares/customerAuth.js'
import * as ctrl from '../controllers/customerAuthController.js'

const router = Router({ mergeParams: true }) // penting untuk akses :userId dari parent route

// ── Public (no auth) ─────────────────────────────────────────
router.post('/register', ctrl.register)
router.post('/login', ctrl.login)

// ── Protected (requires customer JWT) ────────────────────────
router.use(authenticateCustomer)

router.get('/me', ctrl.getProfile)
router.patch('/me', ctrl.updateProfile)
router.patch('/me/password', ctrl.updatePassword)
router.get('/me/orders', ctrl.getOrders)
router.get('/me/orders/:orderId', ctrl.getOrderDetail)

export default router
```

---

### 2.8 Register Route di app.js

```js
// src/app.js
import customerPortalRoutes from './api/routes/customerPortalRoutes.js'

// Letakkan di bagian public routes (sebelum authenticate middleware global jika ada)
// :userId di sini adalah tenantId — portal customer milik tenant tertentu
app.use('/api/portal/:userId', customerPortalRoutes)
```

---

## Ringkasan Semua Endpoint Baru

### Stock Management

| Method  | Path                           | Auth      | Fungsi                     |
| ------- | ------------------------------ | --------- | -------------------------- |
| `POST`  | `/api/products/:id/restock`    | Admin JWT | Tambah stok manual         |
| `PATCH` | `/api/products/:id/stock`      | Admin JWT | Set stok ke nilai tertentu |
| `GET`   | `/api/products/:id/stock-logs` | Admin JWT | Log perubahan stok         |

### Customer Portal (scoped per tenant via `:userId`)

| Method  | Path                                     | Auth         | Fungsi            |
| ------- | ---------------------------------------- | ------------ | ----------------- |
| `POST`  | `/api/portal/:userId/register`           | Public       | Register customer |
| `POST`  | `/api/portal/:userId/login`              | Public       | Login customer    |
| `GET`   | `/api/portal/:userId/me`                 | Customer JWT | Profil customer   |
| `PATCH` | `/api/portal/:userId/me`                 | Customer JWT | Update profil     |
| `PATCH` | `/api/portal/:userId/me/password`        | Customer JWT | Ganti password    |
| `GET`   | `/api/portal/:userId/me/orders`          | Customer JWT | History order     |
| `GET`   | `/api/portal/:userId/me/orders/:orderId` | Customer JWT | Detail order      |

---

## Urutan Implementasi

**Stock Management:**

1. Update schema `Product` + tambah `StockLog` model → `db:push`
2. Buat `stockService.js`
3. Integrasi `validateStock` ke order creation flow
4. Integrasi `deductStock` ke payment-success worker
5. Integrasi `refundStock` ke payment-failed / cancel handler
6. Tambah endpoints restock & stock-logs ke product routes

**Customer Auth:**

1. Tambah `CustomerAuth` model ke schema → `db:push`
2. Buat `customerAuthService.js`
3. Buat middleware `customerAuth.js`
4. Buat `customerAuthController.js` + `customerPortalRoutes.js`
5. Register route di `app.js`
6. Test: register → login → get orders

> **Catatan:** Implementasi Stock Management lebih dulu karena tidak ada dependency ke Customer Auth, dan dampaknya lebih langsung ke bisnis tenant.
