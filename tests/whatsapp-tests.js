// tests/whatsapp-tests.js
// Unit test helper WhatsApp (tanpa memanggil Evolution API).

import 'dotenv/config'
import {
  extractWhatsAppMessage,
  buildProductListText,
  extractPhoneFromJid,
  normalizeWhatsAppJid,
} from '../src/handlers/whatsappHandler.js'
import {
  shouldProcessWhatsAppItem,
  buildTenantInstanceName,
  validateWhatsAppNumber,
  normalizeQrPayload,
  normalizeInstanceState,
  extractAlternativeJid,
  matchContactByLid,
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

run('listResponseMessage menghasilkan selection', () => {
  const result = extractWhatsAppMessage({
    message: {
      listResponseMessage: {
        title: 'Menu Produk',
        singleSelectReply: { selectedRowId: 'product:abc-123' },
      },
    },
  })
  assertEqual(result.kind, 'selection', 'kind selection')
  assertEqual(result.id, 'product:abc-123', 'rowId dipakai sebagai id')
})

run('buttonsResponseMessage menghasilkan selection', () => {
  const result = extractWhatsAppMessage({
    message: {
      buttonsResponseMessage: {
        selectedButtonId: 'confirm',
        selectedDisplayText: 'Konfirmasi',
      },
    },
  })
  assertEqual(result.id, 'confirm', 'button id')
  assertEqual(result.text, 'Konfirmasi', 'display text')
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

if (process.exitCode) {
  console.error('\n❌ Ada test WhatsApp yang gagal.')
} else {
  console.log('\n✅ Semua test WhatsApp lulus.')
}
