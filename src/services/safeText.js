// src/services/safeText.js
// Teks bebas (nama produk, nama profil pengirim, email) disisipkan ke pesan
// Telegram yang memakai parse_mode Markdown dan ke pesan WhatsApp yang selalu
// mem-parse markup. Karakter * _ ~ ` [ ] yang lolos bisa merusak tampilan atau
// membuat Telegram menolak seluruh pesan.

export function safePlainText(value, maxLength = 80, placeholder = '-') {
  const cleaned = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[*_~`[\]]/g, '')

  if (!cleaned) return placeholder
  return Array.from(cleaned).slice(0, maxLength).join('')
}

export function safeEmoji(value, placeholder = '🛍️') {
  return safePlainText(value, 8, placeholder)
}
