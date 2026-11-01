import prisma from '../../services/db.js'
import {
  verifyWebhookSignature,
  verifySubscriptionWebhookSignature,
  fetchSubscriptionTransactionStatus,
  isPaymentSuccess,
  isPaymentFailed,
  parseGrossAmount,
} from '../../services/midtrans.js'
import { settlePayment } from '../../services/paymentSettlement.js'
import {
  processTelegramWebhookUpdateForUser,
  verifyTelegramWebhookSecretForUser,
} from '../../services/botManager.js'
import { verifyEvolutionWebhookSecret } from '../../services/evolution.js'
import { processEvolutionWebhookForUser } from '../../services/whatsappManager.js'
import { activateSubscription } from '../../services/subscriptionService.js'

export async function handleMidtransWebhook(req, res, next) {
  try {
    const notification = req.body || {}
    const orderId = String(notification.order_id || '').trim()

    if (!orderId) {
      return res
        .status(400)
        .json({ success: false, message: 'order_id wajib diisi' })
    }

    console.log(
      '[Webhook] Notifikasi Midtrans:',
      orderId,
      notification.transaction_status,
    )

    // Cek apakah ini payment untuk subscription (prefix SUB-) atau order biasa
    if (orderId.startsWith('SUB-')) {
      // Notifikasi subscription diverifikasi dengan key platform, bukan key
      // tenant. Kanal yang tidak mengirim signature_key diverifikasi lewat
      // status transaksi resmi Midtrans.
      let trusted = null

      if (notification.signature_key) {
        trusted = verifySubscriptionWebhookSignature(notification)
          ? notification
          : null
      } else {
        trusted = await fetchSubscriptionTransactionStatus(orderId)
      }

      if (!trusted) {
        console.warn('[Webhook] Verifikasi notifikasi subscription gagal:', orderId)
        return res.status(403).json({ success: false, message: 'Forbidden' })
      }

      if (isPaymentSuccess(trusted)) {
        const paymentType =
          trusted.payment_type || trusted.va_numbers?.[0]?.bank || 'unknown'
        await activateSubscription(orderId, paymentType)
      }
      // Tidak perlu handle failed — invoice otomatis expired setelah 24 jam via cron
      return res.status(200).json({ status: 'ok' })
    }

    // `Order.orderId` hanya unik di dalam satu tenant (@@unique([userId,
    // orderId])), jadi orderId yang sama bisa ada di tenant lain. Kandidat yang
    // signature-nya cocok dengan key miliknya yang diproses.
    const candidates = await prisma.order.findMany({
      where: { orderId },
      select: {
        id: true,
        userId: true,
        orderId: true,
        status: true,
        totalPrice: true,
      },
    })

    if (candidates.length === 0) {
      console.warn('[Webhook] Order tidak ditemukan:', orderId)
      return res
        .status(404)
        .json({ success: false, message: 'Order not found' })
    }

    const verified = []
    for (const candidate of candidates) {
      let ok = false
      try {
        ok = await verifyWebhookSignature(candidate.userId, notification)
      } catch {
        ok = false
      }
      if (ok) verified.push(candidate)
    }

    if (verified.length === 0) {
      console.warn('[Webhook] Signature tidak valid!', `(${orderId})`)
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    // Lebih dari satu tenant menyimpan orderId yang sama dan signature-nya
    // cocok (kedua tenant memakai server key yang sama). Nominal pembayaran
    // membedakan order yang benar-benar ditagihkan. Tidak ada yang cocok bukan
    // alasan menolak: order yang lunas tidak boleh menggantung, jadi dipakai
    // kandidat pertama dan keputusannya ditulis di log.
    const grossAmount = parseGrossAmount(notification.gross_amount)
    const order =
      verified.length > 1 && Number.isFinite(grossAmount)
        ? verified.find((c) => Number(c.totalPrice) === grossAmount) ?? verified[0]
        : verified[0]

    if (verified.length > 1) {
      console.warn(
        `[Webhook] ${verified.length} order memakai orderId ${orderId}; dipakai user ${order.userId} (nominal ${notification.gross_amount})`,
      )
    }

    const userId = order.userId

    // Status akhir dibaca setelah signature sah supaya webhook ini tidak
    // jadi oracle status order untuk pihak yang tidak terverifikasi.
    if (order.status === 'COMPLETED') {
      console.log('[Webhook] Order sudah COMPLETED, skip duplikat:', orderId)
      return res.status(200).json({ status: 'ok', skipped: true })
    }

    if (isPaymentSuccess(notification)) {
      const paidAt = new Date()
      const outcome = await settlePayment({
        orderRowId: order.id,
        fromStatus: order.status,
        guard: { status: { not: 'COMPLETED' } },
        data: { status: 'COMPLETED', paidAt },
        jobName: 'payment-success',
        jobData: {
          userId,
          orderId: order.orderId,
          notification: { payment_type: notification.payment_type },
        },
      })

      if (outcome.result === 'already_settled') {
        console.log('[Webhook] Order baru saja ditandai lunas proses lain:', orderId)
        return res.status(200).json({ status: 'ok', skipped: true })
      }
      if (outcome.result === 'queue_error') {
        console.error('[Webhook] Gagal antrekan notifikasi:', outcome.error.message)
        return res
          .status(500)
          .json({ success: false, message: 'Notification queue unavailable' })
      }
      if (outcome.result === 'db_error') {
        console.error('[Webhook] Gagal simpan status pembayaran:', outcome.error.message)
        return res
          .status(500)
          .json({ success: false, message: 'Database unavailable' })
      }

      console.log('[Webhook] Pembayaran berhasil:', orderId, `(user ${userId})`)
    } else if (isPaymentFailed(notification)) {
      if (order.status === 'PAYMENT_FAILED') {
        return res.status(200).json({ status: 'ok', skipped: true })
      }

      const outcome = await settlePayment({
        orderRowId: order.id,
        fromStatus: order.status,
        // COMPLETED tidak boleh turun kelas: notifikasi expired yang datang
        // terlambat akan mengembalikan stok order yang sudah dibayar.
        guard: { status: { notIn: ['PAYMENT_FAILED', 'COMPLETED'] } },
        data: { status: 'PAYMENT_FAILED' },
        jobName: 'payment-failed',
        jobData: { userId, orderId: order.orderId },
      })

      if (outcome.result === 'already_settled') {
        console.log(
          '[Webhook] Status order sudah diproses pihak lain, skip:',
          orderId,
        )
        return res.status(200).json({ status: 'ok', skipped: true })
      }
      if (outcome.result === 'queue_error') {
        console.error('[Webhook] Gagal antrekan notifikasi:', outcome.error.message)
        return res
          .status(500)
          .json({ success: false, message: 'Notification queue unavailable' })
      }
      if (outcome.result === 'db_error') {
        console.error('[Webhook] Gagal simpan status pembayaran:', outcome.error.message)
        return res
          .status(500)
          .json({ success: false, message: 'Database unavailable' })
      }

      console.log(
        '[Webhook] Pembayaran gagal/expired:',
        orderId,
        `(user ${userId})`,
      )
    }

    return res.status(200).json({ status: 'ok' })
  } catch (error) {
    console.error('[Webhook] Error:', error.message)
    return next(error)
  }
}

export async function handleTelegramWebhook(req, res, next) {
  try {
    const userId = String(req.params.userId || '').trim()
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Invalid userId' })
    }

    const secretToken = req.headers['x-telegram-bot-api-secret-token']

    const isSecretValid = await verifyTelegramWebhookSecretForUser(
      userId,
      secretToken,
    )

    if (!isSecretValid) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    // Tanpa isi pesan/ID pelanggan: log staging tidak boleh memuat data pribadi.
    console.log('[Webhook] Update Telegram diterima', {
      user: userId,
      updateId: req.body?.update_id ?? null,
      kind: telegramUpdateKind(req.body),
    })

    const result = await processTelegramWebhookUpdateForUser(userId, req.body)
    if (!result.success) {
      return res
        .status(503)
        .json({ success: false, message: result.reason || 'Bot not ready' })
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    return next(error)
  }
}

export async function handleWhatsAppWebhook(req, res, next) {
  try {
    const userId = String(req.params.userId || '').trim()
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Invalid userId' })
    }

    const secret = req.headers['x-evolution-webhook-secret']
    if (!verifyEvolutionWebhookSecret(userId, secret)) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid payload' })
    }

    // Tanpa isi pesan/ID pelanggan: log staging tidak boleh memuat data pribadi.
    console.log(
      `[Webhook] Evolution event=${req.body.event} instance=${req.body.instance} user=${userId} items=${Array.isArray(req.body.data) ? req.body.data.length : 0}`,
    )

    // ACK cepat agar Evolution tidak retry; pemrosesan dilakukan async.
    res.status(200).json({ ok: true })

    processEvolutionWebhookForUser(userId, req.body).catch((error) => {
      console.error(
        `[Webhook] Gagal proses WhatsApp user=${userId}: ${error.message}`,
      )
    })

    return
  } catch (error) {
    return next(error)
  }
}

function telegramUpdateKind(update) {
  if (!update || typeof update !== 'object') return 'unknown'
  if (update.callback_query) return 'callback_query'
  if (update.edited_message) return 'edited_message'
  if (update.message) return 'message'
  return Object.keys(update)[0] || 'unknown'
}

