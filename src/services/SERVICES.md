# SERVICES.md — Dokumentasi Services

Semua service ada di `src/services/`. Setiap service punya tanggung jawab tunggal.

---

## configService.js ← Pusat Konfigurasi

**Tanggung jawab:** Single source of truth untuk semua config yang sebelumnya di `.env`.

**Cara kerja:**
1. `loadConfig()` dipanggil sekali di `index.js` sebelum bot diinisialisasi
2. Config di-load dari DB dan di-cache di memory
3. Semua service lain membaca config via getter dari file ini — tidak ada yang baca `process.env` untuk config bisnis

**API:**
```js
// Inisialisasi — wajib dipanggil pertama kali
await loadConfig()
await reloadConfig()   // refresh setelah config berubah (nanti dari dashboard)

// Getter credentials (sudah didekripsi)
getTelegramToken()      → string | null
getAdminBotToken()      → string | null
getAdminChatId()        → string | null
getGeminiApiKey()       → string | null
getMidtransServerKey()  → string | null
getMidtransClientKey()  → string | null

// Getter config umum
getGeminiModel()        → string  (default: "gemini-2.0-flash")
isAiEnabled()           → boolean
isMidtransProduction()  → boolean
getBotConfig()          → BotConfig object (row lengkap dari DB)
getCredential(key)      → string | null  (generic getter)
```

**Catatan untuk M6 (multi-user):**
Getter perlu menerima `userId` sebagai parameter untuk mengambil config milik user spesifik.
```js
// Contoh perubahan nanti:
getMidtransServerKey(userId)
isAiEnabled(userId)
```

---

## encryption.js (utils)

**Tanggung jawab:** Enkripsi/dekripsi credentials dengan AES-256-GCM.

**API:**
```js
encrypt(plaintext: string) → string   // "iv:authTag:ciphertext"
decrypt(encryptedString: string) → string
```

**Key:** `ENCRYPTION_KEY` di `.env` — 64 karakter hex (32 bytes).
Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## db.js — Prisma Client

**Tanggung jawab:** Singleton Prisma client untuk seluruh aplikasi.

```js
import prisma from "./db.js";
// Langsung pakai prisma.product.findMany(), prisma.order.create(), dll
```

---

## gemini.js — AI Service

**Tanggung jawab:** Komunikasi dengan Google Gemini API menggunakan Function Calling.

**Config yang dibaca:** `getGeminiApiKey()`, `getGeminiModel()` dari configService.

**Return value `askGemini()`:**
```js
// Respons teks biasa
{ type: "text", text: "..." }

// Gemini memutuskan memanggil fungsi
{ type: "function_call", name: "show_menu" | "start_order" | "confirm_order" | "cancel_order" | "get_order_status", args: {} }
```

**Function Declarations (5 fungsi):**

| Nama | Trigger | Args |
|---|---|---|
| `show_menu` | User mau lihat menu/produk | - |
| `start_order` | User mau pesan sesuatu | `product_id?`, `quantity?` |
| `confirm_order` | User konfirmasi/mau bayar | - |
| `cancel_order` | User mau batalkan | - |
| `get_order_status` | User tanya status pesanan | - |

**System context:** Produk dari DB di-inject ke system prompt agar Gemini tahu apa yang dijual dan bisa memetakan nama produk ke `product_id`.

---

## midtrans.js — Payment Service

**Tanggung jawab:** Integrasi Midtrans Snap API.

**Config yang dibaca:** `getMidtransServerKey()`, `isMidtransProduction()` dari configService.

**API:**
```js
// Buat transaksi Snap — return { token, redirect_url }
await createSnapTransaction({ orderId, totalPrice, product, quantity, customer })

// Cek status transaksi langsung ke Midtrans
await checkTransactionStatus(orderId)

// Verifikasi signature dari webhook (SHA-512)
verifyWebhookSignature(notification) → boolean

// Helper status
isPaymentSuccess(notification) → boolean   // capture+accept atau settlement
isPaymentFailed(notification) → boolean    // deny/cancel/expire/failure
```

**Enabled payments:** QRIS, GoPay, ShopeePay, Bank Transfer.

**Webhook signature formula:**
```
SHA512(order_id + status_code + gross_amount + server_key)
```

---

## adminBot.js — Admin Notification

**Tanggung jawab:** Bot Telegram terpisah yang mengirim notifikasi ke pemilik toko.

**Config yang dibaca:** `getAdminBotToken()`, `getAdminChatId()` dari configService.

**Mode:** `{ polling: false }` — bot ini hanya MENGIRIM, tidak menerima pesan.

**API:**
```js
initAdminBot()  // dipanggil di index.js saat startup

// Dipanggil dari webhook.js setelah pembayaran
await notifyAdminOrderSuccess(order, notification)  // order COMPLETED
await notifyAdminOrderFailed(order)                 // order PAYMENT_FAILED
```

**Notifikasi berisi:** No. order, waktu bayar, metode pembayaran, nama & username pembeli, detail produk, total harga.

---

## productService.js — Product Queries

**Tanggung jawab:** Semua query database untuk tabel `products`.

```js
await getAllProducts()        // ambil semua produk isAvailable=true, urut by id
await getProductById(id)     // cari satu produk by id, isAvailable=true
formatRupiah(amount)         // format angka ke "Rp 25.000"
```

---

## orderService.js — Order Queries

**Tanggung jawab:** Semua query database untuk tabel `orders` dan `order_items`.

```js
generateOrderId()             // buat order ID unik: "ORD-20240315-4821"

// Simpan order baru — status awal: PAYMENT_PENDING
await saveOrder({ telegramId, username, firstName, product, quantity })
  → Order (include orderItems.product)

// Update setelah dapat token Midtrans
await updateOrderPayment(orderId, { paymentUrl, snapToken })

// Query
await getOrdersByUser(telegramId, limit=5)   // riwayat order user
await getOrderByOrderId(orderId)             // satu order by orderId string
```

---

## order.js — Order State Machine (In-Memory)

**Tanggung jawab:** Melacak di mana posisi user dalam flow order saat ini.

**States:**
```
IDLE → SELECTING_PRODUCT → SELECTING_QTY → CONFIRMING → (selesai/batal → IDLE)
```

```js
ORDER_STATE = { IDLE, SELECTING_PRODUCT, SELECTING_QTY, CONFIRMING }

getOrder(userId)          → { state, selectedProduct, quantity, awaitingCustomQty }
setOrder(userId, data)    → update partial state
resetOrder(userId)        → hapus state (kembali ke IDLE)
```

**Catatan:** State hilang saat bot restart. Untuk production dengan uptime tinggi, pertimbangkan Redis.

---

## session.js — Chat History (In-Memory)

**Tanggung jawab:** Menyimpan riwayat percakapan AI per user untuk konteks Gemini.

```js
getHistory(userId)                    → Array<{role, text}>
addMessage(userId, role, text)        // role: "user" | "model"
clearHistory(userId)                  // dipanggil saat /reset
getActiveSessionCount()               → number
```

**Batas:** Maksimal 20 pesan per user (otomatis hapus yang paling lama jika melebihi).

---

## webhook.js — HTTP Server

**Tanggung jawab:** HTTP server untuk menerima notifikasi pembayaran dari Midtrans.

**Endpoints:**

| Method | Path | Fungsi |
|---|---|---|
| GET | `/health` | Health check — verifikasi server berjalan |
| POST | `/webhook/midtrans` | Terima notifikasi pembayaran dari Midtrans |

**Flow `/webhook/midtrans`:**
1. Parse JSON body
2. Verifikasi signature (`verifyWebhookSignature`)
3. Cari order di DB by `order_id`
4. Update status order (`COMPLETED` atau `PAYMENT_FAILED`)
5. Notifikasi ke pembeli (via bot utama)
6. Notifikasi ke admin (via admin bot)
7. Return 200 OK (wajib agar Midtrans tidak retry)

**Setup dev:** Gunakan ngrok (`ngrok http 3000`) lalu set URL ke Midtrans Dashboard → Settings → Notification URL.
