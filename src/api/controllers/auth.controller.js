import {
  createUser,
  getUserByEmail,
  getUserById,
  verifyUserPassword,
} from '../../services/userService.js'
import prisma from '../../services/db.js'
import { encrypt } from '../../utils/encryption.js'
import { signAuthToken } from '../../utils/jwt.js'
import { ok, fail } from '../utils/response.js'

const DEFAULT_CREDENTIAL_KEYS = [
  'TELEGRAM_BOT_TOKEN',
  'ADMIN_BOT_TOKEN',
  'ADMIN_CHAT_ID',
  'GEMINI_API_KEY',
  'MIDTRANS_SERVER_KEY',
  'MIDTRANS_CLIENT_KEY',
  'MIDTRANS_FINISH_URL',
]

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export async function register(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')
    const name = String(req.body?.name || '').trim()

    if (!email || !password || !name) {
      return fail(res, 'email, password, dan name wajib diisi', 400)
    }

    if (password.length < 6) {
      return fail(res, 'password minimal 6 karakter', 400)
    }

    const existing = await getUserByEmail(email)
    if (existing) {
      return fail(res, 'email sudah terdaftar', 409)
    }

    const user = await createUser({ email, password, name, plan: 'FREE' })

    await prisma.botConfig.create({
      data: {
        userId: user.id,
        aiEnabled: false,
        geminiModel: 'gemini-2.0-flash',
        midtransIsProduction: false,
        botMode: 'webhook',
        isActive: true,
      },
    })

    const encryptedEmpty = encrypt('')
    await prisma.botCredential.createMany({
      data: DEFAULT_CREDENTIAL_KEYS.map((key) => ({
        userId: user.id,
        key,
        value: encryptedEmpty,
      })),
      skipDuplicates: true,
    })

    const token = signAuthToken({ userId: user.id })

    return ok(
      res,
      {
        user: sanitizeUser(user),
        token: `Bearer ${token}`,
      },
      'Register berhasil',
      201,
    )
  } catch (error) {
    return next(error)
  }
}

export async function login(req, res, next) {
  try {
    const email = normalizeEmail(req.body?.email)
    const password = String(req.body?.password || '')

    if (!email || !password) {
      return fail(res, 'email dan password wajib diisi', 400)
    }

    const { valid, user } = await verifyUserPassword(email, password)

    if (!valid || !user) {
      return fail(res, 'email atau password tidak valid', 401)
    }

    if (!user.isActive) {
      return fail(res, 'akun tidak aktif', 403)
    }

    const token = signAuthToken({ userId: user.id })

    return ok(
      res,
      {
        user: sanitizeUser(user),
        token: `Bearer ${token}`,
      },
      'Login berhasil',
    )
  } catch (error) {
    return next(error)
  }
}

export async function getMe(req, res, next) {
  try {
    const user = await getUserById(req.auth.userId)

    if (!user) {
      return fail(res, 'User tidak ditemukan', 404)
    }

    return ok(res, sanitizeUser(user), 'Get current user success')
  } catch (error) {
    return next(error)
  }
}

export async function logout(req, res) {
  return ok(res, null, 'Logout berhasil')
}
