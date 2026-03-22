# 🤖 Telegram AI Bot (Gemini)

Bot Telegram bertenaga Google Gemini AI — siap dikembangkan ke fitur auto order & payment gateway.

---

## 🚀 Cara Setup

### 1. Clone / Salin Project

```bash
# Pastikan sudah ada folder project-nya
cd telegram-ai-bot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Buat File `.env`

```bash
cp .env.example .env
```

Lalu isi nilai-nilainya:

```env
TELEGRAM_BOT_TOKEN=token_dari_botfather
GEMINI_API_KEY=api_key_dari_google_ai_studio
GEMINI_MODEL=gemini-2.0-flash
BOT_MODE=polling
```

### 4. Dapatkan Token & API Key

#### Telegram Bot Token:
1. Buka Telegram, cari **@BotFather**
2. Kirim `/newbot`
3. Ikuti instruksi, copy token yang diberikan

#### Gemini API Key:
1. Buka [Google AI Studio](https://aistudio.google.com/)
2. Klik **Get API Key** → **Create API Key**
3. Copy API key-nya

### 5. Jalankan Bot

```bash
# Development (auto-restart saat file berubah)
npm run dev

# Production
npm start
```

---

## 📁 Struktur Project

```
telegram-ai-bot/
├── src/
│   ├── index.js                  # Entry point
│   ├── handlers/
│   │   └── messageHandler.js     # Handler pesan & command
│   └── services/
│       ├── gemini.js             # Integrasi Gemini API
│       └── session.js            # Manajemen sesi percakapan
├── .env.example                  # Template environment variables
├── package.json
└── README.md
```

---

## 💬 Fitur Saat Ini

| Fitur | Status |
|-------|--------|
| Chat AI dengan Gemini | ✅ |
| Riwayat percakapan per user | ✅ |
| Command `/start`, `/help`, `/reset` | ✅ |
| Indikator "sedang mengetik" | ✅ |
| Error handling | ✅ |

---

## 🔮 Roadmap (Pengembangan Selanjutnya)

### Auto Order System
- [ ] Command `/menu` — tampilkan katalog produk
- [ ] Command `/pesan` — mulai proses order
- [ ] Manajemen keranjang belanja per user
- [ ] Konfirmasi order sebelum pembayaran

### Payment Gateway (Midtrans)
- [ ] Integrasi Midtrans Snap (gratis, sandbox tersedia)
- [ ] Generate link pembayaran otomatis
- [ ] Webhook notifikasi pembayaran sukses/gagal
- [ ] Notifikasi status order ke user

### Database
- [ ] Simpan data order ke MySQL/PostgreSQL
- [ ] Riwayat transaksi per user
- [ ] Dashboard admin sederhana

---

## 🛠️ Kustomisasi

### Ganti Kepribadian AI

Edit bagian `system_instruction` di `src/services/gemini.js`:

```javascript
system_instruction: {
  parts: [{
    text: `Kamu adalah asisten toko online "Nama Toko".
Bantu customer untuk melihat menu, melakukan order, dan proses pembayaran.
Selalu ramah dan profesional.`
  }]
}
```

### Ganti Model Gemini

Di file `.env`:
```env
GEMINI_MODEL=gemini-1.5-pro    # Lebih pintar, lebih lambat
GEMINI_MODEL=gemini-2.0-flash  # Cepat, recommended untuk bot
```

---

## 📦 Dependencies

| Package | Fungsi |
|---------|--------|
| `node-telegram-bot-api` | Library resmi Telegram Bot API untuk Node.js |
| `dotenv` | Load environment variables dari file `.env` |

> **Catatan:** Gemini API dipanggil menggunakan `fetch` bawaan Node.js 18+ — tidak perlu library tambahan!

---

## ⚠️ Catatan Penting

- Riwayat percakapan disimpan **di memory** — akan hilang saat bot di-restart
- Untuk production, pertimbangkan menggunakan **Redis** atau database untuk menyimpan sesi
- Gunakan mode **webhook** (bukan polling) saat deploy ke VPS untuk performa lebih baik
