import { ok, okPaginated, fail } from '../utils/response.js'
import * as templateService from '../../services/templateService.js'

export async function listTemplates(req, res, next) {
  try {
    const result = await templateService.getTemplates(req.auth.userId, req.query)
    return okPaginated(res, result.templates, result.total, result.page, result.limit)
  } catch (error) {
    return next(error)
  }
}

export async function getTemplate(req, res, next) {
  try {
    const template = await templateService.getTemplateById(req.params.id, req.auth.userId)
    if (!template) return fail(res, 'Template tidak ditemukan', 404)
    const preview = await templateService.getTemplatePreview(req.params.id, req.auth.userId)
    return ok(res, preview || template)
  } catch (error) {
    return next(error)
  }
}

export async function createTemplate(req, res, next) {
  try {
    const template = await templateService.createTemplate(req.auth.userId, req.body)
    return ok(res, template, 'Template berhasil dibuat', 201)
  } catch (error) {
    return next(error)
  }
}

export async function updateTemplate(req, res, next) {
  try {
    const template = await templateService.updateTemplate(req.params.id, req.auth.userId, req.body)
    if (!template) return fail(res, 'Template tidak ditemukan', 404)
    return ok(res, template, 'Template berhasil diperbarui')
  } catch (error) {
    return next(error)
  }
}

export async function deleteTemplate(req, res, next) {
  try {
    const result = await templateService.deleteTemplate(req.params.id, req.auth.userId)
    if (result === null) return fail(res, 'Template tidak ditemukan', 404)
    return ok(res, null, 'Template berhasil dihapus')
  } catch (error) {
    return next(error)
  }
}
