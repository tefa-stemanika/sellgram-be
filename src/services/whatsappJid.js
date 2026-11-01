// src/services/whatsappJid.js
// Aturan JID WhatsApp (Baileys/Evolution) dipakai bersama oleh webhook,
// handler, dan layanan yang butuh nomor telepon pelanggan.

export function normalizeWhatsAppJid(jid) {
  return String(jid || '')
    .trim()
    .replace(/:\d+@/, '@')
}

/**
 * Nomor telepon (hanya digit) dari JID `@s.whatsapp.net`.
 * `@lid`, grup, dan broadcast tidak punya nomor → null.
 */
export function extractPhoneFromJid(jid) {
  const normalized = normalizeWhatsAppJid(jid)
  if (!normalized.endsWith('@s.whatsapp.net')) return null

  const digits = normalized.split('@')[0].replace(/\D/g, '')
  return digits || null
}

export function normalizePhoneJid(jid) {
  const digits = extractPhoneFromJid(jid)
  return digits ? `${digits}@s.whatsapp.net` : null
}

/**
 * Versi JID untuk log: nomor disamarkan, hanya prefik + 2 digit terakhir.
 * Log tidak boleh menyimpan nomor telepon pelanggan secara utuh.
 */
export function maskChatId(jid) {
  const normalized = normalizeWhatsAppJid(jid)
  if (!normalized) return '-'

  const [local, domain] = normalized.split('@')
  const digits = local.replace(/\D/g, '')

  if (!digits) return `?@${domain || '?'}`
  if (digits.length <= 4) return `${digits.slice(0, 1)}…@${domain}`

  return `${digits.slice(0, 4)}…${digits.slice(-2)}@${domain}`
}
