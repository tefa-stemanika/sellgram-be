import { getAllProducts, formatRupiah } from './productService.js'

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

const functionDeclarations = [
  {
    name: 'show_menu',
    description:
      'Tampilkan daftar menu/produk yang tersedia. Panggil ketika user ingin melihat menu, daftar produk, atau menanyakan apa yang dijual.',
  },
  {
    name: 'start_order',
    description:
      'Mulai proses pemesanan. Panggil ketika user ingin memesan atau membeli produk. Ekstrak product_id dan quantity dari pesan user jika disebutkan.',
    parameters: {
      type: 'OBJECT',
      properties: {
        product_id: {
          type: 'INTEGER',
          description:
            'ID produk dari daftar menu. Isi jika user menyebut nama produk spesifik, kosongkan jika belum.',
        },
        quantity: {
          type: 'INTEGER',
          description:
            'Jumlah produk yang dipesan. Isi jika user menyebut angka/jumlah dalam pesanannya, kosongkan jika belum disebutkan.',
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

  const products = await getAllProducts(userId)
  const productContext = products
    .map((p) => `- ID ${p.id}: ${p.name} (${formatRupiah(p.price)})`)
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
          text: `Kamu adalah asisten toko online yang ramah dan membantu.
Jawab dalam bahasa yang sama dengan user (Indonesia atau Inggris).

Produk yang tersedia:
${productContext}

Gunakan function calling untuk aksi berikut:
- User mau lihat menu/produk → panggil show_menu
- User mau pesan/beli sesuatu → panggil start_order, sertakan product_id dan quantity jika disebutkan dalam pesan
- User mau batalkan pesanan → panggil cancel_order
- User mau konfirmasi/lanjut → panggil confirm_order
- User tanya status pesanannya → panggil get_order_status

Untuk obrolan biasa, jawab langsung tanpa function call.`,
        },
      ],
    },
    contents,
    tools: [{ functionDeclarations }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
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
