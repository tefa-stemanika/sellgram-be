# PLAN.md — Roadmap & Rencana Pengembangan

## Status Saat Ini

Bot Telegram yang sudah berjalan dengan fitur lengkap sebagai **single-tenant**:
- Chat AI via Gemini (natural language) atau Button UI (inline keyboard)
- Flow order: menu → pilih produk → pilih qty → konfirmasi → bayar
- Payment via Midtrans Snap (QRIS, GoPay, Transfer Bank)
- Notifikasi pembeli dan admin setelah pembayaran berhasil
- Semua config bisnis (credentials, AI mode, Midtrans keys) tersimpan **terenkripsi di database**

---

## ✅ Milestone yang Sudah Selesai

### M1 — Bot Dasar
- [x] Bot Telegram dengan Gemini AI (natural language)
- [x] Riwayat percakapan per user (in-memory session)
- [x] Command: `/start`, `/help`, `/reset`, `/menu`, `/pesan`, `/konfirmasi`, `/batal`

### M2 — Order System
- [x] Flow order step-by-step (pilih produk → qty → konfirmasi)
- [x] Natural language order via Gemini Function Calling
- [x] Produk dari database MySQL via Prisma

### M3 — Payment Gateway
- [x] Integrasi Midtrans Snap (sandbox)
- [x] QRIS, GoPay, ShopeePay, Transfer Bank
- [x] Webhook notifikasi pembayaran (via ngrok untuk dev)
- [x] Notifikasi ke pembeli dan admin setelah bayar

### M4 — Button UI Mode
- [x] Toggle `AI_ENABLED` untuk switch antara natural language dan button UI
- [x] Inline keyboard: pilih produk (grid), pilih qty (1-5 + custom), konfirmasi, batal
- [x] Tombol "Bayar Sekarang" langsung ke Midtrans Snap

### M5 — Config dari Database
- [x] Tabel `bot_config` untuk konfigurasi umum (AI mode, Gemini model, Midtrans mode)
- [x] Tabel `bot_credentials` untuk credentials sensitif terenkripsi AES-256-GCM
- [x] `configService.js` sebagai single source of truth
- [x] Script migrasi `seed-config.js` untuk pindah dari `.env` ke database
- [x] `.env` hanya menyimpan `DATABASE_URL`, `ENCRYPTION_KEY`, `BOT_MODE`, `WEBHOOK_PORT`

---

## � Milestone Saat Ini

### M6 — Multi-User / Multi-Tenant ← IN PROGRESS (Phase 1 ✅ Complete)

**Status:** Phase 1 (Infrastructure) 45% COMPLETE  
→ Phase 2-5 Ready (Handlers, Webhooks, Testing)

**Latar belakang:**
Saat ini semua config (`bot_credentials`, `bot_config`, `products`, `orders`) bersifat global
(tidak terikat ke user manapun). Plan saat ini adalah menambahkan tabel `users` sebagai
**pemilik bot** (tenant), sehingga setiap user memiliki credentials, produk, dan order-nya sendiri.

**Tujuan:**
Ketika customer mengirim pesan ke bot, sistem otomatis mengambil credentials dan config
milik user (tenant) yang memiliki bot tersebut — bukan dari config global.

**✅ Sudah Selesai (Phase 1):**
- ✅ Schema Database: User table + user_id FK ke semua data tables
- ✅ userService.js: create, verify, list users
- ✅ botManager.js: spawn/stop bot per user
- ✅ tenantResolver.js: map token → userId
- ✅ configService.js: multi-user config getters
- ✅ productService.js & orderService.js: userId scoping
- ✅ Seed migration script
- ✅ index-m6.js bootstrap entry point

**🔜 Selanjutnya (Phase 2-5):**
1. Handler refactoring (messageHandler, orderHandler, buttonHandler)
2. Webhook & admin bot updates
3. State machine (order.js, session.js) userId scoping
4. Testing & deployment

**Referensi lengkap:**
- [M6_IMPLEMENTATION_GUIDE.md](./M6_IMPLEMENTATION_GUIDE.md) — Roadmap fase 2-5
- [M6_IMPLEMENTATION_SUMMARY.md](./M6_IMPLEMENTATION_SUMMARY.md) — Apa yang sudah dikerjakan

---

### M7 — Dashboard Frontend (Next.js)

Setelah M6 selesai, user (tenant) bisa mengatur semua konfigurasi lewat dashboard web:

- [ ] Auth: register, login, session (NextAuth atau JWT)
- [ ] Setup bot: input bot token, admin bot token, admin chat ID
- [ ] Setup produk: CRUD produk (nama, harga, deskripsi, emoji, status)
- [ ] Setup payment: input Midtrans Server Key & Client Key
- [ ] Setup AI: toggle AI mode, pilih Gemini model, input Gemini API key
- [ ] Dashboard order: lihat list order, status, detail
- [ ] Aktivasi/nonaktifkan bot

---

### M8 — Production Ready

- [ ] Deploy ke VPS (Railway, DigitalOcean, atau Hetzner)
- [ ] Switch Midtrans dari sandbox ke production
- [ ] Webhook tanpa ngrok (URL publik permanen)
- [ ] Rate limiting per user
- [ ] Monitoring & alerting (error bot, webhook gagal)
- [ ] Backup database otomatis

---

## Catatan Teknis Penting

### Enkripsi Credentials
- Algoritma: **AES-256-GCM**
- Format di DB: `iv:authTag:ciphertext` (semua hex)
- Key: `ENCRYPTION_KEY` di `.env` (64 karakter hex = 32 bytes)
- **JANGAN ubah atau hapus `ENCRYPTION_KEY`** setelah data tersimpan — data tidak bisa didekripsi

### Config Loading
- Config di-load sekali saat startup via `loadConfig()` di `configService.js`
- Cache di memory — tidak query DB di setiap pesan
- Gunakan `reloadConfig()` jika config berubah (nanti dipakai dari dashboard)

### `.env` yang Tersisa (Permanen)
```env
DATABASE_URL        # koneksi database
ENCRYPTION_KEY      # kunci enkripsi credentials
BOT_MODE            # polling (dev) / webhook (production)
WEBHOOK_PORT        # port HTTP server webhook Midtrans
MIDTRANS_FINISH_URL # redirect setelah bayar (opsional)
```
