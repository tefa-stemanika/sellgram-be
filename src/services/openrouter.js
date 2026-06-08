import { OpenRouter } from '@openrouter/sdk'
import { getAllProducts, formatRupiah } from './productService.js'

const tools = [
  {
    type: 'function',
    function: {
      name: 'show_menu',
      description:
        'Tampilkan daftar menu/produk yang tersedia. Panggil ketika user ingin melihat menu, daftar produk, atau menanyakan apa yang dijual.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_order',
      description:
        'Mulai proses pemesanan. Panggil ketika user ingin memesan atau membeli produk. Ekstrak product_id dan quantity dari pesan user jika disebutkan.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'integer',
            description:
              'ID produk dari daftar menu. Isi jika user menyebut nama produk spesifik, kosongkan jika belum.',
          },
          quantity: {
            type: 'integer',
            description:
              'Jumlah produk yang dipesan. Isi jika user menyebut angka/jumlah dalam pesanannya, kosongkan jika belum disebutkan.',
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
  return `Kamu adalah asisten toko online yang ramah dan membantu.
Jawab dalam bahasa yang sama dengan user (Indonesia atau Inggris).

Produk yang tersedia:
${productContext}

Gunakan function calling untuk aksi berikut:
- User mau lihat menu/produk → panggil show_menu
- User mau pesan/beli sesuatu → panggil start_order, sertakan product_id dan quantity jika disebutkan dalam pesan
- User mau batalkan pesanan → panggil cancel_order
- User mau konfirmasi/lanjut → panggil confirm_order
- User tanya status pesanannya → panggil get_order_status

Untuk obrolan biasa, jawab langsung tanpa function call.`
}

export async function askOpenRouter(userMessage, userId, conversationHistory = []) {
  const apiKey = process.env.OPENROUTER_API_KEY
  const model = process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free'

  if (!apiKey)
    throw new Error('OPENROUTER_API_KEY tidak ditemukan di environment.')

  const { products } = await getAllProducts(userId)
  const productContext = products
    .map((p) => `- ID ${p.id}: ${p.name} (${formatRupiah(p.price)})`)
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
      temperature: 0.7,
      max_tokens: 1024,
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
