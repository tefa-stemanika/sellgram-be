// prisma/seed-config.js
// Migrasi konfigurasi dari .env ke database.
// Jalankan SEKALI dengan: npm run db:seed-config
//
// Script ini membaca nilai dari .env, enkripsi credentials-nya,
// lalu simpan ke tabel bot_config dan bot_credentials.
// Setelah ini, .env hanya perlu DATABASE_URL, WEBHOOK_PORT,
// BOT_MODE, dan ENCRYPTION_KEY.

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { encrypt } from '../src/utils/encryption.js'

const prisma = new PrismaClient()
const DEFAULT_SEED_USER_EMAIL =
  process.env.SEED_USER_EMAIL || 'seed-owner@localhost.local'

async function main() {
  console.log('🔄 Memulai migrasi config dari .env ke database...\n')

  const user = await prisma.user.upsert({
    where: { email: DEFAULT_SEED_USER_EMAIL },
    update: { isActive: true },
    create: {
      email: DEFAULT_SEED_USER_EMAIL,
      passwordHash: 'seed-password-hash',
      name: 'Seed Store Owner',
      plan: 'PRO',
      isActive: true,
    },
  })

  // ── 1. Buat atau update BotConfig ─────────────────────────────────────────
  const config = await prisma.botConfig.upsert({
    where: { userId_isActive: { userId: user.id, isActive: true } },
    update: {
      aiEnabled: process.env.AI_ENABLED !== 'false',
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      isActive: true,
    },
    create: {
      userId: user.id,
      aiEnabled: process.env.AI_ENABLED !== 'false',
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      isActive: true,
    },
  })

  console.log('✅ BotConfig tersimpan:')
  console.log(`   AI Enabled:           ${config.aiEnabled}`)
  console.log(`   Gemini Model:         ${config.geminiModel}`)
  console.log(`   Midtrans Production:  ${config.midtransIsProduction}\n`)

  // ── 2. Enkripsi & simpan credentials ──────────────────────────────────────
  // Daftar credentials yang akan dipindahkan dari .env ke DB
  const credentialKeys = [
    { key: 'TELEGRAM_BOT_TOKEN', envKey: 'TELEGRAM_BOT_TOKEN' },
    { key: 'ADMIN_BOT_TOKEN', envKey: 'ADMIN_BOT_TOKEN' },
    { key: 'ADMIN_CHAT_ID', envKey: 'ADMIN_CHAT_ID' },
    { key: 'GEMINI_API_KEY', envKey: 'GEMINI_API_KEY' },
    { key: 'MIDTRANS_SERVER_KEY', envKey: 'MIDTRANS_SERVER_KEY' },
    { key: 'MIDTRANS_CLIENT_KEY', envKey: 'MIDTRANS_CLIENT_KEY' },
  ]

  let saved = 0
  let skipped = 0

  for (const { key, envKey } of credentialKeys) {
    const value = process.env[envKey]

    if (!value) {
      console.warn(`⚠️  Skipped "${key}" — tidak ada di .env`)
      skipped++
      continue
    }

    const encrypted = encrypt(value)

    await prisma.botCredential.upsert({
      where: { userId_key: { userId: user.id, key } },
      update: { value: encrypted },
      create: { userId: user.id, key, value: encrypted },
    })

    // Tampilkan sebagian nilai asli untuk konfirmasi (bukan full value!)
    const preview =
      value.length > 8 ? value.slice(0, 6) + '...' + value.slice(-4) : '***'

    console.log(`✅ "${key}" → terenkripsi (preview: ${preview})`)
    saved++
  }

  console.log(`\n📊 Ringkasan:`)
  console.log(`   Tersimpan: ${saved} credentials`)
  console.log(`   Dilewati:  ${skipped} credentials`)
  console.log(`\n🎉 Migrasi selesai!`)
  console.log(`\n📝 Langkah selanjutnya:`)
  console.log(`   1. Hapus credentials berikut dari .env (sudah aman di DB):`)
  console.log(`      TELEGRAM_BOT_TOKEN, ADMIN_BOT_TOKEN, ADMIN_CHAT_ID`)
  console.log(`      GEMINI_API_KEY, MIDTRANS_SERVER_KEY, MIDTRANS_CLIENT_KEY`)
  console.log(`      AI_ENABLED, GEMINI_MODEL, MIDTRANS_IS_PRODUCTION`)
  console.log(`   2. Pastikan ENCRYPTION_KEY tetap ada di .env`)
  console.log(`   3. Restart bot: npm run dev`)
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
