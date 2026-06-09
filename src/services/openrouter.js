import { OpenRouter } from '@openrouter/sdk'
import { getAllProducts, formatRupiah } from './productService.js'

const tools = [
  {
    type: 'function',
    function: {
      name: 'show_menu',
      description:
        'Tampilkan daftar menu formal. Hanya panggil jika user menggunakan perintah /menu atau meminta tampilan menu resmi. Untuk obrolan biasa tentang produk, jawab langsung tanpa function call.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_order',
      description:
        'Mulai proses pemesanan. Panggil HANYA jika user menyebut nama produk spesifik. Ekstrak product_id (nomor urut di daftar menu: 1=pertama, 2=kedua, dst.) dan quantity (jumlah) dari pesan user. Contoh: "pesan baso baka 2" → product_id=3 quantity=2. "mau nasi goreng 1" → product_id=1 quantity=1. JANGAN panggil jika user belum menyebut produk — tanya dulu secara natural.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'integer',
            description:
              'Nomor urut produk di daftar menu (1 = produk pertama, 2 = produk kedua, dst.). WAJIB diisi jika user menyebut nama produk — cocokkan nama produk dari user ke daftar produk. Contoh: user bilang "baso baka" → product_id 3 (Baso Bakar).',
          },
          quantity: {
            type: 'integer',
            description:
              'Jumlah produk yang dipesan. Isi jika user menyebut angka/jumlah dalam pesanannya, kosongkan jika belum disebutkan. Contoh: "pesan bakso 4" → quantity=4.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_order',
      description:
        'Batalkan order yang sedang berjalan. Panggil ketika user ingin membatalkan pesanan.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_order',
      description:
        'Konfirmasi dan selesaikan order. Panggil ketika user ingin melanjutkan, membayar, atau mengkonfirmasi pesanan.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_order_status',
      description:
        'Cek status order user saat ini. Panggil ketika user bertanya tentang pesanannya atau ringkasan order.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

function buildSystemPrompt(productContext) {
  return `Kamu adalah customer service toko online yang ramah, hangat, dan natural. Nama toko tidak disebut secara kaku — kamu cukup bicara seperti CS toko beneran.

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
- Jika user menyebut produk dengan ejaan tidak baku (misal "baso baka" untuk "Baso Bakar"), cocokkan ke produk terdekat.`
}

export async function askOpenRouter(userMessage, userId, conversationHistory = []) {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free'

  if (!apiKey)
    throw new Error('OPENROUTER_API_KEY tidak ditemukan di environment.')

  const { products } = await getAllProducts(userId)
  const productContext = products
    .map((p) => `${p.emoji} ${p.name} — ${formatRupiah(p.price)}
   ${p.description}`)
    .join('\n')

  const messages = [
    { role: 'system', content: buildSystemPrompt(productContext) },
    ...conversationHistory.map((msg) => ({
      role: msg.role === 'model' ? 'assistant' : msg.role,
      content: msg.text,
    })),
    { role: 'user', content: userMessage },
  ]

  const client = new OpenRouter({ apiKey })

  const response = await client.chat.send({
    httpReferer: 'https://t.me/ai_bot',
    appTitle: 'Telegram AI Bot',
    chatRequest: {
      model,
      messages,
      tools,
      temperature: 0.9,
      max_tokens: 2048,
    },
  })

  const choice = response?.choices?.[0]

  if (choice?.finishReason === 'tool_calls' && choice.message?.toolCalls?.length > 0) {
    const tc = choice.message.toolCalls[0]
    return {
      type: 'function_call',
      name: tc.function.name,
      args: typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments || '{}')
        : tc.function.arguments || {},
    }
  }

  const text = choice?.message?.content
  if (!text) throw new Error('OpenRouter tidak memberikan respons yang valid.')

  return { type: 'text', text }
}
