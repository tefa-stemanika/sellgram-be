import { ok, okPaginated, fail } from '../utils/response.js'
import * as broadcastService from '../../services/broadcastService.js'
import { assertFeatureAllowed } from '../../services/planLimitService.js'

export async function listBroadcasts(req, res, next) {
  try {
    const result = await broadcastService.getBroadcasts(req.auth.userId, req.query)
    return okPaginated(res, result.broadcasts, result.total, result.page, result.limit)
  } catch (error) {
    return next(error)
  }
}

export async function getBroadcast(req, res, next) {
  try {
    const broadcast = await broadcastService.getBroadcastById(req.params.id, req.auth.userId)
    if (!broadcast) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, broadcast)
  } catch (error) {
    return next(error)
  }
}

export async function createBroadcast(req, res, next) {
  try {
    const { default: prisma } = await import('../../services/db.js')
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } })
    if (!user) return fail(res, 'User not found', 404)
    assertFeatureAllowed(user.plan, 'maxBroadcastsPerMonth')

    const broadcast = await broadcastService.createBroadcast(req.auth.userId, req.body)
    return ok(res, broadcast, 'Broadcast berhasil dibuat', 201)
  } catch (error) {
    if (error.code === 'FEATURE_NOT_ALLOWED') {
      return res.status(403).json({ success: false, code: 'FEATURE_NOT_ALLOWED', message: error.message })
    }
    return next(error)
  }
}

export async function createBroadcastFromTemplate(req, res, next) {
  try {
    const { default: prisma } = await import('../../services/db.js')
    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } })
    if (!user) return fail(res, 'User not found', 404)
    assertFeatureAllowed(user.plan, 'maxBroadcastsPerMonth')

    const broadcast = await broadcastService.createBroadcastFromTemplate(req.auth.userId, req.body)
    return ok(res, broadcast, 'Broadcast dari template berhasil dibuat', 201)
  } catch (error) {
    if (error.code === 'FEATURE_NOT_ALLOWED') {
      return res.status(403).json({ success: false, code: 'FEATURE_NOT_ALLOWED', message: error.message })
    }
    return next(error)
  }
}

export async function updateBroadcast(req, res, next) {
  try {
    const broadcast = await broadcastService.updateBroadcast(req.params.id, req.auth.userId, req.body)
    if (!broadcast) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, broadcast, 'Broadcast berhasil diperbarui')
  } catch (error) {
    return next(error)
  }
}

export async function deleteBroadcast(req, res, next) {
  try {
    const result = await broadcastService.deleteBroadcast(req.params.id, req.auth.userId)
    if (result === null) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, null, 'Broadcast berhasil dihapus')
  } catch (error) {
    return next(error)
  }
}

export async function previewBroadcast(req, res, next) {
  try {
    const preview = await broadcastService.previewCustomers(req.auth.userId, req.body.filters || {})
    return ok(res, preview, 'Preview berhasil')
  } catch (error) {
    return next(error)
  }
}

export async function previewRenderBroadcast(req, res, next) {
  try {
    const result = await broadcastService.previewRender(req.params.id, req.auth.userId)
    if (result === null) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, result, 'Preview render berhasil')
  } catch (error) {
    return next(error)
  }
}

export async function dryRunBroadcast(req, res, next) {
  try {
    const result = await broadcastService.dryRunBroadcast(req.params.id, req.auth.userId)
    if (result === null) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, result, 'Dry-run selesai')
  } catch (error) {
    return next(error)
  }
}

export async function startBroadcast(req, res, next) {
  try {
    const broadcast = await broadcastService.startBroadcast(req.params.id, req.auth.userId)
    if (!broadcast) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, broadcast, 'Broadcast sedang dikirim')
  } catch (error) {
    return next(error)
  }
}

export async function pauseBroadcast(req, res, next) {
  try {
    const broadcast = await broadcastService.pauseBroadcast(req.params.id, req.auth.userId)
    if (!broadcast) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, broadcast, 'Broadcast di-pause')
  } catch (error) {
    return next(error)
  }
}

export async function resumeBroadcast(req, res, next) {
  try {
    const broadcast = await broadcastService.resumeBroadcast(req.params.id, req.auth.userId)
    if (!broadcast) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, broadcast, 'Broadcast dilanjutkan')
  } catch (error) {
    return next(error)
  }
}

export async function cancelBroadcast(req, res, next) {
  try {
    const broadcast = await broadcastService.cancelBroadcast(req.params.id, req.auth.userId)
    if (!broadcast) return fail(res, 'Broadcast tidak ditemukan', 404)
    return ok(res, broadcast, 'Broadcast dibatalkan')
  } catch (error) {
    return next(error)
  }
}

export async function listRecipients(req, res, next) {
  try {
    const result = await broadcastService.getRecipients(req.params.id, req.auth.userId, req.query)
    if (result === null) return fail(res, 'Broadcast tidak ditemukan', 404)
    return okPaginated(res, result.recipients, result.total, result.page, result.limit)
  } catch (error) {
    return next(error)
  }
}
