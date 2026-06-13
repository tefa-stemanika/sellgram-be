import prisma from '../../db.js'
import { decrypt } from '../../../utils/encryption.js'

export async function execute({ userId, order, config }) {
  const now = new Date()

  const slot = await prisma.$queryRaw`
    UPDATE slots
    SET status = 'ACTIVE', assigned_at = NOW(), order_id = ${order.id}::uuid
    WHERE id = (
      SELECT s.id FROM slots s
      JOIN slot_accounts sa ON sa.id = s.slot_account_id
      WHERE s.product_id = ${config.productId}::uuid
        AND s.user_id = ${userId}::uuid
        AND s.status = 'AVAILABLE'
        AND sa.is_active = true
        AND sa.used_slots < sa.total_slots
        AND (s.expires_at IS NULL OR s.expires_at > ${now})
      ORDER BY s.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, slot_identifier, additional_info, slot_account_id
  `

  if (!slot || slot.length === 0) {
    throw new Error('Tidak ada slot AVAILABLE')
  }

  const slotId = slot[0].id
  const accountId = slot[0].slot_account_id

  await prisma.$transaction([
    prisma.slotAccount.update({
      where: { id: accountId },
      data: { usedSlots: { increment: 1 } },
    }),
  ])

  const account = await prisma.slotAccount.findUnique({
    where: { id: accountId },
  })

  let credentialsText = ''
  if (account?.credentials) {
    try {
      const decrypted = decrypt(account.credentials)
      const parsed = JSON.parse(decrypted)
      const lines = Object.entries(parsed).map(
        ([key, val]) => `*${key.charAt(0).toUpperCase() + key.slice(1)}:* ${val}`
      )
      credentialsText = lines.join('\n')
    } catch {
      credentialsText = '*Kredensial tidak dapat ditampilkan*'
    }
  }

  const delivery = [
    `📋 *Slot:* ${slot[0].slot_identifier}`,
    ...(credentialsText ? [credentialsText] : []),
    slot[0].additional_info ? `ℹ️ ${slot[0].additional_info}` : null,
  ].filter(Boolean).join('\n')

  return {
    success: true,
    delivery,
    note: null,
    metadata: { slotId: slot[0].id, slotIdentifier: slot[0].slot_identifier },
  }
}
