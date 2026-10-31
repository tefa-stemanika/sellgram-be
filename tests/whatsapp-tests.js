// tests/whatsapp-tests.js
// Unit test helper WhatsApp (tanpa memanggil Evolution API).

import 'dotenv/config'
import crypto from 'node:crypto'
import {
  extractWhatsAppMessage,
  buildProductListText,
  parseCommand,
} from '../src/handlers/whatsappHandler.js'
import {
  extractPhoneFromJid,
  normalizeWhatsAppJid,
  normalizePhoneJid,
  maskChatId,
} from '../src/services/whatsappJid.js'
import { safeEmoji, safePlainText } from '../src/services/safeText.js'
import { generateOrderId } from '../src/services/orderService.js'
import { verifySubscriptionWebhookSignature, parseGrossAmount } from '../src/services/midtrans.js'
import {
  verifyEvolutionWebhookSecret,
  buildEvolutionWebhookSecret,
} from '../src/services/evolution.js'
import {
  shouldProcessWhatsAppItem,
  buildTenantInstanceName,
  validateWhatsAppNumber,
  normalizeQrPayload,
  normalizeInstanceState,
  extractAlternativeJid,
  matchContactByLid,
  isStaleQueuedMessage,
} from '../src/services/whatsappManager.js'
import { assert, assertEqual } from './test-helpers.js'
import {
  buildBuyerIdentity,
  buildBuyerLabel,
} from '../src/services/adminBot.js'

function run(name, fn) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (error) {
    console.error(`❌ ${name}`)
    console.error(`   ${error.message}`)
    process.exitCode = 1
  }
}

run('conversation text diekstrak', () => {
  const result = extractWhatsAppMessage({
    message: { conversation: '  halo bot  ' },
  })
  assertEqual(result.kind, 'text', 'kind text')
  assertEqual(result.text, 'halo bot', 'text trimmed')
})

run('extendedTextMessage diekstrak', () => {
  const result = extractWhatsAppMessage({
    message: { extendedTextMessage: { text: '/menu' } },
  })
  assertEqual(result.text, '/menu', 'text dari extendedTextMessage')
})

run('pesan interaktif lama tidak lagi menghasilkan selection', () => {
  const list = extractWhatsAppMessage({
    message: {
      listResponseMessage: {
        title: 'Menu Produk',
        singleSelectReply: { selectedRowId: 'product:abc-123' },
      },
    },
  })
  assertEqual(list, null, 'listReply diabaikan')

  const button = extractWhatsAppMessage({
    message: {
      buttonsResponseMessage: {
        selectedButtonId: 'confirm',
        selectedDisplayText: 'Konfirmasi',
      },
    },
  })
  assertEqual(button, null, 'buttonReply diabaikan')
})

run('editedMessage dan viewOnceMessageV2 dibuka wrapper-nya', () => {
  const edited = extractWhatsAppMessage({
    message: {
      editedMessage: {
        message: {
          conversationText: null,
          extendedTextMessage: { text: 'diedit jadi ini' },
        },
      },
    },
  })
  assertEqual(edited?.text, 'diedit jadi ini', 'editedMessage unwrap')

  const viewOnce = extractWhatsAppMessage({
    message: {
      viewOnceMessageV2: {
        message: { ephemeralMessage: { message: { conversation: 'sekali lihat' } } },
      },
    },
  })
  assertEqual(viewOnce?.text, 'sekali lihat', 'wrapper bersarang unwrap')
})

run('perintah uang/session-wipe hanya jalan dengan slash', () => {
  assertEqual(parseCommand('/konfirmasi'), 'confirm', 'slash konfirmasi')
  assertEqual(parseCommand('konfirmasi'), null, 'tanpa slash ditolak')
  assertEqual(parseCommand('bayar'), null, 'kata bayar tidak memicu pembayaran')
  assertEqual(parseCommand('reset'), null, 'tanpa slash reset ditolak')
  assertEqual(parseCommand('/reset'), 'reset', 'slash reset diterima')
  assertEqual(parseCommand('/batal'), 'cancel', 'slash batal')
  assertEqual(parseCommand('batal'), 'cancel', 'batal terbuka tanpa slash')
  assertEqual(parseCommand('menu sekarang'), 'menu', 'command di awal kalimat')
  assertEqual(parseCommand('  /START  '), 'start', 'case dan spasi diabaikan')
  assertEqual(parseCommand('mohon reset dulu'), null, 'kalimat biasa bukan perintah')
  assertEqual(parseCommand(''), null, 'teks kosong null')
  assertEqual(parseCommand('/'), null, 'slash saja null')
  assertEqual(parseCommand('1'), null, 'angka bukan perintah')
})

run('sanitize teks markup untuk pesan Markdown', () => {
  assertEqual(safePlainText('Kopi *Gunung* _Aceh_'), 'Kopi Gunung Aceh', 'markup dibuang')
  assertEqual(safePlainText('a\nb'), 'a b', 'newline dipangkas')
  assertEqual(safePlainText(null, 80, '-'), '-', 'null jadi placeholder')
  assertEqual(
    safePlainText('👍'.repeat(60), 10, ''),
    '👍'.repeat(10),
    'potong per kode poin, bukan per unit UTF-16',
  )
  assertEqual(safeEmoji('🛒'), '🛒', 'emoji utuh')
  assertEqual(safeEmoji(undefined), '🛍️', 'emoji default')
  assertEqual(safeEmoji(null, ''), '', 'placeholder kosong')
})

run('secret webhook Evolution diverifikasi tanpa timing leak', () => {
  const secret = buildEvolutionWebhookSecret('user-test')
  if (!secret) {
    console.log('   (dilewati: ENCRYPTION_KEY/EVOLUTION_WEBHOOK_SECRET tidak diisi)')
    return
  }
  assert(verifyEvolutionWebhookSecret('user-test', secret), 'secret valid diterima')
  assert(!verifyEvolutionWebhookSecret('user-test', `${secret}x`), 'secret salah ditolak')
  assert(!verifyEvolutionWebhookSecret('user-test', ''), 'secret kosong ditolak')
  assert(!verifyEvolutionWebhookSecret('user-test', undefined), 'secret hilang ditolak')
  assert(
    !verifyEvolutionWebhookSecret('user-lain', secret),
    'secret tenant lain ditolak',
  )
})

run('ephemeral wrapper + caption media diekstrak', () => {
  const result = extractWhatsAppMessage({
    message: {
      ephemeralMessage: {
        message: {
          imageMessage: { caption: 'pesan dari gambar' },
        },
      },
    },
  })
  assertEqual(result.kind, 'text', 'kind text')
  assertEqual(result.text, 'pesan dari gambar', 'caption')
})

run('pesan non-teks ditandai unsupported', () => {
  const result = extractWhatsAppMessage({
    message: { audioMessage: { mimetype: 'audio/ogg' } },
    messageType: 'audioMessage',
  })
  assertEqual(result.kind, 'unsupported', 'kind unsupported')
})

run('pesan tanpa konten mengembalikan null', () => {
  assertEqual(extractWhatsAppMessage({ message: {} }), null, 'result null')
})

run('filter item: fromMe / grup / broadcast / tanpa key ditolak', () => {
  const base = {
    key: { remoteJid: '6281234567890@s.whatsapp.net', id: 'M1' },
    message: { conversation: 'halo' },
  }
  assert(shouldProcessWhatsAppItem(base), 'pesan private lolos')
  assert(
    !shouldProcessWhatsAppItem({ ...base, key: { ...base.key, fromMe: true } }),
    'fromMe ditolak',
  )
  assert(
    !shouldProcessWhatsAppItem({
      ...base,
      key: { ...base.key, remoteJid: '123-456@g.us' },
    }),
    'grup ditolak',
  )
  assert(
    !shouldProcessWhatsAppItem({
      ...base,
      key: { ...base.key, remoteJid: 'status@broadcast' },
    }),
    'status broadcast ditolak',
  )
  assert(!shouldProcessWhatsAppItem({ message: {} }), 'tanpa key ditolak')
})

run('normalisasi JID device suffix dan ekstraksi nomor', () => {
  assertEqual(
    normalizeWhatsAppJid('6281234567890:35@s.whatsapp.net'),
    '6281234567890@s.whatsapp.net',
    'device suffix dibuang',
  )
  assertEqual(
    extractPhoneFromJid('6281234567890:35@s.whatsapp.net'),
    '6281234567890',
    'nomor diekstrak',
  )
  assertEqual(extractPhoneFromJid('123456@lid'), null, 'lid bukan nomor telepon')
  assertEqual(extractPhoneFromJid('123-456@g.us'), null, 'grup bukan nomor telepon')
  assertEqual(
    normalizePhoneJid('6281234567890:35@s.whatsapp.net'),
    '6281234567890@s.whatsapp.net',
    'normalizePhoneJid membuang device suffix',
  )
  assertEqual(normalizePhoneJid('6281234567890@lid'), null, 'normalizePhoneJid menolak lid')
})

run('buildProductListText menampilkan semua produk bernomor', () => {
  const products = Array.from({ length: 12 }, (_, index) => ({
    id: `product-${index + 1}`,
    name: `Produk ${index + 1}`,
    emoji: '📦',
    price: 10_000 + index,
    description: 'Deskripsi produk',
  }))

  const text = buildProductListText(products)

  assert(text.includes('1. 📦 Produk 1'), 'produk pertama bernomor')
  assert(text.includes('12. 📦 Produk 12'), 'semua produk tampil')
  assert(text.includes('Rp'), 'harga tampil')
  assert(text.includes('Ketik nomor produk untuk memesan.'), 'instruksi pemesanan')
})

run('buildProductListText mengembalikan null untuk list kosong', () => {
  assertEqual(buildProductListText([]), null, 'list kosong null')
  assertEqual(buildProductListText(null), null, 'null input null')
})

run('buildTenantInstanceName deterministik dan aman', () => {
  assertEqual(
    buildTenantInstanceName('123E4567-E89B-12D3-A456-426614174000'),
    'tenant-123e4567e89b12d3a456426614174000',
    'uuid dinormalisasi',
  )
  assertEqual(buildTenantInstanceName(''), null, 'userId kosong null')
  assertEqual(buildTenantInstanceName('!!!'), null, 'tanpa karakter valid null')
  assert(
    buildTenantInstanceName('a'.repeat(100)).length <= 60,
    'nama instance <= 60 karakter',
  )
})

run('validateWhatsAppNumber menerima 8-15 digit', () => {
  assertEqual(
    validateWhatsAppNumber('+62 812-3456-7890'),
    '6281234567890',
    'format manusia dinormalisasi',
  )
  assertEqual(validateWhatsAppNumber('12345678'), '12345678', '8 digit valid')
  assertEqual(validateWhatsAppNumber('1234567'), null, '7 digit ditolak')
  assertEqual(validateWhatsAppNumber('1234567890123456'), null, '16 digit ditolak')
  assertEqual(validateWhatsAppNumber(''), null, 'kosong ditolak')
  assertEqual(validateWhatsAppNumber(null), null, 'null ditolak')
})

run('normalizeQrPayload membaca bentuk respons Evolution', () => {
  const longBase64 = `data:image/png;base64,${'A'.repeat(120)}`

  const flat = normalizeQrPayload({
    pairingCode: null,
    code: ' 2@abc ',
    base64: longBase64,
    count: '3',
  })
  assertEqual(flat.code, '2@abc', 'code di-trim')
  assertEqual(flat.base64, longBase64, 'base64 valid')
  assertEqual(flat.pairingCode, null, 'pairingCode null')
  assertEqual(flat.count, 3, 'count dikonversi ke angka')

  const nested = normalizeQrPayload({
    qrcode: { base64: longBase64, code: '2@nested' },
  })
  assertEqual(nested.code, '2@nested', 'qrcode nested terbaca')

  const deepNested = normalizeQrPayload({
    instance: { qrcode: { pairingCode: 'ABCD1234' } },
  })
  assertEqual(deepNested.pairingCode, 'ABCD1234', 'instance.qrcode terbaca')

  assertEqual(
    normalizeQrPayload({ base64: 'data:image/png;base64,\n' }),
    null,
    'base64 kosong ditolak',
  )
  assertEqual(
    normalizeQrPayload({ instance: { instanceName: 'x', state: 'open' } }),
    null,
    'respons tanpa QR null',
  )
  assertEqual(normalizeQrPayload(null), null, 'null input null')
})

run('normalizeInstanceState membaca state dari berbagai bentuk', () => {
  assertEqual(
    normalizeInstanceState({ instance: { instanceName: 'x', state: 'open' } }),
    'open',
    'instance.state',
  )
  assertEqual(normalizeInstanceState({ state: 'connecting' }), 'connecting', 'state')
  assertEqual(
    normalizeInstanceState({ connectionStatus: 'close' }),
    'close',
    'connectionStatus',
  )
  assertEqual(normalizeInstanceState({}), null, 'tanpa state null')
})

run('extractAlternativeJid memetakan @lid ke nomor telepon', () => {
  assertEqual(
    extractAlternativeJid({
      remoteJid: '239689676136519@lid',
      remoteJidAlt: '6281313747177@s.whatsapp.net',
    }),
    '6281313747177@s.whatsapp.net',
    'remoteJidAlt dipakai',
  )
  assertEqual(
    extractAlternativeJid({ senderPn: '6281313747177:12@s.whatsapp.net' }),
    '6281313747177@s.whatsapp.net',
    'senderPn dinormalisasi',
  )
  assertEqual(
    extractAlternativeJid({ participantAlt: '6281313747177@s.whatsapp.net' }),
    '6281313747177@s.whatsapp.net',
    'participantAlt dipakai',
  )
  assertEqual(
    extractAlternativeJid({ remoteJidAlt: '239689676136519@lid' }),
    null,
    'LID bukan alternatif telepon',
  )
  assertEqual(extractAlternativeJid({}), null, 'tanpa alt null')
})

run('matchContactByLid memetakan @lid bila kandidat tunggal', () => {
  const contacts = [
    {
      remoteJid: '239689676136519@lid',
      pushName: 'zhekabaila',
      profilePicUrl: 'https://pps.whatsapp.net/same.jpg',
    },
    {
      remoteJid: '6281313747177@s.whatsapp.net',
      pushName: 'zhekabaila',
      profilePicUrl: 'https://pps.whatsapp.net/same.jpg',
    },
    {
      remoteJid: '6281111111111@s.whatsapp.net',
      pushName: 'lain',
      profilePicUrl: 'https://pps.whatsapp.net/other.jpg',
    },
  ]

  assertEqual(
    matchContactByLid(contacts, '239689676136519@lid'),
    '6281313747177@s.whatsapp.net',
    'kandidat tunggal dipakai',
  )

  assertEqual(
    matchContactByLid(
      [
        ...contacts,
        {
          remoteJid: '6281313747178@s.whatsapp.net',
          pushName: 'zhekabaila',
          profilePicUrl: 'https://pps.whatsapp.net/same.jpg',
        },
      ],
      '239689676136519@lid',
    ),
    null,
    'kandidat ambigu ditolak',
  )

  assertEqual(
    matchContactByLid(
      [{ remoteJid: '239689676136519@lid', profilePicUrl: null }],
      '239689676136519@lid',
    ),
    null,
    'tanpa profile picture ditolak',
  )
})

run('notifikasi admin memakai nomor HP untuk order WhatsApp', () => {
  const order = {
    source: 'WHATSAPP',
    firstName: 'Budi',
    customerName: 'Budi',
    customerPhone: '6281313747177',
    whatsappId: '6281313747177@s.whatsapp.net',
    telegramId: null,
  }

  const identity = buildBuyerIdentity(order)
  assert(!identity.includes('Telegram ID'), 'tidak menampilkan Telegram ID')
  assert(identity.includes('Sumber: WhatsApp'), 'menampilkan sumber WhatsApp')
  assert(identity.includes('No. HP: +6281313747177'), 'menampilkan nomor HP')

  const label = buildBuyerLabel(order)
  assertEqual(
    label,
    'Budi (WhatsApp +6281313747177)',
    'label ringkas order WhatsApp',
  )
})

run('notifikasi admin memakai nomor HP dari JID bila customerPhone kosong', () => {
  const order = {
    source: 'WHATSAPP',
    firstName: 'Siti',
    customerPhone: null,
    whatsappId: '6281234567890:12@s.whatsapp.net',
    telegramId: null,
  }

  assert(
    buildBuyerIdentity(order).includes('No. HP: +6281234567890'),
    'nomor diambil dari whatsappId',
  )
})

run('notifikasi admin order Telegram tetap menampilkan Telegram ID', () => {
  const order = {
    source: 'TELEGRAM',
    firstName: 'Andi',
    username: 'andi',
    telegramId: 123456789n,
    customerPhone: null,
  }

  const identity = buildBuyerIdentity(order)
  assert(identity.includes('Telegram ID: `123456789`'), 'Telegram ID tampil')
  assert(!identity.includes('No. HP'), 'tidak menampilkan nomor HP')
  assertEqual(
    buildBuyerLabel(order),
    'Andi (@andi)',
    'label ringkas order Telegram',
  )
})

run('maskChatId menyembunyikan nomor di log', () => {
  assertEqual(maskChatId('6281234567890@s.whatsapp.net'), '6281…90@s.whatsapp.net', 'nomor disamarkan')
  assertEqual(
    maskChatId('6281234567890:35@s.whatsapp.net'),
    '6281…90@s.whatsapp.net',
    'device suffix dibuang sebelum disamarkan',
  )
  assert(!maskChatId('6281234567890@s.whatsapp.net').includes('45678'), 'digit tengah hilang')
  assertEqual(maskChatId('239689676136519@lid'), '2396…19@lid', 'LID disamarkan')
  assertEqual(maskChatId(''), '-', 'kosong placeholder')
  assertEqual(maskChatId(null), '-', 'null placeholder')
})

run('isStaleQueuedMessage menangani timestamp detik dan milidetik', () => {
  const nowSeconds = Math.floor(Date.now() / 1000)

  assertEqual(
    isStaleQueuedMessage({ messageTimestamp: nowSeconds - 60 }),
    false,
    '60 detik lalu masih segar',
  )
  assertEqual(
    isStaleQueuedMessage({ messageTimestamp: nowSeconds - 1000 }),
    true,
    '1000 detik lalu basi',
  )
  assertEqual(
    isStaleQueuedMessage({ messageTimestamp: (nowSeconds - 60) * 1000 }),
    false,
    'milidetik 60 detik lalu masih segar',
  )
  assertEqual(
    isStaleQueuedMessage({ messageTimestamp: (nowSeconds - 1000) * 1000 }),
    true,
    'milidetik 1000 detik lalu basi',
  )
  assertEqual(isStaleQueuedMessage({}), false, 'tanpa timestamp tidak dianggap basi')
  assertEqual(isStaleQueuedMessage(null), false, 'null tidak dianggap basi')
})

run('generateOrderId cukup entropy untuk lintas tenant', () => {
  const first = generateOrderId()

  assert(/^ORD-\d{8}-[0-9A-F]{10}$/.test(first), `format ORD-YYYYMMDD-HEX10, dapat ${first}`)
  assert(first.length <= 30, `muat di VarChar(30), panjang ${first.length}`)

  const ids = new Set()
  for (let i = 0; i < 500; i += 1) ids.add(generateOrderId())
  assertEqual(ids.size, 500, '500 order id tanpa duplikat')
})

run('parseGrossAmount membaca bentuk nominal yang berbeda', () => {
  assertEqual(parseGrossAmount('25000'), 25000, 'integer polos')
  assertEqual(parseGrossAmount('25000.00'), 25000, 'desimal Midtrans')
  assertEqual(parseGrossAmount('25.000'), 25000, 'grouping gaya Indonesia')
  assertEqual(parseGrossAmount('25.000,50'), 25000.5, 'grouping + desimal koma')
  assertEqual(parseGrossAmount('1,234,567'), 1234567, 'grouping koma')
  assertEqual(parseGrossAmount('25000.000'), 25000, 'desimal 3 digit bukan ribuan')
  assertEqual(parseGrossAmount('1.234'), 1234, 'grouping titik polos')
  assertEqual(parseGrossAmount('Rp25.000'), 25000, 'prefiks mata uang dibersihkan')
  assertEqual(Number.isNaN(parseGrossAmount('')), true, 'kosong bukan angka')
  assertEqual(Number.isNaN(parseGrossAmount(undefined)), true, 'hilang bukan angka')
})

run('verifikasi signature webhook subscription', () => {
  const serverKey = 'test-platform-server-key'
  const previous = process.env.PLATFORM_MIDTRANS_SERVER_KEY
  process.env.PLATFORM_MIDTRANS_SERVER_KEY = serverKey

  try {
    const notification = {
      order_id: 'SUB-INV-0001',
      status_code: '200',
      gross_amount: '150000',
      transaction_status: 'settlement',
    }
    const signature = crypto
      .createHash('sha512')
      .update(`${notification.order_id}${notification.status_code}${notification.gross_amount}${serverKey}`)
      .digest('hex')

    assert(
      verifySubscriptionWebhookSignature({ ...notification, signature_key: signature }),
      'signature sah diterima',
    )
    assert(
      !verifySubscriptionWebhookSignature({
        ...notification,
        signature_key: signature,
        gross_amount: '1',
      }),
      'gross_amount diubah ditolak',
    )
    assert(
      !verifySubscriptionWebhookSignature({ ...notification, signature_key: 'x'.repeat(128) }),
      'signature salah ditolak',
    )
    assert(
      !verifySubscriptionWebhookSignature({ ...notification, signature_key: null }),
      'tanpa signature_key ditolak',
    )
    assert(!verifySubscriptionWebhookSignature(notification), 'notification tanpa signature ditolak')

    delete process.env.PLATFORM_MIDTRANS_SERVER_KEY
    assert(
      !verifySubscriptionWebhookSignature({ ...notification, signature_key: signature }),
      'key platform belum dikonfigurasi → ditolak (fail closed)',
    )
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_MIDTRANS_SERVER_KEY
    else process.env.PLATFORM_MIDTRANS_SERVER_KEY = previous
  }
})

if (process.exitCode) {
  console.error('\n❌ Ada test WhatsApp yang gagal.')
} else {
  console.log('\n✅ Semua test WhatsApp lulus.')
}
