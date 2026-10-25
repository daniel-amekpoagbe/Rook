import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'
import {
  createSession,
  deleteSession,
  findSession,
  findUserById,
  type UserRow,
} from './db.server'

export const SESSION_COOKIE = 'kn_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function startSession(userId: string): void {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  createSession(sha256Hex(token), userId, now + SESSION_TTL_MS, now)
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export function endSession(): void {
  const token = getCookie(SESSION_COOKIE)
  if (token) deleteSession(sha256Hex(token))
  deleteCookie(SESSION_COOKIE, { path: '/' })
}

export function currentUser(): UserRow | null {
  const token = getCookie(SESSION_COOKIE)
  if (!token) return null
  const session = findSession(sha256Hex(token))
  if (!session) return null
  if (session.expires_at < Date.now()) {
    deleteSession(sha256Hex(token))
    return null
  }
  return findUserById(session.user_id) ?? null
}

export function requireUser(): UserRow {
  const user = currentUser()
  if (!user) {
    throw new Error('UNAUTHENTICATED')
  }
  return user
}
