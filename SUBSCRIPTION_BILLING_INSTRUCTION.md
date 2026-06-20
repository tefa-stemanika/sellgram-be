# Subscription & Billing System — Implementation Guide

## Goals

Mengaktifkan monetisasi platform dengan meng-enforce plan limits (FREE/STARTER/PRO) yang sudah ada di schema `User`, menambahkan lifecycle subscription (aktif → jatuh tempo → nonaktif), dan sistem invoice/pembayaran renewal via Midtrans. Tanpa fitur ini, semua tenant bisa pakai platform tanpa batas dan tanpa charge.

---

## Konsep Bisnis

| Plan | Harga | Bot Config | Produk | Broadcast | Fulfillment |
|---|---|---|---|---|---|
| FREE | Gratis | 1 | 10 | ❌ | ❌ |
| STARTER | Rp 99.000/bln | 3 | 50 | ✅ | ✅ |
| PRO | Rp 299.000/bln | 10 | Unlimited | ✅ | ✅ |

> Nilai harga dan limit di atas adalah placeholder — sesuaikan dengan keputusan bisnis. Yang penting arsitekturnya fleksibel.

**FREE plan tidak butuh subscription** — langsung aktif saat register, tidak ada expiry.

---

## Lifecycle Subscription

```
Register → FREE (tidak ada Subscription record)

Upgrade ke STARTER/PRO:
  → buat Invoice (PENDING)
  → tenant bayar via Midtrans
  → webhook settlement → buat/perpanjang Subscription (ACTIVE)
  → update User.plan

H-3 sebelum expired → kirim reminder via admin bot + email (opsional)
H-0 (expired) → cron job → set Subscription.status = EXPIRED
                          → set User.plan = FREE
                          → matikan fitur berbayar (enforcement di middleware)

Grace period 3 hari → bot masih jalan tapi semua API admin return warning
Setelah grace period → bot dinonaktifkan (BotConfig.isActive = false)
```

---

## Database Schema

### Enum Baru

```prisma
enum SubscriptionStatus {
  ACTIVE       // Aktif, dalam masa berlaku
  EXPIRED      // Sudah lewat currentPeriodEnd, masih dalam grace period
  CANCELLED    // Dibatalkan sebelum expired
  PAST_DUE     // Grace period habis — akses diblokir
}

enum InvoiceStatus {
  PENDING      // Menunggu pembayaran
  PAID         // Sudah dibayar
  EXPIRED      // Tidak dibayar sampai batas waktu (24 jam)
  CANCELLED    // Dibatalkan manual
}

enum PlanInterval {
  MONTHLY
  YEARLY       // Opsional, bisa diaktifkan nanti
}
```

---

### Model: `Subscription`

```prisma
model Subscription {
  id                  String             @id @default(uuid())
  userId              String             @unique  // 1-to-1 dengan User — satu subscription aktif
  plan                UserPlan           // STARTER atau PRO (FREE tidak punya record ini)
  status              SubscriptionStatus @default(ACTIVE)
  interval            PlanInterval       @default(MONTHLY)

  currentPeriodStart  DateTime           // Kapan periode ini dimulai
  currentPeriodEnd    DateTime           // Kapan periode ini berakhir (tanggal jatuh tempo)
  gracePeriodEnd      DateTime           // currentPeriodEnd + 3 hari

  cancelledAt         DateTime?          // Diisi jika status = CANCELLED
  cancelReason        String?

  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  user                User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  invoices            Invoice[]

  @@index([status, currentPeriodEnd])  // Untuk cron job query
}
```

---

### Model: `Invoice`

```prisma
model Invoice {
  id               String        @id @default(uuid())
  userId           String
  subscriptionId   String?       // Null jika invoice pertama (belum ada subscription)

  invoiceNumber    String        @unique  // Format: INV-YYYYMMDD-NNNN
  plan             UserPlan      // Plan yang dibeli
  interval         PlanInterval  @default(MONTHLY)
  amount           Int           // Nominal dalam IDR (integer, sama seperti Product.price)
  status           InvoiceStatus @default(PENDING)

  // Midtrans integration
  midtransOrderId  String?       @unique  // ID yang dikirim ke Midtrans
  paymentUrl       String?       // Snap payment URL
  paidAt           DateTime?
  paymentMethod    String?       // "qris", "bank_transfer", dll.

  // Periode yang dibayar
  periodStart      DateTime      // Awal periode yang di-cover invoice ini
  periodEnd        DateTime      // Akhir periode yang di-cover

  expiredAt        DateTime      // Invoice expired jika tidak dibayar (default: 24 jam)

  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  user             User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscription     Subscription? @relation(fields: [subscriptionId], references: [id])

  @@index([userId, status])
  @@index([userId, createdAt])
  @@index([midtransOrderId])
}
```

---

### Tambahan di Model yang Sudah Ada

**`User`** — tambah relasi:
```prisma
subscription  Subscription?
invoices      Invoice[]
```

---

## Struktur File Baru

```
src/
├── services/
│   ├── subscriptionService.js      # Core logic: upgrade, renew, cancel, enforce
│   ├── invoiceService.js           # Buat invoice, generate nomor, Midtrans Snap
│   └── planLimitService.js         # Cek limit per plan (bot config, produk, dll.)
│
├── workers/
│   └── subscriptionWorker.js       # BullMQ scheduled jobs: expiry check + reminder
│
├── middlewares/
│   └── planGuard.js                # Middleware enforcement plan limit di routes
│
├── api/
│   ├── controllers/
│   │   ├── subscriptionController.js
│   │   └── invoiceController.js
│   └── routes/
│       ├── subscription.routes.js
│       └── invoice.routes.js
```

---

## Implementasi Per Komponen

### 1. `planLimitService.js`

Sentralisasi semua definisi limit per plan. **Ini satu-satunya tempat angka limit didefinisikan.**

```javascript
// src/services/planLimitService.js

export const PLAN_LIMITS = {
  FREE: {
    botConfigs: 1,
    products: 10,
    canBroadcast: false,
    canUseFulfillment: false,
  },
  STARTER: {
    botConfigs: 3,
    products: 50,
    canBroadcast: true,
    canUseFulfillment: true,
  },
  PRO: {
    botConfigs: 10,
    products: Infinity,
    canBroadcast: true,
    canUseFulfillment: true,
  },
}

export const PLAN_PRICES = {
  STARTER: { MONTHLY: 99000, YEARLY: 990000 },
  PRO:     { MONTHLY: 299000, YEARLY: 2990000 },
}

/**
 * Cek apakah tenant masih dalam batas limit plan mereka.
 * Throw error jika limit terlampaui.
 */
export async function assertWithinLimit(userId, resource, prisma) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  const limits = PLAN_LIMITS[user.plan]

  if (resource === 'botConfig') {
    const count = await prisma.botConfig.count({ where: { userId } })
    if (count >= limits.botConfigs) {
      throw Object.assign(
        new Error(`Plan ${user.plan} hanya mendukung ${limits.botConfigs} bot config`),
        { code: 'PLAN_LIMIT_EXCEEDED', statusCode: 403 }
      )
    }
  }

  if (resource === 'product') {
    if (limits.products === Infinity) return
    const count = await prisma.product.count({ where: { userId } })
    if (count >= limits.products) {
      throw Object.assign(
        new Error(`Plan ${user.plan} hanya mendukung ${limits.products} produk`),
        { code: 'PLAN_LIMIT_EXCEEDED', statusCode: 403 }
      )
    }
  }
}

/**
 * Cek apakah tenant boleh menggunakan fitur tertentu.
 */
export function assertFeatureAllowed(plan, feature) {
  const limits = PLAN_LIMITS[plan]
  if (!limits[feature]) {
    throw Object.assign(
      new Error(`Fitur ini tidak tersedia di plan ${plan}`),
      { code: 'FEATURE_NOT_ALLOWED', statusCode: 403 }
    )
  }
}
```

---

### 2. `planGuard.js` (Middleware)

Middleware yang dipasang di route-route tertentu untuk enforce limit secara otomatis.

```javascript
// src/middlewares/planGuard.js

import { assertWithinLimit, assertFeatureAllowed, PLAN_LIMITS } from '../services/planLimitService.js'
import { prisma } from '../lib/prisma.js'

/**
 * Guard untuk limit resource (botConfig, product).
 * Dipasang di POST routes yang membuat resource baru.
 *
 * Contoh penggunaan:
 * router.post('/bot-config', auth, planGuard.resource('botConfig'), controller)
 */
export const resource = (resourceName) => async (req, res, next) => {
  try {
    await assertWithinLimit(req.userId, resourceName, prisma)
    next()
  } catch (err) {
    if (err.code === 'PLAN_LIMIT_EXCEEDED') {
      return res.status(403).json({
        success: false,
        code: 'PLAN_LIMIT_EXCEEDED',
        message: err.message,
      })
    }
    next(err)
  }
}

/**
 * Guard untuk fitur berbayar (broadcast, fulfillment).
 * Dipasang di route yang membutuhkan fitur tersebut.
 *
 * Contoh penggunaan:
 * router.post('/broadcast', auth, planGuard.feature('canBroadcast'), controller)
 */
export const feature = (featureName) => async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    assertFeatureAllowed(user.plan, featureName)
    next()
  } catch (err) {
    if (err.code === 'FEATURE_NOT_ALLOWED') {
      return res.status(403).json({
        success: false,
        code: 'FEATURE_NOT_ALLOWED',
        message: err.message,
      })
    }
    next(err)
  }
}

/**
 * Guard untuk subscription aktif.
 * Jika PAST_DUE → block semua akses API admin kecuali billing.
 */
export const requireActiveSubscription = async (req, res, next) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    include: { subscription: true }
  })

  // FREE plan selalu boleh akses
  if (user.plan === 'FREE') return next()

  const sub = user.subscription
  if (!sub || sub.status === 'PAST_DUE') {
    return res.status(402).json({
      success: false,
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Subscription Anda telah berakhir. Silakan perpanjang untuk melanjutkan.',
    })
  }

  // EXPIRED tapi masih dalam grace period → izinkan tapi sertakan warning
  if (sub.status === 'EXPIRED') {
    res.set('X-Subscription-Warning', `Grace period berakhir ${sub.gracePeriodEnd.toISOString()}`)
  }

  next()
}
```

---

### 3. `invoiceService.js`

```javascript
// src/services/invoiceService.js

import { prisma } from '../lib/prisma.js'
import { PLAN_PRICES } from './planLimitService.js'
import { getTenantConfig } from './tenantService.js'  // Yang sudah ada

/**
 * Generate nomor invoice unik: INV-YYYYMMDD-NNNN
 */
async function generateInvoiceNumber(userId) {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `INV-${dateStr}-`

  const last = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
  })

  const seq = last
    ? String(parseInt(last.invoiceNumber.split('-')[2]) + 1).padStart(4, '0')
    : '0001'

  return `${prefix}${seq}`
}

/**
 * Buat invoice baru dan Midtrans Snap transaction.
 * Dipanggil saat tenant request upgrade atau renewal.
 *
 * @param {string} userId
 * @param {string} plan - 'STARTER' | 'PRO'
 * @param {string} interval - 'MONTHLY' | 'YEARLY'
 */
export async function createInvoice(userId, plan, interval = 'MONTHLY') {
  const amount = PLAN_PRICES[plan][interval]
  if (!amount) throw new Error(`Kombinasi plan/interval tidak valid: ${plan}/${interval}`)

  const user = await prisma.user.findUnique({ where: { id: userId } })
  const tenantConfig = await getTenantConfig(userId)

  // Hitung periode yang di-cover
  const periodStart = new Date()
  const periodEnd = new Date()
  if (interval === 'MONTHLY') periodEnd.setMonth(periodEnd.getMonth() + 1)
  if (interval === 'YEARLY') periodEnd.setFullYear(periodEnd.getFullYear() + 1)

  const invoiceNumber = await generateInvoiceNumber(userId)
  const midtransOrderId = `SUB-${invoiceNumber}` // Prefix berbeda dari order biasa
  const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 jam

  // Buat Snap transaction ke Midtrans
  // Gunakan server key tenant jika ada, fallback ke platform key
  // CATATAN: untuk billing platform, sebaiknya gunakan Midtrans key milik platform
  // sendiri (dari env), bukan key tenant — agar revenue masuk ke rekening platform.
  const serverKey = process.env.PLATFORM_MIDTRANS_SERVER_KEY
  const auth = Buffer.from(`${serverKey}:`).toString('base64')

  const snapRes = await fetch('https://app.midtrans.com/snap/v1/transactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: midtransOrderId,
        gross_amount: amount,
      },
      customer_details: {
        first_name: user.name,
        email: user.email,
      },
      item_details: [{
        id: plan,
        price: amount,
        quantity: 1,
        name: `Subscription ${plan} (${interval})`,
      }],
      expiry: {
        unit: 'hour',
        duration: 24,
      },
    }),
  })

  const snapData = await snapRes.json()
  if (!snapData.token) throw new Error(`Midtrans error: ${JSON.stringify(snapData)}`)

  // Simpan invoice ke DB
  const invoice = await prisma.invoice.create({
    data: {
      userId,
      invoiceNumber,
      plan,
      interval,
      amount,
      status: 'PENDING',
      midtransOrderId,
      paymentUrl: snapData.redirect_url,
      periodStart,
      periodEnd,
      expiredAt,
    }
  })

  return invoice
}
```

---

### 4. `subscriptionService.js`

```javascript
// src/services/subscriptionService.js

import { prisma } from '../lib/prisma.js'

/**
 * Dipanggil saat invoice berhasil dibayar (dari webhook handler).
 * Buat atau perpanjang subscription, update User.plan.
 *
 * @param {string} midtransOrderId - ID dari Midtrans webhook
 * @param {string} paymentMethod
 */
export async function activateSubscription(midtransOrderId, paymentMethod) {
  const invoice = await prisma.invoice.findUnique({
    where: { midtransOrderId },
    include: { user: { include: { subscription: true } } }
  })

  if (!invoice || invoice.status === 'PAID') return // Idempoten

  const { userId, plan, interval, periodStart, periodEnd } = invoice
  const gracePeriodEnd = new Date(periodEnd)
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 3) // +3 hari grace period

  await prisma.$transaction([
    // Update invoice
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', paidAt: new Date(), paymentMethod }
    }),

    // Buat atau perpanjang subscription
    prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan,
        interval,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gracePeriodEnd,
      },
      update: {
        plan,
        interval,
        status: 'ACTIVE',
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        gracePeriodEnd,
      }
    }),

    // Update plan di User
    prisma.user.update({
      where: { id: userId },
      data: { plan }
    }),

    // Sambungkan invoice ke subscription (update setelah upsert)
    // Dilakukan di luar transaction karena butuh subscriptionId
  ])

  // Sambungkan invoice ke subscription
  const sub = await prisma.subscription.findUnique({ where: { userId } })
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { subscriptionId: sub.id }
  })
}

/**
 * Cancel subscription — akses tetap aktif sampai currentPeriodEnd.
 */
export async function cancelSubscription(userId, reason) {
  const sub = await prisma.subscription.findUnique({ where: { userId } })
  if (!sub || sub.status !== 'ACTIVE') throw new Error('Tidak ada subscription aktif')

  await prisma.subscription.update({
    where: { userId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }
  })
}

/**
 * Dipanggil oleh cron job saat subscription expired melewati grace period.
 * Downgrade ke FREE dan nonaktifkan bot.
 */
export async function handleExpiredSubscription(userId) {
  await prisma.$transaction([
    prisma.subscription.update({
      where: { userId },
      data: { status: 'PAST_DUE' }
    }),
    prisma.user.update({
      where: { id: userId },
      data: { plan: 'FREE' }
    }),
    // Nonaktifkan semua bot config tenant
    prisma.botConfig.updateMany({
      where: { userId },
      data: { isActive: false }
    })
  ])

  // TODO: Kirim notifikasi ke tenant (via email atau Telegram ke admin chat)
}
```

---

### 5. `subscriptionWorker.js` (Cron Jobs)

Dua scheduled job yang jalan otomatis setiap hari.

```javascript
// src/workers/subscriptionWorker.js

import { Queue, Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { prisma } from '../lib/prisma.js'
import { handleExpiredSubscription } from '../services/subscriptionService.js'

export const subscriptionQueue = new Queue('subscription-jobs', { connection: redis })

/**
 * Schedule dua job berulang setiap hari jam 08.00 WIB (01.00 UTC)
 */
export async function scheduleSubscriptionJobs() {
  // Hapus job lama agar tidak duplikat saat restart
  await subscriptionQueue.removeRepeatable('check-expiry', { pattern: '0 1 * * *' })
  await subscriptionQueue.removeRepeatable('send-reminders', { pattern: '0 1 * * *' })

  await subscriptionQueue.add(
    'check-expiry',
    {},
    { repeat: { pattern: '0 1 * * *' }, jobId: 'check-expiry' }
  )

  await subscriptionQueue.add(
    'send-reminders',
    {},
    { repeat: { pattern: '0 1 * * *' }, jobId: 'send-reminders' }
  )
}

export function createSubscriptionWorker() {
  const worker = new Worker(
    'subscription-jobs',
    async (job) => {
      if (job.name === 'check-expiry') await runExpiryCheck()
      if (job.name === 'send-reminders') await runReminderSend()
    },
    { connection: redis }
  )

  return worker
}

/**
 * Cek subscription yang sudah melewati grace period → downgrade ke FREE.
 */
async function runExpiryCheck() {
  const now = new Date()

  // Subscription yang expired (bukan PAST_DUE) dan grace period sudah habis
  const overdues = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'EXPIRED', 'CANCELLED'] },
      gracePeriodEnd: { lte: now },
    },
    select: { userId: true }
  })

  for (const { userId } of overdues) {
    await handleExpiredSubscription(userId).catch(err =>
      console.error(`[SubscriptionWorker] Gagal handle expiry ${userId}:`, err)
    )
  }

  // Set status EXPIRED untuk yang sudah lewat currentPeriodEnd tapi masih dalam grace period
  await prisma.subscription.updateMany({
    where: {
      status: 'ACTIVE',
      currentPeriodEnd: { lte: now },
      gracePeriodEnd: { gt: now },
    },
    data: { status: 'EXPIRED' }
  })
}

/**
 * Kirim reminder ke tenant yang subscriptionnya akan expired H-3 dan H-1.
 */
async function runReminderSend() {
  const now = new Date()
  const in3Days = new Date(now); in3Days.setDate(in3Days.getDate() + 3)
  const in1Day  = new Date(now); in1Day.setDate(in1Day.getDate() + 1)

  const toRemind = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      currentPeriodEnd: {
        // Dalam rentang hari ini + 1 hari, atau hari ini + 3 hari (window 24 jam)
        gte: now,
        lte: in3Days,
      }
    },
    include: { user: true }
  })

  for (const sub of toRemind) {
    const daysLeft = Math.ceil((sub.currentPeriodEnd - now) / (1000 * 60 * 60 * 24))
    if (daysLeft === 3 || daysLeft === 1) {
      await sendRenewalReminder(sub, daysLeft).catch(err =>
        console.error(`[SubscriptionWorker] Gagal kirim reminder ${sub.userId}:`, err)
      )
    }
  }
}

async function sendRenewalReminder(sub, daysLeft) {
  // Kirim via admin bot tenant (jika ada ADMIN_BOT_TOKEN dan ADMIN_CHAT_ID)
  const { getTenantConfig } = await import('../services/tenantService.js')
  const config = await getTenantConfig(sub.userId)
  if (!config?.ADMIN_BOT_TOKEN || !config?.ADMIN_CHAT_ID) return

  const { default: TelegramBot } = await import('node-telegram-bot-api')
  const bot = new TelegramBot(config.ADMIN_BOT_TOKEN)

  const msg = `⚠️ *Reminder Subscription*\n\n` +
    `Subscription ${sub.plan} Anda akan berakhir dalam *${daysLeft} hari* ` +
    `(${sub.currentPeriodEnd.toLocaleDateString('id-ID')}).\n\n` +
    `Segera perpanjang agar bot Anda tidak nonaktif.`

  await bot.sendMessage(config.ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' })
}
```

---

### 6. Integrasi ke Midtrans Webhook Handler

Di file yang menangani Midtrans webhook (yang sudah ada), tambahkan routing untuk invoice subscription:

```javascript
// Di webhook handler yang sudah ada — setelah verifySignature

import { activateSubscription } from '../services/subscriptionService.js'

// Cek apakah ini payment untuk subscription (prefix SUB-) atau order biasa
if (midtransOrderId.startsWith('SUB-')) {
  if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
    await activateSubscription(midtransOrderId, paymentType)
  }
  // Tidak perlu handle failed — invoice otomatis expired setelah 24 jam via cron
  return res.status(200).json({ status: 'ok' })
}

// Lanjut ke flow order biasa yang sudah ada...
```

---

## API Endpoints Baru

Semua menggunakan Admin JWT middleware yang sudah ada.

### Subscription

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/subscription` | Status subscription aktif tenant |
| POST | `/api/subscription/upgrade` | Request upgrade plan → return invoice + paymentUrl |
| POST | `/api/subscription/cancel` | Cancel subscription (akses tetap sampai period end) |

**Body POST `/api/subscription/upgrade`:**
```json
{ "plan": "PRO", "interval": "MONTHLY" }
```

**Response:**
```json
{
  "invoice": { "invoiceNumber": "INV-20250614-0001", "amount": 299000 },
  "paymentUrl": "https://app.midtrans.com/snap/v3/redirection/..."
}
```

---

### Invoice

| Method | Path | Keterangan |
|---|---|---|
| GET | `/api/invoices` | Riwayat semua invoice tenant |
| GET | `/api/invoices/:id` | Detail invoice |

---

## Integrasi di `index.js` / `app.js`

### `index.js` — startup sequence

```javascript
import { createSubscriptionWorker, scheduleSubscriptionJobs } from './workers/subscriptionWorker.js'

// Setelah init workers yang sudah ada:
const subscriptionWorker = createSubscriptionWorker()
await scheduleSubscriptionJobs()

// Graceful shutdown:
await subscriptionWorker.close()
```

### `app.js` — routes

```javascript
import subscriptionRoutes from './api/routes/subscription.routes.js'
import invoiceRoutes from './api/routes/invoice.routes.js'

app.use('/api/subscription', authMiddleware, subscriptionRoutes)
app.use('/api/invoices', authMiddleware, invoiceRoutes)
```

### Pasang `planGuard` di routes yang sudah ada

Di route yang membuat bot config (POST):
```javascript
import * as planGuard from '../middlewares/planGuard.js'

router.post('/', auth, planGuard.resource('botConfig'), botConfigController.create)
```

Di route yang membuat produk (POST):
```javascript
router.post('/', auth, planGuard.resource('product'), productController.create)
```

Di route fulfillment config (POST) — hanya STARTER ke atas:
```javascript
router.post('/:productId/fulfillment', auth, planGuard.feature('canUseFulfillment'), fulfillmentConfigController.upsert)
```

Pasang `requireActiveSubscription` sebagai global middleware untuk semua `/api/*` yang butuh auth, kecuali `/api/subscription` dan `/api/invoices` (agar tenant PAST_DUE masih bisa bayar):
```javascript
// Di app.js, setelah authMiddleware tapi sebelum routes lain:
app.use('/api', authMiddleware, planGuard.requireActiveSubscription)

// Kecualikan billing routes dari guard ini:
app.use('/api/subscription', authMiddleware, subscriptionRoutes)  // Sebelum guard
app.use('/api/invoices', authMiddleware, invoiceRoutes)            // Sebelum guard
```

---

## Environment Variable Baru

Tambahkan ke `.env` dan dokumentasi:

```env
# Midtrans key milik PLATFORM (bukan tenant) untuk terima pembayaran subscription
PLATFORM_MIDTRANS_SERVER_KEY=SB-Mid-server-xxxx
PLATFORM_MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx
PLATFORM_MIDTRANS_IS_PRODUCTION=false
```

> **Penting:** Gunakan Midtrans key milik platform sendiri — bukan key tenant — agar revenue subscription masuk ke rekening bisnis Anda, bukan rekening tenant.

---

## Urutan Implementasi

1. **Database** — Tambah enum dan model baru (`Subscription`, `Invoice`) ke `schema.prisma`, tambah relasi ke `User`, jalankan `npm run db:migrate`.

2. **`planLimitService.js`** — Definisikan semua limit dan harga. Test dengan unit test sederhana (import dan cek nilai konstanta).

3. **`planGuard.js`** — Buat middleware. Pasang ke POST `/bot-config` dan POST `/products` dulu. Test: coba buat resource melebihi limit → harus dapat 403.

4. **`invoiceService.js`** — Buat invoice + Midtrans Snap. Test: panggil `createInvoice` untuk userId tenant, verifikasi invoice tersimpan dan `paymentUrl` valid.

5. **`subscriptionService.js`** — `activateSubscription` dan `cancelSubscription`. Test: simulasi webhook Midtrans settlement untuk `midtransOrderId` yang prefix `SUB-`, verifikasi `User.plan` berubah dan `Subscription` dibuat.

6. **Webhook Handler Integration** — Tambahkan routing `SUB-` prefix di webhook handler yang sudah ada.

7. **`subscriptionWorker.js`** — Cron jobs expiry check dan reminder. Daftarkan di `index.js`. Test: set `currentPeriodEnd` ke waktu lampau di Prisma Studio, tunggu atau trigger job manual, verifikasi status berubah ke `PAST_DUE` dan `User.plan` ke `FREE`.

8. **API Endpoints** — Buat controllers dan routes. Daftarkan di `app.js` dengan urutan yang benar (billing routes **sebelum** `requireActiveSubscription` middleware).

9. **Pasang `requireActiveSubscription`** sebagai global middleware di `app.js`.

---

## Aturan Wajib untuk Agent

- **`PLATFORM_MIDTRANS_SERVER_KEY`** — Selalu gunakan key platform dari env untuk transaksi invoice, bukan key tenant dari `BotCredential`. Ini kritis agar revenue masuk ke rekening Anda.
- **Idempotency webhook** — Di `activateSubscription`, selalu cek `invoice.status === 'PAID'` di awal dan return jika sudah. Midtrans bisa kirim webhook lebih dari sekali.
- **Prefix midtransOrderId** — Invoice subscription selalu gunakan prefix `SUB-` agar bisa dibedakan dari order biasa (`ORD-`) di webhook handler.
- **FREE plan tidak punya Subscription record** — Jangan buat `Subscription` untuk FREE. Guard `requireActiveSubscription` harus selalu allow jika `user.plan === 'FREE'`.
- **Urutan route di `app.js`** — `/api/subscription` dan `/api/invoices` harus didaftarkan **sebelum** middleware `requireActiveSubscription` agar tenant PAST_DUE tetap bisa bayar.
- **Jangan ubah flow order biasa** — Hanya tambahkan routing `SUB-` prefix di webhook handler. Semua flow order (`ORD-`) tetap berjalan seperti semula.
- **Multi-tenant scoping** — Semua query ke `Invoice` dan `Subscription` wajib filter by `userId`.