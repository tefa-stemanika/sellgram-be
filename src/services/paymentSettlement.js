import prisma from './db.js'
import { notifQueue } from './queue.js'

/**
 * Klaim status pembayaran lalu antrekan job turunannya.
 *
 * Urutannya penting dan sengaja begitu: worker pemenuhan
 * (`fulfillmentWorker.js`) membuang job untuk order yang statusnya belum
 * `COMPLETED`, jadi status harus tercatat lebih dulu. Klaimnya bersyarat
 * `paidAt: null` — order yang pernah dibayar tidak bisa diklaim ulang,
 * walaupun statusnya turun lagi (mis. strategi fulfillment manual memindahkan
 * `COMPLETED` ke `PROCESSING`).
 *
 * Kalau antrean gagal, klaim dilepas lagi supaya pengulangan dari Midtrans
 * memproses transaksi dari awal; pelepasan hanya terjadi kalau job-nya memang
 * tidak tersimpan dan statusnya masih milik klaim kita. Klaim yang kalah tetap
 * memastikan job-nya ada, supaya order tidak berhenti sebagai
 * "lunas tapi tidak pernah dipenuhi".
 *
 * `jobId` deterministik menjadikan webhook ganda satu job. BullMQ menolak `:`
 * di id, jadi pemisahnya `-`.
 */
export async function settlePayment({
  orderRowId,
  fromStatus,
  guard,
  data,
  jobName,
  jobData,
}) {
  const jobId = `${jobName}-${orderRowId}`

  let claimed = 0
  try {
    const result = await prisma.order.updateMany({
      where: { id: orderRowId, paidAt: null, ...guard },
      data,
    })
    claimed = result.count
  } catch (error) {
    return { result: 'db_error', error }
  }

  if (claimed === 0) {
    // Order sudah dibayar/diproses pihak lain. Pastikan job-nya benar ada;
    // tanpa ini, webhook ganda yang datang di tengah kegagalan antrean akan
    // menjawab 200 untuk order yang tidak pernah dipenuhi.
    try {
      const existing = await notifQueue.getJob(jobId)
      if (existing) return { result: 'already_settled' }
      await notifQueue.add(jobName, jobData, { jobId })
      return { result: 'settled' }
    } catch (error) {
      return { result: 'queue_error', error }
    }
  }

  try {
    await notifQueue.add(jobName, jobData, { jobId })
  } catch (error) {
    // Timeout di sisi client tidak berarti job-nya tidak tersimpan.
    const existing = await notifQueue.getJob(jobId).catch(() => null)
    if (existing) return { result: 'settled' }

    await prisma.order
      .updateMany({
        where: {
          id: orderRowId,
          status: data.status,
          ...(data.paidAt ? { paidAt: data.paidAt } : {}),
        },
        data: { status: fromStatus, paidAt: data.paidAt ? null : undefined },
      })
      .catch(() => {})

    return { result: 'queue_error', error }
  }

  return { result: 'settled' }
}
