import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { KdfConfig } from '~/lib/crypto'

const kdfSchema = z.object({
  algorithm: z.literal('argon2id'),
  t: z.number().int().min(1).max(10),
  m: z.number().int().min(8_192).max(262_144),
  p: z.number().int().min(1).max(4),
  salt: z.string().min(16).max(128),
})

const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._@-]+$/, 'Use letters, numbers, dots, dashes, underscores or an email address')
  .transform((value) => value.toLowerCase())

const base64ish = z.string().min(16).max(8_000_000)

const vaultPayload = {
  ciphertext: base64ish,
  nonce: z.string().min(16).max(64),
}

async function store() {
  const db = await import('./db.server')
  const session = await import('./session.server')
  return { db, session }
}

/** Constant-time-ish: unknown handles get a stable fake salt so the UI flow is identical. */
function fakeKdf(handle: string): KdfConfig {
  const saltSeed = Buffer.from(handle).toString('base64url').padEnd(22, 'A').slice(0, 22)
  return { algorithm: 'argon2id', t: 3, m: 65536, p: 1, salt: saltSeed }
}

export const meFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { session } = await store()
  const user = session.currentUser()
  return { authenticated: Boolean(user), handle: user?.handle ?? null }
})

export const registerFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      handle: handleSchema,
      kdf: kdfSchema,
      authHash: z.string().regex(/^[0-9a-f]{64}$/),
      ...vaultPayload,
    }),
  )
  .handler(async ({ data }) => {
    const { db, session } = await store()
    if (db.findUserByHandle(data.handle)) {
      throw new Error('HANDLE_TAKEN')
    }
    const now = Date.now()
    const userId = crypto.randomUUID()
    db.createUser({
      id: userId,
      handle: data.handle,
      kdf: JSON.stringify(data.kdf),
      auth_hash: session.sha256Hex(data.authHash),
      created_at: now,
    })
    db.upsertVault({
      user_id: userId,
      ciphertext: data.ciphertext,
      nonce: data.nonce,
      version: 1,
      updated_at: now,
    })
    session.startSession(userId)
    return { handle: data.handle, version: 1 }
  })

export const kdfFn = createServerFn({ method: 'POST' })
  .validator(z.object({ handle: z.string().trim().min(1).max(64) }))
  .handler(async ({ data }) => {
    const { db } = await store()
    const user = db.findUserByHandle(data.handle.trim().toLowerCase())
    if (!user) return { kdf: fakeKdf(data.handle.trim().toLowerCase()) }
    return { kdf: JSON.parse(user.kdf) as KdfConfig }
  })

export const loginFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      handle: z.string().trim().min(1).max(64),
      authHash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  )
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const handle = data.handle.trim().toLowerCase()
    const now = Date.now()
    const bucket = `login:${handle}`

    if (db.isRateLimited(bucket, now)) {
      throw new Error('RATE_LIMITED')
    }

    const user = db.findUserByHandle(handle)
    if (!user || !session.constantTimeEqual(user.auth_hash, session.sha256Hex(data.authHash))) {
      db.recordFailure(bucket, now, 15 * 60 * 1000)
      throw new Error('INVALID_CREDENTIALS')
    }

    db.clearFailures(bucket)
    session.startSession(user.id)
    return { handle: user.handle }
  })

export const logoutFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { session } = await store()
  session.endSession()
  return { ok: true }
})

export const pullVaultFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { db, session } = await store()
  const user = session.requireUser()
  const row = db.getVault(user.id)
  if (!row) return null
  return {
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    version: row.version,
    updatedAt: row.updated_at,
  }
})

export const pushVaultFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      baseVersion: z.number().int().min(0),
      ...vaultPayload,
    }),
  )
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = session.requireUser()
    const current = db.getVault(user.id)
    if (!current) throw new Error('VAULT_MISSING')
    if (current.version !== data.baseVersion) {
      throw new Error('CONFLICT')
    }
    const now = Date.now()
    const nextVersion = current.version + 1
    db.upsertVault({
      user_id: user.id,
      ciphertext: data.ciphertext,
      nonce: data.nonce,
      version: nextVersion,
      updated_at: now,
    })
    return { version: nextVersion, updatedAt: now }
  })

/** Re-key: swap KDF salt, auth verifier and vault blob in one shot. */
export const rotateFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      kdf: kdfSchema,
      authHash: z.string().regex(/^[0-9a-f]{64}$/),
      ...vaultPayload,
    }),
  )
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = session.requireUser()
    const current = db.getVault(user.id)
    if (!current) throw new Error('VAULT_MISSING')

    db.updateUserAuth(user.id, JSON.stringify(data.kdf), session.sha256Hex(data.authHash))
    const now = Date.now()
    const nextVersion = current.version + 1
    db.upsertVault({
      user_id: user.id,
      ciphertext: data.ciphertext,
      nonce: data.nonce,
      version: nextVersion,
      updated_at: now,
    })
    return { version: nextVersion, updatedAt: now }
  })
