import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { KdfConfig } from '~/lib/crypto'
import { RECIPIENT_SHARE_TTL_MS } from '~/lib/recipient-share'

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

const shareIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Invalid share id',
  )

const authHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
const shareCiphertext = z.string().min(16).max(32_000)
const identityPublicKey = z.string().min(40).max(1_024)
const identityCiphertext = z.string().min(16).max(2_000)
const wrappedShareKey = z.string().min(16).max(256)
const recipientEnvelope = {
  ephemeralPublicKey: identityPublicKey,
  wrapNonce: vaultPayload.nonce,
  wrappedKey: wrappedShareKey,
}
const identityPayload = {
  publicKey: identityPublicKey,
  ciphertext: identityCiphertext,
  nonce: vaultPayload.nonce,
}
const entryIdSchema = z.string().min(1).max(128)
const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Invalid id',
  )
const MAX_ACTIVE_RECIPIENT_SHARES = 50
const MAX_ACTIVE_RECIPIENT_SHARES_PER_ENTRY = 20

async function store() {
  const db = await import('./db.server')
  const session = await import('./session.server')
  return { db, session }
}

async function passkeys() {
  return import('./webauthn.server')
}

async function verifyCredentials(handleInput: string, authHash: string) {
  const { db, session } = await store()
  const handle = handleInput.trim().toLowerCase()
  const now = Date.now()
  const bucket = `login:${handle}`

  if (await db.isRateLimited(bucket, now)) {
    throw new Error('RATE_LIMITED')
  }

  const user = await db.findUserByHandle(handle)
  if (!user || !session.constantTimeEqual(user.auth_hash, session.sha256Hex(authHash))) {
    await db.recordFailure(bucket, now, 15 * 60 * 1000)
    throw new Error('INVALID_CREDENTIALS')
  }

  await db.clearFailures(bucket)
  return { db, session, user }
}

/** Constant-time-ish: unknown handles get a stable fake salt so the UI flow is identical. */
function fakeKdf(handle: string): KdfConfig {
  const saltSeed = Buffer.from(handle).toString('base64url').padEnd(22, 'A').slice(0, 22)
  return { algorithm: 'argon2id', t: 3, m: 65536, p: 1, salt: saltSeed }
}

export const meFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { session } = await store()
  const user = await session.currentUser()
  return { authenticated: Boolean(user), handle: user?.handle ?? null }
})

/**
 * The identity private key is stored only as ciphertext under the vault key.
 * The public key is a key-directory entry used by senders.
 */
export const getIdentityFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { db, session } = await store()
  const user = await session.requireUser()
  const identity = await db.getIdentity(user.id)
  if (!identity) return null
  return {
    publicKey: identity.public_key,
    ciphertext: identity.ciphertext,
    nonce: identity.nonce,
    createdAt: identity.created_at,
    updatedAt: identity.updated_at,
  }
})

export const createIdentityFn = createServerFn({ method: 'POST' })
  .validator(z.object({ ...identityPayload, authHash: authHashSchema }))
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = await session.requireUser()
    // A session cookie alone must not let an attacker install a sharing key
    // that future senders would wrap to. Proving the master password binds the
    // identity directory entry to the vault owner.
    const verified = await verifyCredentials(user.handle, data.authHash)
    if (verified.user.id !== user.id) throw new Error('INVALID_CREDENTIALS')
    const now = Date.now()
    const created = await db.createIdentity({
      user_id: user.id,
      public_key: data.publicKey,
      ciphertext: data.ciphertext,
      nonce: data.nonce,
      created_at: now,
      updated_at: now,
    })
    const identity = await db.getIdentity(user.id)
    if (!identity) throw new Error('IDENTITY_UNAVAILABLE')
    return {
      created,
      identity: {
        publicKey: identity.public_key,
        ciphertext: identity.ciphertext,
        nonce: identity.nonce,
        createdAt: identity.created_at,
        updatedAt: identity.updated_at,
      },
    }
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
    if (await db.findUserByHandle(data.handle)) {
      throw new Error('HANDLE_TAKEN')
    }
    const now = Date.now()
    const userId = crypto.randomUUID()
    try {
      await db.createUserWithVault(
        {
          id: userId,
          handle: data.handle,
          kdf: JSON.stringify(data.kdf),
          auth_hash: session.sha256Hex(data.authHash),
          created_at: now,
        },
        {
          user_id: userId,
          ciphertext: data.ciphertext,
          nonce: data.nonce,
          version: 1,
          updated_at: now,
        },
      )
    } catch (error) {
      if (db.isUniqueViolation(error)) throw new Error('HANDLE_TAKEN')
      throw error
    }
    await session.startSession(userId)
    return { handle: data.handle, version: 1 }
  })

export const kdfFn = createServerFn({ method: 'POST' })
  .validator(z.object({ handle: z.string().trim().min(1).max(64) }))
  .handler(async ({ data }) => {
    const { db } = await store()
    const user = await db.findUserByHandle(data.handle.trim().toLowerCase())
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
    const { db, session, user } = await verifyCredentials(data.handle, data.authHash)

    if (await db.countPasskeys(user.id) === 0) {
      await session.startSession(user.id)
      return { handle: user.handle }
    }

    const webAuthn = await passkeys()
    const challenge = await webAuthn.beginPasskeyLogin(user)
    return {
      handle: user.handle,
      passkeyRequired: true as const,
      ...challenge,
    }
  })

/**
 * Re-authenticate the current session without starting a new one or asking for
 * a passkey. Used by master-password rotation, where the session already exists.
 */
export const verifyAuthFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      handle: handleSchema,
      authHash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await store()
    const current = await session.requireUser()
    if (current.handle !== data.handle) throw new Error('INVALID_CREDENTIALS')
    const { user } = await verifyCredentials(data.handle, data.authHash)
    if (user.id !== current.id) throw new Error('INVALID_CREDENTIALS')
    return { ok: true }
  })

export const beginPasskeyRegistrationFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { session } = await store()
  const user = await session.requireUser()
  const webAuthn = await passkeys()
  return webAuthn.beginPasskeyRegistration(user)
})

export const finishPasskeyRegistrationFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      challengeId: uuidSchema,
      response: z.unknown(),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await store()
    const user = await session.requireUser()
    const webAuthn = await passkeys()
    return webAuthn.finishPasskeyRegistration(user, data.challengeId, data.response)
  })

export const finishPasskeyLoginFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      challengeId: uuidSchema,
      response: z.unknown(),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await store()
    const webAuthn = await passkeys()
    const { user } = await webAuthn.finishPasskeyLogin(data.challengeId, data.response)
    await session.startSession(user.id)
    return { handle: user.handle }
  })

export const finishPasskeyRecoveryFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      challengeId: uuidSchema,
      code: z.string().trim().min(1).max(128),
    }),
  )
  .handler(async ({ data }) => {
    const { session } = await store()
    const webAuthn = await passkeys()
    const { user } = await webAuthn.finishPasskeyRecovery(data.challengeId, data.code)
    await session.startSession(user.id)
    return { handle: user.handle }
  })

export const listPasskeysFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { session } = await store()
  const user = await session.requireUser()
  const webAuthn = await passkeys()
  return webAuthn.listPasskeys(user)
})

export const removePasskeyFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: uuidSchema }))
  .handler(async ({ data }) => {
    const { session } = await store()
    const user = await session.requireUser()
    const webAuthn = await passkeys()
    return webAuthn.removePasskey(user, data.id)
  })

export const logoutFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { session } = await store()
  await session.endSession()
  return { ok: true }
})

export const pullVaultFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { db, session } = await store()
  const user = await session.requireUser()
  const row = await db.getVault(user.id)
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
    const user = await session.requireUser()
    const current = await db.getVault(user.id)
    if (!current) throw new Error('VAULT_MISSING')
    if (current.version !== data.baseVersion) {
      throw new Error('CONFLICT')
    }
    const now = Date.now()
    const nextVersion = current.version + 1
    await db.upsertVault({
      user_id: user.id,
      ciphertext: data.ciphertext,
      nonce: data.nonce,
      version: nextVersion,
      updated_at: now,
    })
    return { version: nextVersion, updatedAt: now }
  })

/** Re-key: swap KDF salt, auth verifier, vault blob, and identity envelope in one shot. */
export const rotateFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      currentAuthHash: authHashSchema,
      kdf: kdfSchema,
      authHash: authHashSchema,
      ...vaultPayload,
      identity: z.object(identityPayload).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = await session.requireUser()
    // Re-keying changes the verifier itself, so require proof of the current
    // password in the same request. A stolen session cannot rotate the account
    // out from under its owner.
    const verified = await verifyCredentials(user.handle, data.currentAuthHash)
    if (verified.user.id !== user.id) throw new Error('INVALID_CREDENTIALS')

    const current = await db.getVault(user.id)
    if (!current) throw new Error('VAULT_MISSING')

    const existingIdentity = await db.getIdentity(user.id)
    if (existingIdentity && !data.identity) throw new Error('IDENTITY_REQUIRED')
    if (data.identity) {
      if (!existingIdentity) throw new Error('IDENTITY_MISSING')
      if (existingIdentity.public_key !== data.identity.publicKey) {
        throw new Error('IDENTITY_CHANGED')
      }
    }

    const now = Date.now()
    const nextVersion = current.version + 1
    await db.rotateUserKeys({
      userId: user.id,
      kdf: JSON.stringify(data.kdf),
      authHash: session.sha256Hex(data.authHash),
      vault: {
        user_id: user.id,
        ciphertext: data.ciphertext,
        nonce: data.nonce,
        version: nextVersion,
        updated_at: now,
      },
      identity: data.identity
        ? {
            publicKey: data.identity.publicKey,
            ciphertext: data.identity.ciphertext,
            nonce: data.identity.nonce,
            updatedAt: now,
          }
        : undefined,
    })
    return { version: nextVersion, updatedAt: now }
  })

/**
 * Legacy bearer-link read. New shares are recipient-bound, but links created
 * before this release stay readable until their three-day expiry.
 */
export const getShareFn = createServerFn({ method: 'GET' })
  .validator(z.object({ id: shareIdSchema }))
  .handler(async ({ data }) => {
    const { db } = await store()
    const now = Date.now()
    await db.deleteExpiredShares(now)
    const share = await db.getShare(data.id)
    if (!share || share.expires_at <= now) throw new Error('SHARE_UNAVAILABLE')
    return {
      id: share.id,
      ciphertext: share.ciphertext,
      nonce: share.nonce,
      expiresAt: share.expires_at,
      createdAt: share.created_at,
    }
  })

/** Resolve a recipient handle to the public half of their sharing identity. */
export const lookupRecipientFn = createServerFn({ method: 'POST' })
  .validator(z.object({ handle: handleSchema }))
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = await session.requireUser()
    const recipient = await db.findUserByHandle(data.handle)
    if (!recipient) throw new Error('RECIPIENT_NOT_FOUND')
    if (recipient.id === user.id) throw new Error('RECIPIENT_SELF')
    const identity = await db.getIdentity(recipient.id)
    if (!identity) throw new Error('RECIPIENT_NOT_READY')
    return { handle: recipient.handle, publicKey: identity.public_key }
  })

/**
 * Store one recipient-bound share. The server receives the payload ciphertext
 * and a P-256 envelope for exactly one account; it never receives the random
 * share key or either private key.
 */
export const createRecipientShareFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: shareIdSchema,
      entryId: entryIdSchema,
      recipientHandle: handleSchema,
      recipientPublicKey: identityPublicKey,
      ciphertext: shareCiphertext,
      nonce: vaultPayload.nonce,
      ...recipientEnvelope,
    }),
  )
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = await session.requireUser()
    const recipient = await db.findUserByHandle(data.recipientHandle)
    if (!recipient) throw new Error('RECIPIENT_NOT_FOUND')
    if (recipient.id === user.id) throw new Error('RECIPIENT_SELF')
    const identity = await db.getIdentity(recipient.id)
    if (!identity) throw new Error('RECIPIENT_NOT_READY')
    if (identity.public_key !== data.recipientPublicKey) {
      throw new Error('RECIPIENT_KEY_CHANGED')
    }

    const now = Date.now()
    await db.deleteExpiredRecipientShares(now)
    if (await db.hasActiveRecipientShare(user.id, recipient.id, data.entryId, now)) {
      throw new Error('SHARE_ALREADY_EXISTS')
    }
    if (await db.countActiveRecipientShares(user.id, now) >= MAX_ACTIVE_RECIPIENT_SHARES) {
      throw new Error('SHARE_LIMIT')
    }
    if (
      await db.countActiveRecipientSharesForEntry(user.id, data.entryId, now) >=
      MAX_ACTIVE_RECIPIENT_SHARES_PER_ENTRY
    ) {
      throw new Error('SHARE_ENTRY_LIMIT')
    }

    const expiresAt = now + RECIPIENT_SHARE_TTL_MS
    try {
      await db.createRecipientShare({
        id: data.id,
        owner_id: user.id,
        recipient_id: recipient.id,
        entry_id: data.entryId,
        ciphertext: data.ciphertext,
        nonce: data.nonce,
        ephemeral_public_key: data.ephemeralPublicKey,
        wrap_nonce: data.wrapNonce,
        wrapped_key: data.wrappedKey,
        created_at: now,
        expires_at: expiresAt,
      })
    } catch (error) {
      if (db.isUniqueViolation(error)) throw new Error('SHARE_ALREADY_EXISTS')
      throw error
    }

    return {
      id: data.id,
      recipientHandle: recipient.handle,
      expiresAt,
      createdAt: now,
    }
  })

export const listSentRecipientSharesFn = createServerFn({ method: 'GET' })
  .validator(z.object({ entryId: entryIdSchema }))
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = await session.requireUser()
    const now = Date.now()
    await db.deleteExpiredRecipientShares(now)
    return { shares: await db.listSentRecipientShares(user.id, data.entryId, now) }
  })

export const listAllSentRecipientSharesFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { db, session } = await store()
    const user = await session.requireUser()
    const now = Date.now()
    await db.deleteExpiredRecipientShares(now)
    return { shares: await db.listAllSentRecipientShares(user.id, now) }
  },
)

export const listReceivedRecipientSharesFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { db, session } = await store()
    const user = await session.requireUser()
    const now = Date.now()
    await db.deleteExpiredRecipientShares(now)
    return { shares: await db.listReceivedRecipientShares(user.id, now) }
  },
)

export const revokeRecipientShareFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: shareIdSchema }))
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = await session.requireUser()
    if (!await db.deleteRecipientShareForOwner(data.id, user.id)) {
      throw new Error('SHARE_NOT_FOUND')
    }
    return { ok: true }
  })

/** A recipient can remove a share from their inbox; this is a self-revoke. */
export const dismissReceivedRecipientShareFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: shareIdSchema }))
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = await session.requireUser()
    if (!await db.deleteRecipientShareForRecipient(data.id, user.id)) {
      throw new Error('SHARE_NOT_FOUND')
    }
    return { ok: true }
  })

/** Permanent item deletion revokes every recipient share for that opaque id. */
export const deleteRecipientSharesForEntryFn = createServerFn({ method: 'POST' })
  .validator(z.object({ entryId: entryIdSchema }))
  .handler(async ({ data }) => {
    const { db, session } = await store()
    const user = await session.requireUser()
    const deleted = await db.deleteRecipientSharesForEntry(user.id, data.entryId)
    return { deleted }
  })
