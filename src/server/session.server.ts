import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  deleteCookie,
  getCookie,
  getRequestHeaders,
  setCookie,
} from '@tanstack/react-start/server'
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

function hostnameFromHost(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end === -1) return ''
    const rest = host.slice(end + 1)
    if (rest && !rest.startsWith(':')) return ''
    return host.slice(0, end + 1)
  }
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

function secureSessionCookie(): boolean {
  if (process.env.NODE_ENV === 'production') return true

  // Trust an explicit proxy protocol when present; otherwise treat a
  // non-local hostname as HTTPS.
  const headers = getRequestHeaders()
  const forwardedProto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedProto) return forwardedProto.toLowerCase() === 'https'

  const host = (
    headers.get('x-forwarded-host')?.split(',')[0]?.trim() ??
    headers.get('host') ??
    ''
  ).toLowerCase()
  const hostname = hostnameFromHost(host)
  return !(
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  )
}

export async function startSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  await createSession(sha256Hex(token), userId, now + SESSION_TTL_MS, now)
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureSessionCookie(),
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  })
}

export async function endSession(): Promise<void> {
  const token = getCookie(SESSION_COOKIE)
  if (token) await deleteSession(sha256Hex(token))
  deleteCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: secureSessionCookie(),
  })
}

export async function currentUser(): Promise<UserRow | null> {
  const token = getCookie(SESSION_COOKIE)
  if (!token) return null
  const session = await findSession(sha256Hex(token))
  if (!session) return null
  if (session.expires_at < Date.now()) {
    await deleteSession(sha256Hex(token))
    return null
  }
  return (await findUserById(session.user_id)) ?? null
}

export async function requireUser(): Promise<UserRow> {
  const user = await currentUser()
  if (!user) {
    throw new Error('UNAUTHENTICATED')
  }
  return user
}
