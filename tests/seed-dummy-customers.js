import 'dotenv/config'
import prisma from '../src/services/db.js'
import { verifyAuthToken } from '../src/utils/jwt.js'

const COUNT = parseInt(process.argv[2] || '100', 10)

if (!process.argv[2]) {
  console.log('Gunakan: node tests/seed-dummy-customers.js <jumlah>')
  console.log('JWT token diambil dari .env atau argumen ke-3')
  process.exit(1)
}

const JWT = process.env.JWT || process.argv[3]

if (!JWT) {
  console.log('JWT tidak ditemukan. Set di .env atau sebagai argumen ke-3')
  process.exit(1)
}

let userId
try {
  const decoded = verifyAuthToken(JWT)
  userId = decoded.userId
} catch {
  console.error('JWT tidak valid')
  process.exit(1)
}

const names = [
  'Budi Santoso', 'Siti Nurhaliza', 'Ahmad Fauzi', 'Dewi Lestari',
  'Rudi Hermawan', 'Rina Wijaya', 'Agus Prasetyo', 'Mega Sari',
  'Doni Kusuma', 'Ani Rahmawati', 'Hendra Gunawan', 'Fitri Handayani',
  'Bambang Supriyadi', 'Yuni Astuti', 'Eko Wahyudi', 'Lina Marlina',
  'Adi Nugroho', 'Tuti Alawiyah', 'Cahyo Saputro', 'Nina Novita',
  'Fajar Ramadhan', 'Indah Permata', 'Gilang Pratama', 'Ratna Dewi',
  'Hadi Prayitno', 'Vera Susanti', 'Irfan Hakim', 'Nadia Putri',
  'Joko Widodo', 'Mira Febriani', 'Krisna Bayu', 'Olivia Tan',
  'Leo Firmansyah', 'Putri Ayu', 'Maman Suherman', 'Rani Kartika',
  'Nando Saputra', 'Sari Indah', 'Oki Setiawan', 'Tia Andini',
  'Prasetyo Budi', 'Umi Kalsum', 'Rizky Pratama', 'Vivi Anggraini',
  'Slamet Riyadi', 'Wulan Suci', 'Teguh Santoso', 'Zahra Amelia',
  'Ujang Kosasih', 'Ayu Pratiwi', 'Wawan Setiawan', 'Bella Candra',
  'Yusuf Maulana', 'Cindy Permana', 'Zulkifli Harahap', 'Dian Pelangi',
  'Arifin Ilham', 'Eva Susanti', 'Saiful Anwar', 'Feni Fitriani',
  'Muchlis Rasyid', 'Gita Gutawa', 'Rahmat Hidayat', 'Hani Nurhayati',
  'Surya Dharma', 'Intan Nuraini', 'Tommy Suharto', 'Jasmine Audrey',
  'Vicky Pratama', 'Karina Ayu', 'Wahyu Nugroho', 'Laras Sekar',
  'Yogi Pratomo', 'Mona Wulandari', 'Binsar Simbolon', 'Niken Saraswati',
  'Edi Susanto', 'Ocha Lestari', 'Guntur Wicaksono', 'Puji Astuti',
  'Husni Mubarak', 'Rika Revina', 'Jefri Nichol', 'Siska Melati',
  'Koko Ardiansyah', 'Tari Ramadhani', 'Lukman Hakim', 'Uchie Noviana',
  'Marwan Siregar', 'Vania Maharani', 'Nizar Alamsyah', 'Winda Gita',
  'Omar Fauzi', 'Yasmin Syahira', 'Prayoga Dwitama', 'Zizi Zulaikha',
  'Rama Aditya', 'Dina Amalia', 'Sandi Pratama', 'Kiki Fatmala',
  'Tito Purnomo', 'Mila Rahayu', 'Ucup Firmansyah', 'Nia Ramadhani',
]

const usernames = [
  'budi_s', 'siti_n', 'ahmad_f', 'dewi_l', 'rudi_h', 'rina_w', 'agus_p',
  'mega_s', 'doni_k', 'ani_r', 'hendra_g', 'fitri_h', 'bambang_s', 'yuni_a',
  'eko_w', 'lina_m', 'adi_n', 'tuti_a', 'cahyo_s', 'nina_n', 'fajar_r',
  'indah_p', 'gilang_p', 'ratna_d', 'hadi_p', 'vera_s', 'irfan_h', 'nadia_p',
  'joko_w', 'mira_f', 'krisna_b', 'olivia_t', 'leo_f', 'putri_a', 'maman_s',
  'rani_k', 'nando_s', 'sari_i', 'oki_s', 'tia_a', 'prasetyo_b', 'umi_k',
  'rizky_p', 'vivi_a', 'slamet_r', 'wulan_s', 'teguh_s', 'zahra_a',
  'ujang_k', 'ayu_p', 'wawan_s', 'bella_c', 'yusuf_m', 'cindy_p',
  'zulkifli_h', 'dian_p', 'arifin_i', 'eva_s', 'saiful_a', 'feni_f',
  'muchlis_r', 'gita_g', 'rahmad_h', 'hani_n', 'surya_d', 'intan_n',
  'tommy_s', 'jasmine_a', 'vicky_p', 'karina_a', 'wahyu_n', 'laras_s',
  'yogi_p', 'mona_w', 'binsar_s', 'niken_s', 'edi_s', 'ocha_l',
  'guntur_w', 'puji_a', 'husni_m', 'rika_r', 'jefri_n', 'siska_m',
  'koko_a', 'tari_r', 'lukman_h', 'uchie_n', 'marwan_s', 'vania_m',
  'nizar_a', 'winda_g', 'omar_f', 'yasmin_s', 'prayoga_d', 'zizi_z',
  'rama_a', 'dina_a', 'sandi_p', 'kiki_f', 'tito_p', 'mila_r', 'ucup_f', 'nia_r',
]

console.log(`Seed ${COUNT} dummy customers untuk user ${userId}...\n`)

let created = 0
const batchSize = 50

for (let i = 0; i < COUNT; i += batchSize) {
  const batch = []
  const end = Math.min(i + batchSize, COUNT)

  for (let j = i; j < end; j++) {
    const idx = j % names.length
    const telegramId = BigInt(Math.floor(Math.random() * 9000000000) + 1000000000)

    batch.push({
      userId,
      telegramId,
      name: `Dummy ${names[idx]}`,
      username: usernames[idx] || `${names[idx].toLowerCase().replace(/\s/g, '_')}_${j}`,
      hasTelegram: true,
      hasWhatsapp: false,
      hasEmail: false,
      source: 'MANUAL',
      totalOrders: 0,
      totalSpent: 0,
      createdAt: new Date(Date.now() - Math.random() * 90 * 86400000),
    })
  }

  try {
    await prisma.customer.createMany({ data: batch, skipDuplicates: true })
    created += batch.length
    process.stdout.write(`\r  Created ${created}/${COUNT} customers...`)
  } catch (err) {
    console.error(`\n  Batch error: ${err.message}`)
  }
}

console.log(`\n\n✅ ${created} dummy customers created!`)
console.log(`   Filter: hasTelegram = true, random Telegram IDs`)

const total = await prisma.customer.count({ where: { userId } })
console.log(`   Total customers untuk user ini: ${total}`)

await prisma.$disconnect()
