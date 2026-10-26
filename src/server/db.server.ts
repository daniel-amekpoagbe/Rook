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
    CREATE INDEX IF NOT EXISTS idx_shares_user_entry ON shares(user_id, entry_id);
    CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares(expires_at);
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

export interface ShareSummaryRow {
  id: string
  expiresAt: number
  createdAt: number
}

export function createShare(row: ShareRow): void {
  getDb()
    .prepare(
      `INSERT INTO shares (id, user_id, entry_id, ciphertext, nonce, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.user_id,
      row.entry_id,
      row.ciphertext,
      row.nonce,
      row.expires_at,
      row.created_at,
    )
}

export function getShare(id: string): ShareRow | undefined {
  return getDb().prepare('SELECT * FROM shares WHERE id = ?').get(id) as ShareRow | undefined
}

export function countActiveShares(userId: string, now: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM shares WHERE user_id = ? AND expires_at > ?')
    .get(userId, now) as { count: number } | undefined
  return row?.count ?? 0
}

export function listShares(userId: string, entryId: string, now: number): ShareSummaryRow[] {
  return getDb()
    .prepare(
      `SELECT id, expires_at AS expiresAt, created_at AS createdAt
       FROM shares
       WHERE user_id = ? AND entry_id = ? AND expires_at > ?
       ORDER BY created_at DESC`,
    )
    .all(userId, entryId, now) as unknown as ShareSummaryRow[]
}

export function deleteShareForUser(id: string, userId: string): void {
  getDb().prepare('DELETE FROM shares WHERE id = ? AND user_id = ?').run(id, userId)
}

export function deleteExpiredShares(now: number): void {
  getDb().prepare('DELETE FROM shares WHERE expires_at <= ?').run(now)
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
