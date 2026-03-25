import { getBotObservabilityStatusForUser } from '../../services/botManager.js'
import { ok } from '../utils/response.js'

export async function getMyBotStatus(req, res, next) {
  try {
    const userId = req.auth.userId
    const validateToken = String(req.query.validateToken || 'true') !== 'false'

    const status = await getBotObservabilityStatusForUser(userId, {
      validateToken,
    })

    return ok(
      res,
      {
        userId,
        running: status.running,
        tokenStatus: status.tokenStatus,
        lastSpawnAttemptAt: status.lastSpawnAttemptAt,
        lastSpawnAttemptSuccess: status.lastSpawnAttemptSuccess,
        reason: status.reason,
        updatedAt: status.updatedAt,
      },
      'Get bot status success',
    )
  } catch (error) {
    return next(error)
  }
}
