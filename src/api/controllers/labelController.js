import { ok, fail } from '../utils/response.js'
import * as labelService from '../../services/labelService.js'

export async function list(req, res, next) {
  try {
    return ok(res, await labelService.getLabels(req.auth.userId))
  } catch (error) {
    return next(error)
  }
}

export async function create(req, res, next) {
  try {
    return ok(res, await labelService.createLabel(req.auth.userId, req.body), 201)
  } catch (error) {
    return next(error)
  }
}

export async function update(req, res, next) {
  try {
    return ok(res, await labelService.updateLabel(req.params.labelId, req.auth.userId, req.body))
  } catch (error) {
    return next(error)
  }
}

export async function remove(req, res, next) {
  try {
    await labelService.deleteLabel(req.params.labelId, req.auth.userId)
    return ok(res, { message: 'Label deleted' })
  } catch (error) {
    return next(error)
  }
}
