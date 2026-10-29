/**
 * Server-only persistence. SQLite is used for local development and tests;
 * PostgreSQL (including Supabase PostgreSQL) is used when
 * ROOK_DATABASE_URL is set. Nothing here ever sees a master password or
 * plaintext vault.
 */
import { ensureSchema, getSql, isUniqueViolation, type SqlDatabase } from './sql.server'

async function database(): Promise<SqlDatabase> {
  await ensureSchema()
  return getSql()
}

export { isUniqueViolation }

export interface UserRow {
  id: string
  handle: string
  kdf: string
  auth_hash: string
  created_at: number
}

export async function findUserByHandle(handle: string): Promise<UserRow | undefined> {
  const sql = await database()
  return sql.get<UserRow>('SELECT * FROM users WHERE handle = ?', [handle])
}

export async function findUserById(id: string): Promise<UserRow | undefined> {
  const sql = await database()
  return sql.get<UserRow>('SELECT * FROM users WHERE id = ?', [id])
}

export async function createUser(user: UserRow): Promise<void> {
  const sql = await database()
  await sql.run(
    'INSERT INTO users (id, handle, kdf, auth_hash, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.id, user.handle, user.kdf, user.auth_hash, user.created_at],
  )
}

export async function updateUserAuth(id: string, kdf: string, authHash: string): Promise<void> {
  const sql = await database()
  await sql.run('UPDATE users SET kdf = ?, auth_hash = ? WHERE id = ?', [kdf, authHash, id])
}

export interface VaultRow {
  user_id: string
  ciphertext: string
  nonce: string
  version: number
  updated_at: number
}

export async function getVault(userId: string): Promise<VaultRow | undefined> {
  const sql = await database()
  return sql.get<VaultRow>('SELECT * FROM vaults WHERE user_id = ?', [userId])
}

export async function upsertVault(row: VaultRow): Promise<void> {
  const sql = await database()
  await sql.run(
    `INSERT INTO vaults (user_id, ciphertext, nonce, version, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       nonce = excluded.nonce,
       version = excluded.version,
       updated_at = excluded.updated_at`,
    [row.user_id, row.ciphertext, row.nonce, row.version, row.updated_at],
  )
}

/** Registration creates the account and its first vault atomically. */
export async function createUserWithVault(
  user: UserRow,
  vault: VaultRow,
): Promise<void> {
  const sql = await database()
  await sql.transaction(async (tx) => {
    await tx.run(
      'INSERT INTO users (id, handle, kdf, auth_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      [user.id, user.handle, user.kdf, user.auth_hash, user.created_at],
    )
    await tx.run(
      `INSERT INTO vaults (user_id, ciphertext, nonce, version, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [vault.user_id, vault.ciphertext, vault.nonce, vault.version, vault.updated_at],
    )
  })
}

export interface IdentityRow {
  user_id: string
  public_key: string
  ciphertext: string
  nonce: string
  created_at: number
  updated_at: number
}

export async function getIdentity(userId: string): Promise<IdentityRow | undefined> {
  const sql = await database()
  return sql.get<IdentityRow>('SELECT * FROM user_identities WHERE user_id = ?', [userId])
}

/** First writer wins, so two tabs cannot create conflicting account identities. */
export async function createIdentity(row: IdentityRow): Promise<boolean> {
  const sql = await database()
  const result = await sql.run(
    `INSERT INTO user_identities
      (user_id, public_key, ciphertext, nonce, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    [
      row.user_id,
      row.public_key,
      row.ciphertext,
      row.nonce,
      row.created_at,
      row.updated_at,
    ],
  )
  return result.changes > 0
}

export interface RotateUserKeysInput {
  userId: string
  kdf: string
  authHash: string
  vault: VaultRow
  identity?: {
    publicKey: string
    ciphertext: string
    nonce: string
    updatedAt: number
  }
}

/**
 * Master-password rotation must move the vault, auth verifier, and identity
 * private-key envelope together. A partial update would strand either the
 * vault or every received share behind the old key.
 */
export async function rotateUserKeys(input: RotateUserKeysInput): Promise<void> {
  const sql = await database()
  await sql.transaction(async (tx) => {
    await tx.run('UPDATE users SET kdf = ?, auth_hash = ? WHERE id = ?', [
      input.kdf,
      input.authHash,
      input.userId,
    ])
    await tx.run(
      `INSERT INTO vaults (user_id, ciphertext, nonce, version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         nonce = excluded.nonce,
         version = excluded.version,
         updated_at = excluded.updated_at`,
      [
        input.vault.user_id,
        input.vault.ciphertext,
        input.vault.nonce,
        input.vault.version,
        input.vault.updated_at,
      ],
    )

    if (input.identity) {
      const result = await tx.run(
        `UPDATE user_identities
         SET ciphertext = ?, nonce = ?, updated_at = ?
         WHERE user_id = ? AND public_key = ?`,
        [
          input.identity.ciphertext,
          input.identity.nonce,
          input.identity.updatedAt,
          input.userId,
          input.identity.publicKey,
        ],
      )
      if (result.changes !== 1) throw new Error('IDENTITY_CHANGED')
    }
  })
}

export async function createSession(
  tokenHash: string,
  userId: string,
  expiresAt: number,
  now: number,
): Promise<void> {
  const sql = await database()
  await sql.run(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [tokenHash, userId, expiresAt, now],
  )
}

export async function findSession(
  tokenHash: string,
): Promise<{ user_id: string; expires_at: number } | undefined> {
  const sql = await database()
  return sql.get<{ user_id: string; expires_at: number }>(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?',
    [tokenHash],
  )
}

export async function deleteSession(tokenHash: string): Promise<void> {
  const sql = await database()
  await sql.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash])
}

export async function deleteExpiredSessions(now: number): Promise<void> {
  const sql = await database()
  await sql.run('DELETE FROM sessions WHERE expires_at < ?', [now])
}

/** Fixed-window brute-force guard. Returns true when the caller is locked out. */
export async function isRateLimited(bucket: string, now: number): Promise<boolean> {
  const sql = await database()
  const row = await sql.get<{ failures: number; reset_at: number }>(
    'SELECT failures, reset_at FROM login_attempts WHERE bucket = ?',
    [bucket],
  )
  if (!row) return false
  if (row.reset_at <= now) return false
  return Number(row.failures) >= 8
}

export async function recordFailure(
  bucket: string,
  now: number,
  windowMs: number,
): Promise<void> {
  const sql = await database()
  await sql.run(
    `INSERT INTO login_attempts (bucket, failures, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET
       failures = CASE WHEN login_attempts.reset_at <= ? THEN 1 ELSE login_attempts.failures + 1 END,
       reset_at = CASE WHEN login_attempts.reset_at <= ? THEN excluded.reset_at ELSE login_attempts.reset_at END`,
    [bucket, now + windowMs, now, now],
  )
}

export async function clearFailures(bucket: string): Promise<void> {
  const sql = await database()
  await sql.run('DELETE FROM login_attempts WHERE bucket = ?', [bucket])
}

export interface ShareRow {
  id: string
  user_id: string
  entry_id: string
  ciphertext: string
  nonce: string
  expires_at: number
  created_at: number
}

export async function getShare(id: string): Promise<ShareRow | undefined> {
  const sql = await database()
  return sql.get<ShareRow>('SELECT * FROM shares WHERE id = ?', [id])
}

/** Legacy bearer links remain readable until their original expiry. */
export async function deleteExpiredShares(now: number): Promise<void> {
  const sql = await database()
  await sql.run('DELETE FROM shares WHERE expires_at <= ?', [now])
}

export interface RecipientShareRow {
  id: string
  owner_id: string
  recipient_id: string
  entry_id: string
  ciphertext: string
  nonce: string
  ephemeral_public_key: string
  wrap_nonce: string
  wrapped_key: string
  created_at: number
  expires_at: number
}

export interface SentRecipientShareRow {
  id: string
  entryId: string
  recipientId: string
  recipientHandle: string
  expiresAt: number
  createdAt: number
}

export interface ReceivedRecipientShareRow {
  id: string
  entryId: string
  ownerHandle: string
  ciphertext: string
  nonce: string
  ephemeralPublicKey: string
  wrapNonce: string
  wrappedKey: string
  expiresAt: number
  createdAt: number
}

export async function createRecipientShare(row: RecipientShareRow): Promise<void> {
  const sql = await database()
  await sql.run(
    `INSERT INTO recipient_shares
      (id, owner_id, recipient_id, entry_id, ciphertext, nonce,
       ephemeral_public_key, wrap_nonce, wrapped_key, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.owner_id,
      row.recipient_id,
      row.entry_id,
      row.ciphertext,
      row.nonce,
      row.ephemeral_public_key,
      row.wrap_nonce,
      row.wrapped_key,
      row.created_at,
      row.expires_at,
    ],
  )
}

export async function countActiveRecipientShares(
  ownerId: string,
  now: number,
): Promise<number> {
  const sql = await database()
  const row = await sql.get<{ count: number | string }>(
    'SELECT COUNT(*) AS count FROM recipient_shares WHERE owner_id = ? AND expires_at > ?',
    [ownerId, now],
  )
  return Number(row?.count ?? 0)
}

export async function countActiveRecipientSharesForEntry(
  ownerId: string,
  entryId: string,
  now: number,
): Promise<number> {
  const sql = await database()
  const row = await sql.get<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM recipient_shares
     WHERE owner_id = ? AND entry_id = ? AND expires_at > ?`,
    [ownerId, entryId, now],
  )
  return Number(row?.count ?? 0)
}

export async function hasActiveRecipientShare(
  ownerId: string,
  recipientId: string,
  entryId: string,
  now: number,
): Promise<boolean> {
  const sql = await database()
  const row = await sql.get<{ found: number }>(
    `SELECT 1 AS found FROM recipient_shares
     WHERE owner_id = ? AND recipient_id = ? AND entry_id = ? AND expires_at > ?
     LIMIT 1`,
    [ownerId, recipientId, entryId, now],
  )
  return Boolean(row)
}

export async function listSentRecipientShares(
  ownerId: string,
  entryId: string,
  now: number,
): Promise<SentRecipientShareRow[]> {
  const sql = await database()
  return sql.all<SentRecipientShareRow>(
    `SELECT rs.id,
            rs.entry_id AS "entryId",
            rs.recipient_id AS "recipientId",
            recipient.handle AS "recipientHandle",
            rs.expires_at AS "expiresAt",
            rs.created_at AS "createdAt"
     FROM recipient_shares rs
     JOIN users recipient ON recipient.id = rs.recipient_id
     WHERE rs.owner_id = ? AND rs.entry_id = ? AND rs.expires_at > ?
     ORDER BY rs.created_at DESC`,
    [ownerId, entryId, now],
  )
}

export async function listAllSentRecipientShares(
  ownerId: string,
  now: number,
): Promise<SentRecipientShareRow[]> {
  const sql = await database()
  return sql.all<SentRecipientShareRow>(
    `SELECT rs.id,
            rs.entry_id AS "entryId",
            rs.recipient_id AS "recipientId",
            recipient.handle AS "recipientHandle",
            rs.expires_at AS "expiresAt",
            rs.created_at AS "createdAt"
     FROM recipient_shares rs
     JOIN users recipient ON recipient.id = rs.recipient_id
     WHERE rs.owner_id = ? AND rs.expires_at > ?
     ORDER BY rs.created_at DESC`,
    [ownerId, now],
  )
}

export async function listReceivedRecipientShares(
  recipientId: string,
  now: number,
): Promise<ReceivedRecipientShareRow[]> {
  const sql = await database()
  return sql.all<ReceivedRecipientShareRow>(
    `SELECT rs.id,
            rs.entry_id AS "entryId",
            owner.handle AS "ownerHandle",
            rs.ciphertext,
            rs.nonce,
            rs.ephemeral_public_key AS "ephemeralPublicKey",
            rs.wrap_nonce AS "wrapNonce",
            rs.wrapped_key AS "wrappedKey",
            rs.expires_at AS "expiresAt",
            rs.created_at AS "createdAt"
     FROM recipient_shares rs
     JOIN users owner ON owner.id = rs.owner_id
     WHERE rs.recipient_id = ? AND rs.expires_at > ?
     ORDER BY rs.created_at DESC`,
    [recipientId, now],
  )
}

export async function deleteRecipientShareForOwner(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const sql = await database()
  const result = await sql.run('DELETE FROM recipient_shares WHERE id = ? AND owner_id = ?', [
    id,
    ownerId,
  ])
  return result.changes > 0
}

export async function deleteRecipientShareForRecipient(
  id: string,
  recipientId: string,
): Promise<boolean> {
  const sql = await database()
  const result = await sql.run(
    'DELETE FROM recipient_shares WHERE id = ? AND recipient_id = ?',
    [id, recipientId],
  )
  return result.changes > 0
}

export async function deleteRecipientSharesForEntry(
  ownerId: string,
  entryId: string,
): Promise<number> {
  const sql = await database()
  const result = await sql.run(
    'DELETE FROM recipient_shares WHERE owner_id = ? AND entry_id = ?',
    [ownerId, entryId],
  )
  return result.changes
}

export async function deleteExpiredRecipientShares(now: number): Promise<void> {
  const sql = await database()
  await sql.run('DELETE FROM recipient_shares WHERE expires_at <= ?', [now])
}

export interface PasskeyRow {
  id: string
  user_id: string
  credential_id: string
  public_key: string
  counter: number
  transports: string
  device_type: string
  backed_up: number
  aaguid: string
  name: string
  created_at: number
  last_used_at: number | null
}

export async function listPasskeys(userId: string): Promise<PasskeyRow[]> {
  const sql = await database()
  return sql.all<PasskeyRow>(
    'SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  )
}

export async function countPasskeys(userId: string): Promise<number> {
  const sql = await database()
  const row = await sql.get<{ count: number | string }>(
    'SELECT COUNT(*) AS count FROM passkeys WHERE user_id = ?',
    [userId],
  )
  return Number(row?.count ?? 0)
}

export async function getPasskeyByCredentialId(
  credentialId: string,
): Promise<PasskeyRow | undefined> {
  const sql = await database()
  return sql.get<PasskeyRow>('SELECT * FROM passkeys WHERE credential_id = ?', [credentialId])
}

export async function createPasskey(row: PasskeyRow): Promise<void> {
  const sql = await database()
  await sql.run(
    `INSERT INTO passkeys
      (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.user_id,
      row.credential_id,
      row.public_key,
      row.counter,
      row.transports,
      row.device_type,
      row.backed_up,
      row.aaguid,
      row.name,
      row.created_at,
      row.last_used_at,
    ],
  )
}

export async function updatePasskeyAfterUse(
  id: string,
  counter: number,
  lastUsedAt: number,
  deviceType: string,
  backedUp: boolean,
): Promise<void> {
  const sql = await database()
  await sql.run(
    `UPDATE passkeys
     SET counter = ?, last_used_at = ?, device_type = ?, backed_up = ?
     WHERE id = ?`,
    [counter, lastUsedAt, deviceType, backedUp ? 1 : 0, id],
  )
}

export async function deletePasskeyForUser(id: string, userId: string): Promise<boolean> {
  const sql = await database()
  const result = await sql.run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ])
  return result.changes > 0
}

export interface WebAuthnChallengeRow {
  id: string
  user_id: string
  kind: string
  challenge: string
  expires_at: number
}

export async function createWebAuthnChallenge(row: WebAuthnChallengeRow): Promise<void> {
  const sql = await database()
  await sql.run(
    'INSERT INTO webauthn_challenges (id, user_id, kind, challenge, expires_at) VALUES (?, ?, ?, ?, ?)',
    [row.id, row.user_id, row.kind, row.challenge, row.expires_at],
  )
}

/**
 * Single-use challenge: delete and return it in one statement. A plain
 * SELECT-then-DELETE transaction is not enough on PostgreSQL because two
 * concurrent readers can both see the row before either delete commits.
 */
export async function takeWebAuthnChallenge(
  id: string,
  kind: string,
): Promise<WebAuthnChallengeRow | undefined> {
  const sql = await database()
  const row = await sql.get<WebAuthnChallengeRow>(
    'DELETE FROM webauthn_challenges WHERE id = ? AND kind = ? RETURNING *',
    [id, kind],
  )
  if (!row || row.expires_at <= Date.now()) return undefined
  return row
}

export async function deleteWebAuthnChallengesForUser(
  userId: string,
  kind?: string,
): Promise<void> {
  const sql = await database()
  if (kind) {
    await sql.run('DELETE FROM webauthn_challenges WHERE user_id = ? AND kind = ?', [
      userId,
      kind,
    ])
    return
  }
  await sql.run('DELETE FROM webauthn_challenges WHERE user_id = ?', [userId])
}

export async function deleteExpiredWebAuthnChallenges(now: number): Promise<void> {
  const sql = await database()
  await sql.run('DELETE FROM webauthn_challenges WHERE expires_at <= ?', [now])
}

export interface PasskeyRecoveryRow {
  user_id: string
  code_hash: string
  created_at: number
}

export async function getPasskeyRecovery(
  userId: string,
): Promise<PasskeyRecoveryRow | undefined> {
  const sql = await database()
  return sql.get<PasskeyRecoveryRow>('SELECT * FROM passkey_recovery WHERE user_id = ?', [
    userId,
  ])
}

export async function upsertPasskeyRecovery(
  userId: string,
  codeHash: string,
  now: number,
): Promise<void> {
  const sql = await database()
  await sql.run(
    `INSERT INTO passkey_recovery (user_id, code_hash, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at`,
    [userId, codeHash, now],
  )
}

export async function deletePasskeyRecovery(userId: string): Promise<void> {
  const sql = await database()
  await sql.run('DELETE FROM passkey_recovery WHERE user_id = ?', [userId])
}
