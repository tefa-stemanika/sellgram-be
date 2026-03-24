// prisma/seed-migration-m6.js
// Migration script untuk mengkonversi data single-tenant ke multi-tenant.
//
// Langkah:
// 1. Buat user default dengan ID=1 dan load credentials dari .env
// 2. Migrate semua existing BotConfig, BotCredential, Product, Order ke user_id=1
// 3. Jalankan: npm run db:seed-migration-m6

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { encrypt } from '../src/utils/encryption.js'

const prisma = new PrismaClient()

// ── Dummy products untuk initial seeding ──────────────────────────────────────
const seedProducts = [
  {
    name: 'Nasi Goreng Spesial',
    description: 'Nasi goreng dengan telur, ayam, dan kerupuk',
    price: 25000,
    emoji: '🍳',
  },
  {
    name: 'Mie Ayam Bakso',
    description: 'Mie ayam dengan bakso jumbo dan pangsit goreng',
    price: 20000,
    emoji: '🍜',
  },
  {
    name: 'Es Teh Manis',
    description: 'Teh manis dingin segar',
    price: 5000,
    emoji: '🧋',
  },
  {
    name: 'Jus Alpukat',
    description: 'Jus alpukat segar dengan susu kental manis',
    price: 15000,
    emoji: '🥑',
  },
  {
    name: 'Ayam Bakar',
    description: 'Ayam bakar bumbu kecap dengan nasi dan lalapan',
    price: 35000,
    emoji: '🍗',
  },
]

async function main() {
  console.log(
    '🔄 Memulai migrasi M6 (single-tenant → multi-tenant dengan .env credentials)...\n',
  )

  try {
    // Step 1: Cek dan buat user default jika belum ada
    let user = await prisma.user.findFirst({
      where: { id: 1 },
    })

    if (!user) {
      console.log('📝 Membuat user default dengan credentials dari .env...')
      user = await prisma.user.create({
        data: {
          id: 1, // Fixed ID untuk migrasi
          email: 'admin@localhost.local',
          passwordHash: '', // Akan diupdate via dashboard nanti
          name: 'Default Store Owner',
          plan: 'PRO', // Kasih PRO supaya bisa unlimited
          isActive: true,
        },
      })
      console.log(`✅ User dibuat: ID=${user.id}, Email=${user.email}\n`)
    } else {
      console.log(`✅ User 1 sudah ada: ${user.name}\n`)
    }

    // Step 2: Setup BotConfig dari .env untuk user 1
    console.log('📝 Setup BotConfig dari .env...')
    const botConfig = await prisma.botConfig.upsert({
      where: { id: 1 },
      update: {
        userId: 1,
        aiEnabled: process.env.AI_ENABLED !== 'false',
        geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
        isActive: true,
      },
      create: {
        userId: 1,
        aiEnabled: process.env.AI_ENABLED !== 'false',
        geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        midtransIsProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
        isActive: true,
      },
    })

    console.log('✅ BotConfig tersimpan untuk user 1:')
    console.log(`   AI Enabled:           ${botConfig.aiEnabled}`)
    console.log(`   Gemini Model:         ${botConfig.geminiModel}`)
    console.log(`   Midtrans Production:  ${botConfig.midtransIsProduction}\n`)

    // Step 3: Setup credentials dari .env untuk user 1
    console.log('📝 Setup credentials dari .env untuk user 1...')
    const credentialKeys = [
      { key: 'TELEGRAM_BOT_TOKEN', envKey: 'TELEGRAM_BOT_TOKEN' },
      { key: 'ADMIN_BOT_TOKEN', envKey: 'ADMIN_BOT_TOKEN' },
      { key: 'ADMIN_CHAT_ID', envKey: 'ADMIN_CHAT_ID' },
      { key: 'GEMINI_API_KEY', envKey: 'GEMINI_API_KEY' },
      { key: 'MIDTRANS_SERVER_KEY', envKey: 'MIDTRANS_SERVER_KEY' },
      { key: 'MIDTRANS_CLIENT_KEY', envKey: 'MIDTRANS_CLIENT_KEY' },
    ]

    let credentialsSaved = 0
    let credentialsSkipped = 0

    for (const { key, envKey } of credentialKeys) {
      const value = process.env[envKey]

      if (!value) {
        console.warn(`   ⚠️  Skipped "${key}" — tidak ada di .env`)
        credentialsSkipped++
        continue
      }

      const encrypted = encrypt(value)

      await prisma.botCredential.upsert({
        where: { userId_key: { userId: 1, key } },
        update: { value: encrypted },
        create: { userId: 1, key, value: encrypted },
      })

      const preview =
        value.length > 8 ? value.slice(0, 6) + '...' + value.slice(-4) : '***'
      console.log(`   ✅ "${key}" → terenkripsi (preview: ${preview})`)
      credentialsSaved++
    }
    console.log(
      `   📊 ${credentialsSaved} credentials disimpan, ${credentialsSkipped} dilewati\n`,
    )

    // Step 4: Migrate existing BotConfig (jika ada dari versi lama)
    console.log('📝 Migrasi BotConfig existing...')
    const botConfigs = await prisma.botConfig.findMany({
      where: { userId: { not: 1 } }, // Ambil semua yang bukan user_id=1
    })

    for (const config of botConfigs) {
      await prisma.botConfig.update({
        where: { id: config.id },
        data: { userId: 1 },
      })
      console.log(`   ✅ BotConfig ID=${config.id} → user_id=1`)
    }
    if (botConfigs.length === 0)
      console.log('   ✅ Tidak ada BotConfig lain untuk dimigrasikan')
    console.log('')

    // Step 5: Migrate existing BotCredential
    console.log('📝 Migrasi BotCredential existing...')
    const existingCreds = await prisma.botCredential.findMany({
      where: { userId: { not: 1 } }, // Ambil semua yang bukan user_id=1
    })

    for (const cred of existingCreds) {
      await prisma.botCredential.update({
        where: { id: cred.id },
        data: { userId: 1 },
      })
      console.log(`   ✅ BotCredential "${cred.key}" → user_id=1`)
    }
    if (existingCreds.length === 0)
      console.log('   ✅ Tidak ada BotCredential lain untuk dimigrasikan')
    console.log('')

    // Step 6: Migrate Product
    console.log('📝 Migrasi Product...')
    const products = await prisma.product.findMany({
      where: { userId: { not: 1 } }, // Ambil semua yang bukan user_id=1
    })

    for (const product of products) {
      await prisma.product.update({
        where: { id: product.id },
        data: { userId: 1 },
      })
      console.log(`   ✅ Product "${product.name}" → user_id=1`)
    }
    if (products.length === 0)
      console.log('   ✅ Tidak ada Product lain untuk dimigrasikan')
    console.log('')

    // Step 6b: Seed dummy products untuk user 1 jika belum ada
    console.log('📝 Seed produk dummy untuk user 1...')
    const existingProductsCount = await prisma.product.count({
      where: { userId: 1 },
    })

    if (existingProductsCount === 0) {
      for (const product of seedProducts) {
        await prisma.product.create({
          data: {
            userId: 1,
            name: product.name,
            description: product.description,
            price: product.price,
            emoji: product.emoji,
            isAvailable: true,
          },
        })
        console.log(`   ✅ "${product.name}" (Rp${product.price})`)
      }
      console.log('')
    } else {
      console.log(
        `   ⏭️  User 1 sudah punya ${existingProductsCount} produk — skip seeding\n`,
      )
    }

    // Step 7: Migrate Order
    console.log('📝 Migrasi Order...')
    const orders = await prisma.order.findMany({
      where: { userId: { not: 1 } }, // Ambil semua yang bukan user_id=1
    })

    for (const order of orders) {
      await prisma.order.update({
        where: { id: order.id },
        data: { userId: 1 },
      })
      console.log(`   ✅ Order "${order.orderId}" → user_id=1`)
    }
    if (orders.length === 0)
      console.log('   ✅ Tidak ada Order untuk dimigrasikan')
    console.log('')

    // Summary
    const finalUserCount = await prisma.user.count()
    const finalConfigCount = await prisma.botConfig.count()
    const finalCredCount = await prisma.botCredential.count()
    const finalProductCount = await prisma.product.count()
    const finalProductCountUser1 = await prisma.product.count({
      where: { userId: 1 },
    })
    const finalOrderCount = await prisma.order.count()

    console.log('📊 Ringkasan Migrasi M6:')
    console.log(`   Users:         ${finalUserCount}`)
    console.log(`   BotConfigs:    ${finalConfigCount}`)
    console.log(`   Credentials:   ${finalCredCount}`)
    console.log(
      `   Products:      ${finalProductCount} (${finalProductCountUser1} untuk user_id=1)`,
    )
    console.log(`   Orders:        ${finalOrderCount}`)
    console.log('')
    console.log('✅ Migrasi M6 selesai! Database siap untuk multi-tenant.')
    console.log('\n📝 Langkah selanjutnya:')
    console.log('   1. Verify database di Prisma Studio: npm run db:studio')
    console.log('   2. Buat user baru via userService.createUser()')
    console.log('   3. Mulai botManager.spawnAllActiveBots()')
    console.log('   4. Deploy with npm run start:m6')
  } catch (err) {
    console.error('❌ Error migrasi:', err.message)
    throw err
  } finally {
    await prisma.$disconnect()
  }
}

main()
