/**
 * Portable schema for the local SQLite database and production PostgreSQL.
 *
 * SQLite treats BIGINT with INTEGER affinity, so the same DDL works for both
 * engines. PostgreSQL-specific migrations are handled in sql.server.ts.
 */
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    handle     TEXT NOT NULL UNIQUE,
    kdf        TEXT NOT NULL,
    auth_hash  TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vaults (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    nonce      TEXT NOT NULL,
    version    INTEGER NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    bucket     TEXT PRIMARY KEY,
    failures   INTEGER NOT NULL DEFAULT 0,
    reset_at   BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS server_secrets (
    name  TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shares (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entry_id   TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce      TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_identities (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce      TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
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
    created_at           BIGINT NOT NULL,
    expires_at           BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS passkeys (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key    TEXT NOT NULL,
    counter       BIGINT NOT NULL DEFAULT 0,
    transports    TEXT NOT NULL DEFAULT '[]',
    device_type   TEXT NOT NULL DEFAULT 'singleDevice',
    backed_up     INTEGER NOT NULL DEFAULT 0,
    aaguid        TEXT NOT NULL DEFAULT '',
    name          TEXT NOT NULL,
    created_at    BIGINT NOT NULL,
    last_used_at  BIGINT
  );

  CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    challenge  TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS passkey_recovery (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
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
`
