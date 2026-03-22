// src/data/products.js
// Data produk simulasi — ganti isi array ini sesuai produk kamu

export const products = [
  {
    id: 1,
    name: 'Nasi Goreng Spesial',
    description: 'Nasi goreng dengan telur, ayam, dan kerupuk',
    price: 25000,
    emoji: '🍳',
  },
  {
    id: 2,
    name: 'Mie Ayam Bakso',
    description: 'Mie ayam dengan bakso jumbo dan pangsit goreng',
    price: 20000,
    emoji: '🍜',
  },
  {
    id: 3,
    name: 'Es Teh Manis',
    description: 'Teh manis dingin segar',
    price: 5000,
    emoji: '🧋',
  },
  {
    id: 4,
    name: 'Jus Alpukat',
    description: 'Jus alpukat segar dengan susu kental manis',
    price: 15000,
    emoji: '🥑',
  },
  {
    id: 5,
    name: 'Ayam Bakar',
    description: 'Ayam bakar bumbu kecap dengan nasi dan lalapan',
    price: 35000,
    emoji: '🍗',
  },
]

/**
 * Cari produk berdasarkan ID.
 * @param {number} id
 * @returns {object|undefined}
 */
export function getProductById(id) {
  return products.find((p) => p.id === id)
}

/**
 * Format harga ke Rupiah.
 * @param {number} amount
 * @returns {string}
 */
export function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount)
}
