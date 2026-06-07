# Public Web Catalog & Checkout — Implementation Plan

## 1. Schema Changes (`prisma/schema.prisma`)

- Add `OrderSource` enum: `TELEGRAM | WEBSITE`
- Add `source` field to `Order`: `source OrderSource @default(TELEGRAM)`
- Make `telegramId` nullable: `BigInt?`
- Add `customerName String?` and `customerPhone String?` to `Order`

## 2. New Public API Endpoints (no JWT auth)

File baru `src/api/routes/public.routes.js`, mount di `app.js` sebelum `apiRouter`:

| Method | Path                                      | Function                           |
| ------ | ----------------------------------------- | ---------------------------------- |
| `GET`  | `/api/public/products/:userId`            | List produk available milik tenant |
| `GET`  | `/api/public/products/:userId/:productId` | Detail produk                      |
| `POST` | `/api/public/orders`                      | Buat order dari web                |
| `GET`  | `/api/public/orders/:orderId`             | Cek status order                   |

- `POST /api/public/orders` body: `{ userId, productId, quantity, customerName, customerPhone }`
- Pipeline: `saveOrder(source: WEBSITE)` → `createSnapTransaction(customer_details)` → return `{ orderId, paymentUrl }`
- Tambah `rateLimit` middleware dari codebase yang sudah ada

## 3. Order Service Updates (`src/services/orderService.js`)

- `saveOrder()`: tambah params `source`, `customerName`, `customerPhone`
- `createSnapTransaction()`: inject `customer_details` (name, phone) di payload Midtrans untuk web orders

## 4. Midtrans Adjustment (`src/services/midtrans.js`)

- `createSnapTransaction()` kirim `customer_details.first_name` + `phone`

## 5. Webhook & Worker Updates

- Worker `payment-success`: jika `source === WEBSITE` → skip pesan ke buyer, tetap kirim ke admin
- Worker `payment-failed`: sama — kirim notifikasi admin saja

## 6. Frontend (awareness — separate scope)

Halaman public yang perlu dibangun di frontend Anda:

- `/public/products/:userId` — katalog produk + tombol beli
- Form checkout (nama, no HP, quantity)
- Redirect ke Midtrans Snap / halaman sukses

## Files Affected

- `prisma/schema.prisma`
- `src/services/orderService.js`
- `src/services/midtrans.js`
- `src/services/workers.js`
- `src/api/routes/public.routes.js` (new)
- `src/app.js`
- `src/api/controllers/webhook.controller.js`
