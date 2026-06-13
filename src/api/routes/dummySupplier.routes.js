import { Router } from 'express'

const router = Router()

const DUMMY_SUPPLIER_SECRET = process.env.DUMMY_SUPPLIER_SECRET || 'dev-secret-change-in-production'

function verifySecret(req, res, next) {
  const secret = req.headers['x-supplier-secret']
  if (!secret || secret !== DUMMY_SUPPLIER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

router.post('/supplier/topup', verifySecret, (req, res) => {
  console.log('[DUMMY SUPPLIER] Received:', JSON.stringify(req.body, null, 2))
  res.json({
    data: {
      status: 'success',
      transactionId: 'TRX-' + Date.now(),
      message: 'Top-up berhasil diproses',
    },
  })
})

export default router
