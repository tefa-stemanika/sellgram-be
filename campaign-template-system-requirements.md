# Broadcast Template System — Objectives & Requirements

## Goals

Memisahkan **konten pesan** (template, reusable) dari **eksekusi pengiriman** (campaign/broadcast, sekali pakai). Admin bisa simpan template sekali, lalu pakai berkali-kali untuk broadcast berbeda dengan mapping variabel yang fleksibel per campaign. Mencegah pesan terkirim ke customer dengan data tidak lengkap melalui validasi pre-send.

---

## Konsep Inti

```
Template (reusable)          →  "Halo {{1}}, promo khusus buat kamu! Kode: {{2}}"
        ↓ dipakai untuk
Campaign A (mapping berbeda)  →  {{1}} = Customer.name,  {{2}} = custom field "promo_code"
Campaign B (mapping berbeda)  →  {{1}} = Customer.name,  {{2}} = Customer.phone
```

Satu template bisa dipakai berkali-kali, mapping variabelnya **ditentukan ulang setiap kali bikin campaign baru** — bukan disimpan di template.

---

## Requirement 1 — Template Storage

- Template menyimpan teks pesan mentah dengan placeholder `{{1}}`, `{{2}}`, `{{3}}`, dst (numbered, bukan named — supaya admin bebas pakai variabel apapun saat mapping, tidak terikat nama field tertentu).
- Sistem harus bisa **mendeteksi otomatis** berapa banyak variabel yang dipakai dalam template (scan `{{n}}` di teks) saat template disimpan — supaya saat bikin campaign, UI tahu harus minta mapping untuk berapa variabel.
- Template tidak terikat ke campaign manapun — hidup independen, bisa diedit/dihapus tanpa mempengaruhi campaign yang sudah selesai terkirim (campaign yang sudah `SENT` harus simpan **snapshot** teks final, bukan reference ke template).
- Channel-aware: tandai template ini untuk channel apa (`TELEGRAM` — sesuai yang sudah jalan; field ini disiapkan untuk ekspansi channel lain nanti, tidak perlu dipakai dulu).

---

## Requirement 1B — Variable Label & Sample Text (Saat Template Dibuat)

Saat admin menulis template dan sistem mendeteksi variabel `{{1}}`, `{{2}}`, dst (lihat Requirement 1), admin **wajib** melengkapi metadata berikut untuk **setiap** variabel yang terdeteksi — disimpan sebagai bagian dari template, bukan campaign:

- **Label** — nama deskriptif singkat untuk variabel itu, contoh: `{{1}}` → label `"Nama Customer"`, `{{2}}` → label `"Kode Promo"`. Ini yang ditampilkan di UI saat admin bikin campaign dan harus pilih mapping, supaya admin tahu konteks `{{2}}` itu untuk apa tanpa harus baca ulang isi template.
- **Sample/placeholder text** — contoh nilai realistis untuk preview, contoh: `{{1}}` → sample `"Budi Santoso"`, `{{2}}` → sample `"PROMO50"`. Dipakai untuk render **preview template** di halaman daftar/editor template (sebelum campaign dibuat sama sekali, sebelum ada mapping nyata) — supaya admin bisa lihat kira-kira pesan jadinya seperti apa.

**Validasi saat template disimpan:** template tidak boleh disimpan jika ada variabel yang terdeteksi di teks tapi belum punya label. Sample text boleh opsional (fallback ke `"[Sample {{n}}]"` jika tidak diisi), tapi label **wajib**.

**Bedanya dengan Requirement 2 (mapping):**
- Label & sample text = melekat di **template**, statis, dibuat sekali, untuk membantu pemahaman & preview umum.
- Mapping ke `Customer` field / static value / derived field = melekat di **campaign**, dibuat ulang setiap campaign baru, untuk eksekusi pengiriman nyata.

Contoh alur lengkap:
```
Template dibuat:
  Teks: "Halo {{1}}, promo khusus kode {{2}} buat kamu!"
  {{1}} → label: "Nama Customer", sample: "Budi Santoso"
  {{2}} → label: "Kode Promo",    sample: "PROMO50"

Preview di halaman Template (tanpa campaign):
  "Halo Budi Santoso, promo khusus kode PROMO50 buat kamu!"

Admin bikin Campaign A dari template ini:
  UI tampilkan: "{{1}} - Nama Customer" → [pilih sumber: Customer.name]
                "{{2}} - Kode Promo"    → [pilih sumber: Static Value → isi "NEWUSER25"]

Preview di halaman Campaign (pakai data customer asli, sample dari salah satu recipient):
  "Halo Zheka, promo khusus kode NEWUSER25 buat kamu!"
```

---

## Requirement 2 — Variable Mapping (Per Campaign)

- Saat admin bikin campaign baru dari sebuah template, sistem menampilkan daftar variabel yang terdeteksi (`{{1}}`, `{{2}}`, ...) dan admin pilih masing-masing variabel itu di-mapping ke sumber data apa.

- **Sumber data yang bisa dipilih untuk setiap variabel:**
  - Field bawaan `Customer` (name, phone, email, username)
  - **Custom field bebas** — admin bisa input value statis langsung (sama untuk semua customer dalam campaign itu, misal kode promo yang sama untuk semua), ATAU
  - Custom field yang sumbernya dari luar `Customer` (misal hasil lookup terpisah: produk terakhir dibeli, total order). Ini butuh resolver terpisah per jenis custom field — lihat Requirement 3.

- Mapping ini **disimpan di level campaign**, bukan template. Field mapping harus berbentuk struktur yang menyimpan: nomor variabel → tipe sumber (`CUSTOMER_FIELD` / `STATIC_VALUE` / `DERIVED_FIELD`) → detail sumber (nama field, atau value statis, atau jenis derived field).

- Validasi saat campaign dibuat (sebelum dikirim): pastikan **setiap** variabel yang terdeteksi di template punya mapping. Campaign tidak boleh dikirim jika ada variabel yang belum di-mapping sama sekali (ini beda dari "field-nya kosong per customer" — ini "admin belum pilih mau dipetakan ke mana").

---

## Requirement 3 — Derived / Custom Field Resolver

Untuk variabel yang sumbernya bukan field langsung di `Customer` (misal "produk terakhir dibeli", "total order"):

- Perlu daftar **derived field types** yang didukung sistem (predefined, bukan bebas-bebas — supaya bisa dijamin query-nya aman dan ter-index). Contoh kandidat: `LAST_PRODUCT_NAME`, `TOTAL_ORDERS`, `TOTAL_SPENT`, `LAST_ORDER_DATE`.
- Setiap derived field type punya logic resolver sendiri yang tahu cara ambil data dari tabel terkait (`Order`, `OrderItem`, dll) berdasarkan `customerId`.
- Resolver ini dipanggil **saat proses kirim per recipient**, bukan saat campaign dibuat — supaya datanya fresh (misal "total order" customer bisa berubah antara campaign dibuat dan saat benar-benar terkirim kalau ada jeda/scheduled).
- Static value (admin ketik manual saat mapping) tidak butuh resolver — langsung dipakai sebagai value sama untuk semua customer.

---

## Requirement 4 — Pre-Send Validation per Recipient

Ini bagian paling kritis sesuai kebutuhan Anda.

- **Sebelum** pesan dikirim ke satu customer, sistem render dulu template dengan mapping yang sudah ditentukan. Untuk setiap variabel, ambil value dari sumbernya (`Customer` field / static / derived resolver).
- **Jika ada satu saja variabel yang hasilnya kosong/null/undefined untuk customer tersebut** → batalkan pengiriman pesan ke customer ini, **jangan kirim** pesan dengan placeholder kosong atau `{{1}}` mentah yang ke-expose ke customer.
- Customer yang gagal validasi ini ditandai statusnya di `BroadcastRecipient` sebagai `FAILED`, dengan error message yang jelas dan spesifik — bukan generic "failed to send". Pesan error harus menyebutkan **field mana yang kosong**, supaya admin yang lihat laporan tahu persis apa yang perlu diperbaiki di data customer tersebut (misal: "Field 'phone' kosong untuk customer ini" atau "Variabel {{2}} (custom field: kode_promo) tidak ditemukan").
- **Partial send**: customer lain yang datanya lengkap tetap lanjut dikirim seperti biasa. Satu customer gagal validasi tidak menggagalkan seluruh broadcast.
- Validasi ini terjadi **per job, per recipient** (selaras dengan arsitektur broadcast yang sudah ada — 1 job = 1 recipient), bukan validasi massal di awal sebelum enqueue. Ini penting karena derived field perlu fresh data saat actual send time.

---

## Requirement 5 — Preview Sebelum Kirim

- Sebelum campaign benar-benar di-trigger kirim, admin harus bisa **preview** hasil render pesan untuk minimal 1 customer sample — supaya bisa lihat apakah mapping sudah benar dan format pesan sudah sesuai sebelum broadcast ke ratusan/ribuan orang.
- Preview ini idealnya juga menunjukkan **estimasi berapa customer yang akan gagal validasi** (dry-run validasi tanpa kirim) — supaya admin tahu di awal "dari 500 customer, 12 akan di-skip karena field X kosong" sebelum mereka commit kirim.

---

## Requirement 6 — Audit & Reporting

- Campaign yang sudah selesai kirim harus bisa menunjukkan breakdown jelas: berapa `SENT`, berapa `FAILED` karena alasan kirim (network/blocked), dan berapa `FAILED` karena alasan **validasi data kosong** — ini dua kategori kegagalan yang berbeda dan perlu dibedakan supaya admin tahu mana yang perlu di-retry vs mana yang perlu dibenerin datanya dulu.
- Admin harus bisa export atau lihat daftar customer mana saja yang gagal karena validasi, beserta field apa yang kosong — supaya bisa ditindaklanjuti (lengkapi data, lalu re-broadcast khusus ke mereka).

---

## Requirement 7 — Backward Compatibility dengan Broadcast yang Sudah Ada

- Sistem broadcast yang sudah jalan (rate limiting, queue per-recipient, dll dari fitur sebelumnya) **tidak boleh berubah arsitekturnya**. Fitur template ini menambah **layer rendering pesan sebelum job dikirim ke Telegram**, bukan mengganti cara kerja queue/worker yang sudah ada.
- Broadcast yang dibuat **tanpa** template (kalau masih ada opsi kirim teks bebas tanpa template) harus tetap berfungsi seperti sebelumnya — sistem template ini sifatnya aditif, opsional.

---

## Yang Perlu Diputuskan Lebih Lanjut (Belum Termasuk di Atas)

Sebelum lanjut ke desain schema/implementasi detail, beberapa hal ini perlu diperjelas:

1. **Daftar lengkap derived field types** — field turunan apa saja yang benar-benar dibutuhkan sekarang? (LAST_PRODUCT_NAME, TOTAL_ORDERS, dll — perlu list final supaya resolver-nya bisa didefinisikan satu per satu)
2. **Limit jumlah variabel per template** — apakah perlu dibatasi (misal max 10 variabel) untuk mencegah template yang terlalu kompleks?
3. **Static value per campaign** — apakah static value boleh beda per recipient dalam 1 campaign yang sama (misal dari hasil import CSV terpisah), atau memang selalu 1 value yang sama untuk semua orang di broadcast itu?

---

Setelah poin "Yang Perlu Diputuskan Lebih Lanjut" dijawab, saya bisa lanjutkan ke desain Prisma schema dan implementation guide lengkap seperti dokumen Fulfillment Engine dan Subscription Billing sebelumnya.