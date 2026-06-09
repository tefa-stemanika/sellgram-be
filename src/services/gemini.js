import { getAllProducts, formatRupiah } from './productService.js'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

const functionDeclarations = [
  {
    name: 'show_menu',
    description:
      'Tampilkan daftar menu formal. Hanya panggil jika user menggunakan perintah /menu atau meminta tampilan menu resmi. Untuk obrolan biasa tentang produk, jawab langsung tanpa function call.',
  },
  {
    name: 'start_order',
    description:
      'Mulai proses pemesanan. Panggil HANYA jika user menyebut nama produk spesifik. Ekstrak product_id (nomor urut di daftar menu: 1=pertama, 2=kedua, dst.) dan quantity (jumlah) dari pesan user. Contoh: "pesan baso baka 2" → product_id=3 quantity=2. JANGAN panggil jika user belum menyebut produk — tanya dulu secara natural.',
    parameters: {
      type: 'OBJECT',
      properties: {
        product_id: {
          type: 'INTEGER',
          description:
            'Nomor urut produk di daftar menu (1 = produk pertama, 2 = produk kedua, dst.). WAJIB diisi jika user menyebut nama produk — cocokkan nama produk dari user ke daftar produk. Contoh: user bilang "baso baka" → product_id 3 (Baso Bakar).',
        },
        quantity: {
          type: 'INTEGER',
          description:
            'Jumlah produk yang dipesan. Isi jika user menyebut angka/jumlah dalam pesanannya, kosongkan jika belum disebutkan. Contoh: "pesan bakso 4" → quantity=4.',
        },
      },
    },
  },
  {
    name: 'cancel_order',
    description:
      'Batalkan order yang sedang berjalan. Panggil ketika user ingin membatalkan pesanan.',
  },
  {
    name: 'confirm_order',
    description:
      'Konfirmasi dan selesaikan order. Panggil ketika user ingin melanjutkan, membayar, atau mengkonfirmasi pesanan.',
  },
  {
    name: 'get_order_status',
    description:
      'Cek status order user saat ini. Panggil ketika user bertanya tentang pesanannya atau ringkasan order.',
  },
]

export async function askGemini(userMessage, userId, conversationHistory = []) {
  const apiKey = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

  if (!apiKey)
    throw new Error('GEMINI_API_KEY tidak ditemukan di environment.')

  const { products } = await getAllProducts(userId)
  const productContext = products
    .map((p) => `${p.emoji} ${p.name} — ${formatRupiah(p.price)}
   ${p.description}`)
    .join('\n')

  const contents = [
    ...conversationHistory.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.text }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  const body = {
    system_instruction: {
      parts: [
        {
          text: `Kamu adalah customer service toko online yang ramah, hangat, dan natural. Nama toko tidak disebut secara kaku — kamu cukup bicara seperti CS toko beneran.

KEPRIBADIAN:
- Bicaralah dengan hangat seperti CS toko sungguhan, bukan robot.
- Untuk sapaan seperti "Hai", "Halo", "Pagi", balas dengan santai dan tawarkan bantuan: "Hai juga! Ada yang bisa aku bantu?"
- Jika user minta rekomendasi (misal: "Aku lagi pengen yang manis, ada rekomendasi?"), gunakan deskripsi produk untuk menyarankan dengan bahasa alami.
- Jika user tanya soal produk spesifik (misal: "Nasi gorengnya apa aja isinya?"), jawab pakai deskripsi produk dengan santai.
- Variasikan cara kamu merespon, jangan monoton.
- Jangan gunakan format seperti "ID 1: Nama Produk" — bicaralah seperti manusia.
- Jika user ngobrol di luar topik (sapa, tanya kabar, dll.), respon dengan hangat dan tanyakan apakah ada yang bisa dibantu.

PRODUK:
${productContext}

FUNCTION CALLING:
Gunakan function calling hanya untuk transaksi. Jangan pernah menyebut "function calling" atau "tool" ke user.

- User menyebut nama produk tertentu + ingin memesan → start_order (product_id = nomor urut, quantity = jumlah).
  Contoh: "pesan baso baka 2" → product_id=3 (Baso Bakar) quantity=2. "mau nasi" → product_id=1.
- Jika user bilang "mau pesan" tapi BELUM sebut produk → JANGAN panggil start_order. Tanya balik natural, sebut pilihan yang ada.
- User mau batalkan pesanan → cancel_order
- User mau konfirmasi/lanjut pembayaran → confirm_order
- User tanya status pesanannya → get_order_status
- show_menu hanya untuk /menu atau jika user minta tampilan menu formal — JANGAN panggil untuk obrolan biasa

PENTING:
- Jika user tanya "ada apa aja?", "menu apa aja?", "jualan apa?" — jawab langsung dari daftar PRODUK di atas dengan bahasa natural, jangan panggil show_menu
- Jika user ngomong biasa (sapa, tanya produk, rekomendasi, ngobrol), jawab langsung tanpa function call
- Jangan pernah mengulang URL atau format teknis ke user. Biarkan function call yang handle proses transaksi.
- JANGAN PERNAH menampilkan nomor urut menu seperti "1. Nasi" atau "pilih nomor 1-4". Bicaralah natural.
- Jika user menyebut produk dengan ejaan tidak baku (misal "baso baka" untuk "Baso Bakar"), cocokkan ke produk terdekat.`,
        },
      ],
    },
    contents,
    tools: [{ functionDeclarations }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2048 },
  }

  const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(
      `Gemini API error ${response.status}: ${err?.error?.message || response.statusText}`,
    )
  }

  const data = await response.json()
  const parts = data?.candidates?.[0]?.content?.parts || []

  const fnPart = parts.find((p) => p.functionCall)
  if (fnPart) {
    return {
      type: 'function_call',
      name: fnPart.functionCall.name,
      args: fnPart.functionCall.args || {},
    }
  }

  const text = parts.find((p) => p.text)?.text
  if (!text) throw new Error('Gemini tidak memberikan respons yang valid.')

  return { type: 'text', text }
}
