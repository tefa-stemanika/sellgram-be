# HANDLERS.md — Dokumentasi Handlers

Semua handler ada di `src/handlers/`. Handler menerima `(bot, msg)` dan mengatur
apa yang dikirim ke user Telegram.

---

## messageHandler.js — Router Utama

**Tanggung jawab:** Menerima semua pesan teks masuk dan menentukan ke mana harus diproses.

**Export:** `AI_ENABLED` (boolean, dibaca dari `configService.isAiEnabled()` saat startup)

### Logika routing pesan teks:

```
Pesan teks masuk (bukan command)
         │
         ▼
  AI_ENABLED = false?
         │
    ┌────┴────┐
   YES        NO
    │          │
    ▼          ▼
handleCustomQtyInput()    handleOrderInput()
(ada "Jumlah lain..."     (user sedang di flow order)
 pending?)                        │
    │                    handledByOrder = true?
    │                             │
    │                         ┌───┴───┐
    │                        YES      NO
    │                         │        │
    │                       return   askGemini()
    │                                  │
    │                          function_call?
    │                             │
    │                      ┌──────┴──────┐
    │                     YES            NO
    │                      │              │
    │               executeFunctionCall  kirim teks ke user
    │
    ▼
  Teks lain selain flow order?
    → arahkan ke tombol menu
```

### Command handlers:

| Command | Handler | Perbedaan AI vs Button mode |
|---|---|---|
| `/start` | `handleStart` | AI: teks deskriptif + 2 tombol. Button: teks singkat + 1 tombol |
| `/help` | `handleHelp` | AI: cantumkan command teks. Button: hanya mention tombol |
| `/reset` | `handleReset` | Sama di kedua mode — hapus session AI |
| `/menu` | Di `index.js` | AI: `handleMenu()` (teks). Button: `showMenuButtons()` (keyboard) |
| `/pesan` | Di `index.js` | AI only — di button mode tidak aktif |
| `/konfirmasi` | Di `index.js` | AI only — di button mode pakai `confirm_order` callback |
| `/batal` | Di `index.js` | Aktif di kedua mode |

### `executeFunctionCall()` — mapping Gemini ke handler:

| Function Name | Handler dipanggil |
|---|---|
| `show_menu` | `handleMenu(bot, msg)` |
| `start_order` (ada product_id) | `handlePesanDenganProduk(bot, msg, productId, quantity)` |
| `start_order` (tanpa product_id) | `handlePesan(bot, msg)` |
| `confirm_order` | `handleKonfirmasi(bot, msg)` |
| `cancel_order` | `handleBatal(bot, msg)` |
| `get_order_status` | `handleOrderStatus(bot, msg)` |

### `handlePesanDenganProduk()` — 3 skenario:

| Kondisi | Hasil |
|---|---|
| Tidak ada product_id | Fallback ke `handlePesan` (flow normal pilih produk) |
| Ada product_id, tidak ada quantity | Set state `SELECTING_QTY`, tanya jumlah ke user |
| Ada product_id **dan** quantity | Set state `CONFIRMING`, langsung tampilkan ringkasan |

---

## orderHandler.js — Flow Order (Teks/Command)

**Tanggung jawab:** Menangani flow order yang diinisiasi via command (`/pesan`) atau
natural language AI. Semua interaksi menggunakan pesan teks biasa (bukan inline keyboard).

Digunakan di **AI mode** dan sebagai **fallback** di button mode (saat user ketik angka manual).

### Fungsi-fungsi:

**`handleMenu(bot, msg)`**
- Ambil semua produk dari DB
- Tampilkan dalam format teks dengan emoji, nama, deskripsi, harga

**`handlePesan(bot, msg)`**
- Cek tidak ada order aktif (state IDLE)
- Set state `SELECTING_PRODUCT`
- Tampilkan daftar produk bernomor

**`handleKonfirmasi(bot, msg)`**
- Cek state `CONFIRMING`
- `saveOrder()` → DB (status: PAYMENT_PENDING)
- `createSnapTransaction()` → Midtrans API
- `updateOrderPayment()` → simpan payment URL ke DB
- `resetOrder()` → selesai
- Kirim invoice + link pembayaran ke user

**`handleBatal(bot, msg)`**
- `resetOrder()` → state kembali IDLE
- Berlaku di semua mode (AI dan button)

**`handleOrderStatus(bot, msg)`**
- Tampilkan state order user saat ini
- Dipanggil oleh Gemini function call `get_order_status`

**`handleOrderInput(bot, msg)` → boolean**
- **Entry point untuk input teks angka saat flow order aktif**
- `SELECTING_PRODUCT`: validasi nomor → `getProductById()` → set `SELECTING_QTY`
- `SELECTING_QTY`: validasi qty (1-99) → set `CONFIRMING` → tampilkan ringkasan
- `CONFIRMING`: ingatkan user untuk pakai `/konfirmasi` atau `/batal`
- Return `true` jika pesan sudah ditangani, `false` jika tidak (akan diteruskan ke AI)

---

## buttonHandler.js — Flow Order (Inline Keyboard)

**Tanggung jawab:** Menangani semua `callback_query` dari Inline Keyboard Telegram.
Digunakan di **button mode** (`AI_ENABLED=false`) untuk seluruh flow order.
Juga aktif di AI mode untuk tombol di `/start` dan `/help`.

### Callback data format: `"action:payload"`

| Callback Data | Handler | Keterangan |
|---|---|---|
| `show_menu` | `showMenuButtons()` | Tampilkan grid produk |
| `select_product:4` | `handleSelectProduct()` | User pilih produk ID 4 |
| `select_qty:2` | `handleSelectQty()` | User pilih qty 2 |
| `custom_qty` | `handleAskCustomQty()` | Minta input teks angka |
| `confirm_order` | `handleConfirmOrder()` | Proses pembayaran |
| `cancel_order` | `handleCancelOrder()` | Batalkan order |
| `back_to_menu` | `showMenuButtons()` | Kembali ke menu |

### `handleCallbackQuery(bot, query)` — dispatcher utama
Dipanggil dari `index.js` untuk setiap `callback_query` yang masuk.
Parse `action:payload`, routing ke handler yang sesuai, lalu `answerCallbackQuery()`.

### UX Pattern — edit vs kirim pesan baru

Semua handler di buttonHandler **mengedit pesan sebelumnya** (bukan kirim baru)
menggunakan `editMessage()`. Ini membuat percakapan lebih bersih — tidak ada
tumpukan pesan.

```
Pesan 1: "Pilih produk" + [Nasi Goreng] [Mie Ayam]
  → user klik [Nasi Goreng]
Pesan 1 (diedit): "Nasi Goreng — Rp25.000\nMau berapa?" + [1][2][3][4][5][Lain]
  → user klik [2]
Pesan 1 (diedit): "Ringkasan: 2x Nasi Goreng = Rp50.000" + [Konfirmasi] [Batal]
  → user klik [Konfirmasi]
Pesan 1 (diedit): "⏳ Memproses..."
  → selesai
Pesan 1 (diedit): "✅ Order berhasil!" + [Bayar Sekarang] (url button)
```

### `showMenuButtons(bot, chatId, editMsgId?)` — dapat dipanggil langsung
Bisa dipanggil dari `index.js` (command `/menu` di button mode) atau
sebagai callback `back_to_menu`. Parameter `editMsgId` opsional — kalau ada, edit pesan, kalau tidak ada, kirim baru.

### `handleCustomQtyInput(bot, msg)` → boolean
Untuk kasus user tekan "Jumlah lain..." — bot set flag `awaitingCustomQty: true` di state.
Saat pesan teks berikutnya masuk, dicek dulu di `messageHandler` sebelum diproses.

### Tombol konfirmasi — URL button
Setelah order berhasil dibuat, tombol "Bayar Sekarang" menggunakan **URL button**
(bukan callback) yang langsung membuka halaman Midtrans Snap:
```js
{ text: "💳 Bayar Sekarang", url: snapResult.redirect_url }
```

---

## Ringkasan Perbedaan AI Mode vs Button Mode

| Aspek | AI Mode (`AI_ENABLED=true`) | Button Mode (`AI_ENABLED=false`) |
|---|---|---|
| Input utama | Teks natural language | Klik tombol |
| Intent detection | Gemini Function Calling | Callback query data |
| Pilih produk | Gemini extract nama → product_id | Klik tombol produk |
| Pilih qty | Gemini extract angka | Klik 1-5 atau ketik custom |
| Konfirmasi | `/konfirmasi` atau natural | Klik "Konfirmasi & Bayar" |
| Teks biasa | Dijawab AI (chat) | Diarahkan ke tombol menu |
| Command `/pesan` | Aktif | Tidak aktif |
| Command `/batal` | Aktif | Aktif |
| GEMINI_API_KEY | Wajib | Tidak diperlukan |
