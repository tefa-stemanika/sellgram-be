import prisma from '../src/services/db.js'

const TITLES = [
  'Pesanan belum dikonfirmasi',
  'Pembayaran bermasalah',
  'Request reschedule pengiriman',
  'Produk tidak sesuai deskripsi',
  'Keluhan kualitas layanan',
  'Pertanyaan stok produk',
  'Permintaan refund',
  'Umpan balik pelanggan',
  'Kendala akses produk digital',
  'Permintaan custom order',
  'Invoice tidak diterima',
  'Duplicate order',
  'Perubahan alamat pengiriman',
  'Komplain waktu pengiriman',
  'Testimoni penggunaan produk',
  'Permintaan upgrade paket',
  'Kendala pembayaran cicilan',
  'Konfirmasi ketersediaan barang',
  'Laporan bug aplikasi',
  'Request demo produk',
  'Follow up pesanan lama',
  'Permintaan reseller',
  'Kendala login akun',
  'Perubahan data pesanan',
  'Permintaan cancel order',
]

const DESCRIPTIONS = [
  'Pelanggan melaporkan bahwa pesanan belum mendapatkan konfirmasi dari tim kami setelah 2x24 jam.',
  'Pembayaran sudah dilakukan namun status masih pending. Pelanggan meminta bantuan pengecekan.',
  'Pelanggan ingin mereschedule pengiriman karena ada perubahan jadwal.',
  'Produk yang diterima berbeda dari yang ditampilkan di katalog. Pelanggan meminta klarifikasi.',
  'Pelanggan memberikan kritik terkait kualitas layanan yang kurang memuaskan.',
  'Menanyakan ketersediaan stok untuk produk tertentu sebelum melakukan pemesanan.',
  'Pelanggan mengajukan permintaan refund karena produk tidak sesuai ekspektasi.',
  'Memberikan feedback positif dan saran untuk pengembangan produk ke depannya.',
  'Mengalami kendala dalam mengakses produk digital yang sudah dibeli.',
  'Pelanggan ingin memesan produk dengan spesifikasi khusus yang tidak tersedia di katalog.',
  'Invoice untuk pembayaran terakhir belum diterima melalui email.',
  'Terdapat duplikasi pesanan yang perlu segera diresolusi.',
  'Pelanggan ingin mengubah alamat pengiriman karena akan pindah lokasi.',
  'Komplain karena waktu pengiriman melebihi estimasi yang dijanjikan.',
  'Testimoni penggunaan produk setelah 1 bulan pemakaian.',
  'Permintaan upgrade paket ke level yang lebih tinggi.',
  'Kendala dalam proses pembayaran menggunakan metode cicilan.',
  'Konfirmasi apakah barang yang diinginkan masih tersedia.',
  'Melaporkan bug pada aplikasi yang menghambat proses order.',
  'Request untuk demo produk sebelum memutuskan pembelian.',
]

const CUSTOMER_NAMES = [
  'Budi Santoso',
  'Siti Rahmawati',
  'Ahmad Hidayat',
  'Dewi Lestari',
  'Rudi Hermawan',
  'Rina Marlina',
  'Agus Wijaya',
  'Fitri Handayani',
  'Hendra Gunawan',
  'Maya Sari',
  'Doni Prasetyo',
  'Rosa Amelia',
  'Eko Saputra',
  'Ratna Puspita',
  'Adi Nugroho',
  'Tari Susanti',
  'Bayu Pratama',
  'Nurul Hidayah',
  'Fajar Ramadhan',
  'Wulan Dari',
]

const STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
]

const PRIORITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
]

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDate(daysBack) {
  const now = Date.now()
  const past = now - daysBack * 24 * 60 * 60 * 1000
  return new Date(past + Math.random() * (now - past))
}

async function main() {
  const userId = process.argv[2]
  if (!userId) {
    console.error('Usage: node scripts/seed-dummy-tickets.js <userId> [count]')
    process.exit(1)
  }

  const count = parseInt(process.argv[3] || '50', 10)
  if (isNaN(count) || count < 1) {
    console.error('Count must be a positive number')
    process.exit(1)
  }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    console.error(`User not found: ${userId}`)
    process.exit(1)
  }

  console.log(`Seeding ${count} dummy tickets for user ${userId} (${user.name || 'unknown'})...`)

  const tickets = []

  for (let i = 0; i < count; i++) {
    const status = pick(STATUSES)
    const createdAt = randomDate(90)
    const resolvedAt = (status === 'RESOLVED' || status === 'CLOSED')
      ? new Date(createdAt.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000)
      : null
    const closedAt = status === 'CLOSED'
      ? new Date((resolvedAt || createdAt).getTime() + Math.random() * 2 * 24 * 60 * 60 * 1000)
      : null

    tickets.push({
      userId,
      title: pick(TITLES),
      description: Math.random() > 0.3 ? pick(DESCRIPTIONS) : null,
      status,
      priority: pick(PRIORITIES),
      source: Math.random() > 0.4 ? 'ORDER' : 'MANUAL',
      customerName: Math.random() > 0.2 ? pick(CUSTOMER_NAMES) : null,
      customerContact: Math.random() > 0.3 ? `08${String(Math.floor(Math.random() * 900000000) + 100000000)}` : null,
      resolvedAt,
      closedAt,
      createdAt,
    })
  }

  const created = await prisma.ticket.createMany({ data: tickets })
  console.log(`Created ${created.count} tickets`)

  const dbTickets = await prisma.ticket.findMany({
    where: { userId },
    select: { id: true, title: true, status: true, priority: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: count,
  })

  console.log(`\nSample tickets:`)
  console.log(`  Status dist: OPEN=${dbTickets.filter(t => t.status === 'OPEN').length}, IN_PROGRESS=${dbTickets.filter(t => t.status === 'IN_PROGRESS').length}, WAITING_CUSTOMER=${dbTickets.filter(t => t.status === 'WAITING_CUSTOMER').length}, RESOLVED=${dbTickets.filter(t => t.status === 'RESOLVED').length}, CLOSED=${dbTickets.filter(t => t.status === 'CLOSED').length}, CANCELLED=${dbTickets.filter(t => t.status === 'CANCELLED').length}`)
  console.log(`  Priority dist: LOW=${dbTickets.filter(t => t.priority === 'LOW').length}, MEDIUM=${dbTickets.filter(t => t.priority === 'MEDIUM').length}, HIGH=${dbTickets.filter(t => t.priority === 'HIGH').length}, URGENT=${dbTickets.filter(t => t.priority === 'URGENT').length}`)
  console.log(`  Date range: ${dbTickets[dbTickets.length - 1]?.createdAt?.toISOString().slice(0, 10)} ~ ${dbTickets[0]?.createdAt?.toISOString().slice(0, 10)}`)
  console.log(`\nDone. Total tickets: ${dbTickets.length}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
