/**
 * Server-only persistence. Uses Node's built-in SQLite (no native deps).
 * Nothing here ever sees a master password or plaintext vault.
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const dataDir = process.env.ROOK_DATA_DIR ?? process.env.KEYNEST_DATA_DIR ?? join(process.cwd(), 'data')

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  mkdirSync(dataDir, { recursive: true })
  db = new DatabaseSync(join(dataDir, 'rook.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      handle     TEXT NOT NULL UNIQUE,
      kdf        TEXT NOT NULL,
      auth_hash  TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vaults (
      user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL,
      nonce      TEXT NOT NULL,
      version    INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      bucket     TEXT PRIMARY KEY,
      failures   INTEGER NOT NULL DEFAULT 0,
      reset_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shares (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_id   TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      nonce      TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_identities (
      user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      nonce      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipient_shares (
      id                   TEXT PRIMARY KEY,
      owner_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_id             TEXT NOT NULL,
      ciphertext           TEXT NOT NULL,
      nonce                TEXT NOT NULL,
      ephemeral_public_key TEXT NOT NULL,
      wrap_nonce           TEXT NOT NULL,
      wrapped_key          TEXT NOT NULL,
      created_at           INTEGER NOT NULL,
      expires_at           INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_id   TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      nonce      TEXT NOT NULL,
      size       INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passkeys (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key    TEXT NOT NULL,
      counter       INTEGER NOT NULL DEFAULT 0,
      transports    TEXT NOT NULL DEFAULT '[]',
      device_type   TEXT NOT NULL DEFAULT 'singleDevice',
      backed_up     INTEGER NOT NULL DEFAULT 0,
      aaguid        TEXT NOT NULL DEFAULT '',
      name          TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      last_used_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      challenge  TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passkey_recovery (
      user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      code_hash  TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_user_entry ON attachments(user_id, entry_id);
    CREATE INDEX IF NOT EXISTS idx_shares_user_entry ON shares(user_id, entry_id);
    CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recipient_shares_unique
      ON recipient_shares(owner_id, recipient_id, entry_id);
    CREATE INDEX IF NOT EXISTS idx_recipient_shares_owner_entry
      ON recipient_shares(owner_id, entry_id);
    CREATE INDEX IF NOT EXISTS idx_recipient_shares_recipient
      ON recipient_shares(recipient_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_recipient_shares_expires
      ON recipient_shares(expires_at);
    CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
    CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user ON webauthn_challenges(user_id, kind);
    CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
  `)
  return db
}

export interface UserRow {
  id: string
  handle: string
  kdf: string
  auth_hash: string
  created_at: number
}

export function findUserByHandle(handle: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE handle = ?').get(handle) as UserRow | undefined
}

export function findUserById(id: string): UserRow | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function createUser(user: UserRow): void {
  getDb()
    .prepare('INSERT INTO users (id, handle, kdf, auth_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, user.handle, user.kdf, user.auth_hash, user.created_at)
}

export function updateUserAuth(id: string, kdf: string, authHash: string): void {
  getDb().prepare('UPDATE users SET kdf = ?, auth_hash = ? WHERE id = ?').run(kdf, authHash, id)
}

export interface VaultRow {
  user_id: string
  ciphertext: string
  nonce: string
  version: number
  updated_at: number
}

export function getVault(userId: string): VaultRow | undefined {
  return getDb().prepare('SELECT * FROM vaults WHERE user_id = ?').get(userId) as VaultRow | undefined
}

export function upsertVault(row: VaultRow): void {
  getDb()
    .prepare(
      `INSERT INTO vaults (user_id, ciphertext, nonce, version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         nonce = excluded.nonce,
         version = excluded.version,
         updated_at = excluded.updated_at`,
    )
    .run(row.user_id, row.ciphertext, row.nonce, row.version, row.updated_at)
}

export interface IdentityRow {
  user_id: string
  public_key: string
  ciphertext: string
  nonce: string
  created_at: number
  updated_at: number
}

export function getIdentity(userId: string): IdentityRow | undefined {
  return getDb()
    .prepare('SELECT * FROM user_identities WHERE user_id = ?')
    .get(userId) as IdentityRow | undefined
}

/** First writer wins, so two tabs cannot create conflicting account identities. */
export function createIdentity(row: IdentityRow): boolean {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_identities
        (user_id, public_key, ciphertext, nonce, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.user_id,
      row.public_key,
      row.ciphertext,
      row.nonce,
      row.created_at,
      row.updated_at,
    )
  return Number(result.changes) > 0
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
export function rotateUserKeys(input: RotateUserKeysInput): void {
  const db = getDb()
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare('UPDATE users SET kdf = ?, auth_hash = ? WHERE id = ?').run(
      input.kdf,
      input.authHash,
      input.userId,
    )
    db.prepare(
      `INSERT INTO vaults (user_id, ciphertext, nonce, version, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         nonce = excluded.nonce,
         version = excluded.version,
         updated_at = excluded.updated_at`,
    ).run(
      input.vault.user_id,
      input.vault.ciphertext,
      input.vault.nonce,
      input.vault.version,
      input.vault.updated_at,
    )

    if (input.identity) {
      const result = db
        .prepare(
          `UPDATE user_identities
           SET ciphertext = ?, nonce = ?, updated_at = ?
           WHERE user_id = ? AND public_key = ?`,
        )
        .run(
          input.identity.ciphertext,
          input.identity.nonce,
          input.identity.updatedAt,
          input.userId,
          input.identity.publicKey,
        )
      if (Number(result.changes) !== 1) throw new Error('IDENTITY_CHANGED')
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function createSession(tokenHash: string, userId: string, expiresAt: number, now: number): void {
  getDb()
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, expiresAt, now)
}

export function findSession(tokenHash: string): { user_id: string; expires_at: number } | undefined {
  return getDb()
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: string; expires_at: number } | undefined
}

export function deleteSession(tokenHash: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
}

export function deleteExpiredSessions(now: number): void {
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now)
}

/** Fixed-window brute-force guard. Returns true when the caller is locked out. */
export function isRateLimited(bucket: string, now: number): boolean {
  const row = getDb()
    .prepare('SELECT failures, reset_at FROM login_attempts WHERE bucket = ?')
    .get(bucket) as { failures: number; reset_at: number } | undefined
  if (!row) return false
  if (row.reset_at <= now) return false
  return row.failures >= 8
}

export function recordFailure(bucket: string, now: number, windowMs: number): void {
  const row = getDb()
    .prepare('SELECT failures, reset_at FROM login_attempts WHERE bucket = ?')
    .get(bucket) as { failures: number; reset_at: number } | undefined
  if (!row || row.reset_at <= now) {
    getDb()
      .prepare(
        `INSERT INTO login_attempts (bucket, failures, reset_at) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET failures = 1, reset_at = excluded.reset_at`,
      )
      .run(bucket, now + windowMs)
    return
  }
  getDb()
    .prepare('UPDATE login_attempts SET failures = failures + 1 WHERE bucket = ?')
    .run(bucket)
}

export function clearFailures(bucket: string): void {
  getDb().prepare('DELETE FROM login_attempts WHERE bucket = ?').run(bucket)
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

export function getShare(id: string): ShareRow | undefined {
  return getDb().prepare('SELECT * FROM shares WHERE id = ?').get(id) as ShareRow | undefined
}

/** Legacy bearer links remain readable until their original expiry. */
export function deleteExpiredShares(now: number): void {
  getDb().prepare('DELETE FROM shares WHERE expires_at <= ?').run(now)
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

export function createRecipientShare(row: RecipientShareRow): void {
  getDb()
    .prepare(
      `INSERT INTO recipient_shares
        (id, owner_id, recipient_id, entry_id, ciphertext, nonce,
         ephemeral_public_key, wrap_nonce, wrapped_key, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    )
}

export function countActiveRecipientShares(ownerId: string, now: number): number {
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS count FROM recipient_shares WHERE owner_id = ? AND expires_at > ?',
    )
    .get(ownerId, now) as { count: number } | undefined
  return row?.count ?? 0
}

export function countActiveRecipientSharesForEntry(
  ownerId: string,
  entryId: string,
  now: number,
): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM recipient_shares
       WHERE owner_id = ? AND entry_id = ? AND expires_at > ?`,
    )
    .get(ownerId, entryId, now) as { count: number } | undefined
  return row?.count ?? 0
}

export function hasActiveRecipientShare(
  ownerId: string,
  recipientId: string,
  entryId: string,
  now: number,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS found FROM recipient_shares
       WHERE owner_id = ? AND recipient_id = ? AND entry_id = ? AND expires_at > ?
       LIMIT 1`,
    )
    .get(ownerId, recipientId, entryId, now) as { found: number } | undefined
  return Boolean(row)
}

export function listSentRecipientShares(
  ownerId: string,
  entryId: string,
  now: number,
): SentRecipientShareRow[] {
  return getDb()
    .prepare(
      `SELECT rs.id,
              rs.recipient_id AS recipientId,
              recipient.handle AS recipientHandle,
              rs.expires_at AS expiresAt,
              rs.created_at AS createdAt
       FROM recipient_shares rs
       JOIN users recipient ON recipient.id = rs.recipient_id
       WHERE rs.owner_id = ? AND rs.entry_id = ? AND rs.expires_at > ?
       ORDER BY rs.created_at DESC`,
    )
    .all(ownerId, entryId, now) as unknown as SentRecipientShareRow[]
}

export function listReceivedRecipientShares(
  recipientId: string,
  now: number,
): ReceivedRecipientShareRow[] {
  return getDb()
    .prepare(
      `SELECT rs.id,
              rs.entry_id AS entryId,
              owner.handle AS ownerHandle,
              rs.ciphertext,
              rs.nonce,
              rs.ephemeral_public_key AS ephemeralPublicKey,
              rs.wrap_nonce AS wrapNonce,
              rs.wrapped_key AS wrappedKey,
              rs.expires_at AS expiresAt,
              rs.created_at AS createdAt
       FROM recipient_shares rs
       JOIN users owner ON owner.id = rs.owner_id
       WHERE rs.recipient_id = ? AND rs.expires_at > ?
       ORDER BY rs.created_at DESC`,
    )
    .all(recipientId, now) as unknown as ReceivedRecipientShareRow[]
}

export function deleteRecipientShareForOwner(id: string, ownerId: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM recipient_shares WHERE id = ? AND owner_id = ?')
    .run(id, ownerId)
  return Number(result.changes) > 0
}

export function deleteRecipientShareForRecipient(
  id: string,
  recipientId: string,
): boolean {
  const result = getDb()
    .prepare('DELETE FROM recipient_shares WHERE id = ? AND recipient_id = ?')
    .run(id, recipientId)
  return Number(result.changes) > 0
}

export function deleteRecipientSharesForEntry(ownerId: string, entryId: string): number {
  const result = getDb()
    .prepare('DELETE FROM recipient_shares WHERE owner_id = ? AND entry_id = ?')
    .run(ownerId, entryId)
  return Number(result.changes)
}

export function deleteExpiredRecipientShares(now: number): void {
  getDb().prepare('DELETE FROM recipient_shares WHERE expires_at <= ?').run(now)
}

export interface AttachmentRow {
  id: string
  user_id: string
  entry_id: string
  ciphertext: string
  nonce: string
  size: number
  created_at: number
}

export interface AttachmentSummaryRow {
  id: string
  entry_id: string
  size: number
  created_at: number
}

export function createAttachment(row: AttachmentRow): void {
  getDb()
    .prepare(
      `INSERT INTO attachments (id, user_id, entry_id, ciphertext, nonce, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.user_id,
      row.entry_id,
      row.ciphertext,
      row.nonce,
      row.size,
      row.created_at,
    )
}

export function getAttachmentForUser(id: string, userId: string): AttachmentRow | undefined {
  return getDb()
    .prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?')
    .get(id, userId) as AttachmentRow | undefined
}

export function deleteAttachmentForUser(id: string, userId: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?')
    .run(id, userId)
  return Number(result.changes) > 0
}

export function deleteAttachmentsForEntry(userId: string, entryId: string): number {
  const result = getDb()
    .prepare('DELETE FROM attachments WHERE user_id = ? AND entry_id = ?')
    .run(userId, entryId)
  return Number(result.changes)
}

export function countAttachmentsForEntry(userId: string, entryId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM attachments WHERE user_id = ? AND entry_id = ?')
    .get(userId, entryId) as { count: number } | undefined
  return row?.count ?? 0
}

export function countAttachmentsForUser(userId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM attachments WHERE user_id = ?')
    .get(userId) as { count: number } | undefined
  return row?.count ?? 0
}

export function sumAttachmentBytesForUser(userId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(size), 0) AS total FROM attachments WHERE user_id = ?')
    .get(userId) as { total: number } | undefined
  return row?.total ?? 0
}

export function listAttachmentsForUser(userId: string): AttachmentSummaryRow[] {
  return getDb()
    .prepare(
      `SELECT id, entry_id, size, created_at
       FROM attachments
       WHERE user_id = ?
       ORDER BY created_at ASC`,
    )
    .all(userId) as unknown as AttachmentSummaryRow[]
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

export function listPasskeys(userId: string): PasskeyRow[] {
  return getDb()
    .prepare('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as unknown as PasskeyRow[]
}

export function countPasskeys(userId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM passkeys WHERE user_id = ?')
    .get(userId) as { count: number } | undefined
  return row?.count ?? 0
}

export function getPasskeyByCredentialId(credentialId: string): PasskeyRow | undefined {
  return getDb()
    .prepare('SELECT * FROM passkeys WHERE credential_id = ?')
    .get(credentialId) as PasskeyRow | undefined
}

export function createPasskey(row: PasskeyRow): void {
  getDb()
    .prepare(
      `INSERT INTO passkeys
        (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
    )
}

export function updatePasskeyAfterUse(
  id: string,
  counter: number,
  lastUsedAt: number,
  deviceType: string,
  backedUp: boolean,
): void {
  getDb()
    .prepare(
      `UPDATE passkeys
       SET counter = ?, last_used_at = ?, device_type = ?, backed_up = ?
       WHERE id = ?`,
    )
    .run(counter, lastUsedAt, deviceType, backedUp ? 1 : 0, id)
}

export function deletePasskeyForUser(id: string, userId: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM passkeys WHERE id = ? AND user_id = ?')
    .run(id, userId)
  return Number(result.changes) > 0
}

export interface WebAuthnChallengeRow {
  id: string
  user_id: string
  kind: string
  challenge: string
  expires_at: number
}

export function createWebAuthnChallenge(row: WebAuthnChallengeRow): void {
  getDb()
    .prepare(
      'INSERT INTO webauthn_challenges (id, user_id, kind, challenge, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(row.id, row.user_id, row.kind, row.challenge, row.expires_at)
}

/** Single-use challenge: read it, delete it, then verify it. */
export function takeWebAuthnChallenge(id: string, kind: string): WebAuthnChallengeRow | undefined {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM webauthn_challenges WHERE id = ? AND kind = ?')
    .get(id, kind) as WebAuthnChallengeRow | undefined
  if (!row) return undefined
  db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(id)
  if (row.expires_at <= Date.now()) return undefined
  return row
}

export function deleteWebAuthnChallengesForUser(userId: string, kind?: string): void {
  if (kind) {
    getDb()
      .prepare('DELETE FROM webauthn_challenges WHERE user_id = ? AND kind = ?')
      .run(userId, kind)
    return
  }
  getDb().prepare('DELETE FROM webauthn_challenges WHERE user_id = ?').run(userId)
}

export function deleteExpiredWebAuthnChallenges(now: number): void {
  getDb().prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').run(now)
}

export interface PasskeyRecoveryRow {
  user_id: string
  code_hash: string
  created_at: number
}

export function getPasskeyRecovery(userId: string): PasskeyRecoveryRow | undefined {
  return getDb()
    .prepare('SELECT * FROM passkey_recovery WHERE user_id = ?')
    .get(userId) as PasskeyRecoveryRow | undefined
}

export function upsertPasskeyRecovery(userId: string, codeHash: string, now: number): void {
  getDb()
    .prepare(
      `INSERT INTO passkey_recovery (user_id, code_hash, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at`,
    )
    .run(userId, codeHash, now)
}

export function deletePasskeyRecovery(userId: string): void {
  getDb().prepare('DELETE FROM passkey_recovery WHERE user_id = ?').run(userId)
}
