# Rook

A personal, zero-knowledge password manager built to understand how tools like 1Password
actually work. Original code, no copied vault formats or branding. The name and mark are a
chess rook: a quiet, watchful castle for the things that unlock your day.

- **Frontend:** TanStack Start (React 19, file-based router, Vite 8, Tailwind v4, Inter + JetBrains Mono, Lucide icons via `react-icons`)
- **Backend:** Node.js server functions + `node:sqlite` (no native dependencies)
- **Crypto:** Argon2id → HKDF-SHA256 → XChaCha20-Poly1305, all in the browser, with
  separate per-file keys for attachments

---

## 1. The core idea: the server is a dumb encrypted-blob store

Most of the design falls out of one rule: **the master password never leaves the device.**

```
                 browser (trusted)                         server (untrusted)
                 ─────────────────                         ──────────────────

 master password
       │
       │ Argon2id(salt, t=3, m=64 MiB, p=1)
       ▼
   masterKey (32 bytes)
       │
       ├── HKDF-SHA256("keynest/auth/v1")  ──► authKey ──► SHA-256 ──► authHash ──┐
       │                                                                           │
       └── HKDF-SHA256("keynest/vault/v1") ──► vaultKey                            │
                                                   │                               │
                                            XChaCha20-Poly1305                     │
                                                   │                               │
              { entries: [...] } ────────────────►│                               │
                                                   ▼                               ▼
                                            ciphertext + nonce  ──────────►  SQLite rows
                                                                           (auth_hash, ciphertext)
```

Two independent subkeys come out of one expensive KDF:

| Key | Purpose | Who sees it |
| --- | --- | --- |
| `masterKey` | Root secret | Browser memory only, never persisted |
| `authKey` | Proves identity | Hashed to `authHash`, sent over TLS |
| `vaultKey` | Encrypts the vault | Browser memory only |

Why split with HKDF instead of reusing one key? Separation of duties. The value sent to the
server (the auth proof) is derived from a different label than the value that decrypts data,
so a compromised auth path never exposes the encryption key. This is the same "2SKD"
(two-secret key derivation) pattern 1Password documents.

The HKDF labels still read `keynest/*` because they are cryptographic domain separators from
the pre-rename build, not branding. Changing them would derive different keys and make every
existing vault undecryptable. The visible product is Rook; the encrypted wire format stays
compatible.

**What the server stores:** `SHA-256(authHash)` and ciphertext. Even a full database dump
does not let an attacker log in (they would need a preimage of SHA-256) or decrypt anything
(they would need `vaultKey`).

Attachments follow the same rule. Each file is encrypted in the browser with a fresh random
32-byte key, and that key is stored only inside the encrypted vault metadata. The server gets
a separate ciphertext row with a nonce, the plaintext byte count, and the opaque item id. It
never receives the file name, MIME type, file key, or plaintext. The trade-off is that the
server can still see attachment count, approximate size, and which item a blob belongs to.

---

## 2. What is actually stored

```sql
users(id, handle, kdf, auth_hash, created_at)     -- kdf = {algorithm,t,m,p,salt} (public)
vaults(user_id, ciphertext, nonce, version, updated_at)
attachments(id, user_id, entry_id, ciphertext, nonce, size, created_at)
shares(id, user_id, entry_id, ciphertext, nonce, expires_at, created_at)
sessions(token_hash, user_id, expires_at)         -- only SHA-256 of the cookie token
login_attempts(bucket, failures, reset_at)        -- 8 failures / 15 min, per handle
passkeys(id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, aaguid, name, created_at, last_used_at)
webauthn_challenges(id, user_id, kind, challenge, expires_at)  -- single-use, 5-minute TTL
passkey_recovery(user_id, code_hash, created_at)  -- only SHA-256 of the recovery code
```

A share row holds an opaque entry id, ciphertext, a nonce, and timestamps. The 32-byte key
that decrypts it lives only in the recipient URL fragment (`/share/{id}#{key}`), so the server
never receives it. Expired rows are removed lazily on share reads and writes.

An attachment row is ciphertext plus the data needed to enforce storage limits. File names,
types, and per-file keys live inside the encrypted vault; the vault data version is now 5.
Versions 2–4 remain readable and gain an empty attachment list when opened.

Passkey rows hold public keys and counters, never private keys. A recovery code is generated
when the first passkey is added, shown once, and stored only as a SHA-256 hash. It is a
fallback for the passkey second factor; it does not recover or decrypt the vault.

The KDF header (algorithm, cost parameters, salt) is public by necessity — the client needs
it before it can derive anything. But it is **bound into the AEAD as associated data**, so an
attacker who can write to the database cannot silently downgrade `m=65536` to `m=8` or swap
the salt: the Poly1305 tag will not verify.

---

## 3. Threat model

**Protects against**

- Database theft / server compromise after the fact — only ciphertext and hashes exist.
- Network eavesdropping — the auth proof is useless for decryption.
- Stolen session cookie — an attacker gets a session but still cannot decrypt the vault.
- Ciphertext tampering or header downgrade — AEAD tag failure, the vault refuses to open.
- Online password guessing — Argon2id at 64 MiB plus a per-handle rate limit.
- Username enumeration in the unlock flow — unknown handles return a deterministic fake salt,
  so the client performs the same work and the same round trip.
- Password-only account takeover when a passkey is registered — the server will not start a
  session from the master password alone; a passkey or recovery code is also required.
- Passkey private-key theft from the server — only public keys, counters, and a recovery-code
  hash are stored.
- Clipboard snooping — copied secrets are cleared after 30 seconds (best effort).
- Shoulder surfing / unattended laptops — idle auto-lock wipes the in-memory key.
- Server-side share leaks — a share row is ciphertext only; the URL fragment key is never sent
  to the server, and the encrypted payload carries its own expiry.
- Attachment leaks — file bytes are encrypted client-side with random per-file keys; names,
  MIME types, and keys stay inside the encrypted vault, and downloads are verified with AEAD.

**Does not protect against**

- A compromised browser, malicious extension, or XSS in this app (the key is in JS memory).
- A weak master password. Argon2id makes guessing expensive, not impossible.
- **Losing the master password.** There is no recovery, no reset link, no escrow. That is the
  price of zero-knowledge, and it is deliberate.
- **Losing both a registered passkey and its recovery code.** The vault key still needs the
  master password, but the server will not start a session without the second factor. Store
  the recovery code offline.
- **Anyone holding a share link.** It is a bearer link: until it expires or is revoked, anyone
  with the full URL can read the shared password. Send it only over a trusted channel.
- Metadata: the server learns your handle, vault size, save timestamps, version count, the
  opaque entry id and expiry of any active share, and passkey metadata such as credential ids,
  device type, and last-used timestamps. For attachments it also learns the opaque item id,
  attachment count, plaintext byte size, and creation time.
- **Attachment loss in a backup restore.** Encrypted backups include attachment metadata but
  not file bytes. Keep important files separately; on import, references survive only when the
  encrypted blob still exists for that account.

---

## 4. Features

Vault

- Item types: login, secure note, card, identity
- Create, edit, move to trash, restore, favorite, tags
- Item history: the previous 20 versions stay encrypted, and any version can be restored
- Encrypted file attachments on any item: add, download, and remove files without exposing
  their bytes, names, or keys to the server
- Trash: deleted items can be restored or permanently removed with their history and files
- Permanent-delete tombstones: a deletion survives conflict merges, so a stale vault copy
  cannot silently resurrect the item
- Full-text search across title, username, URL, notes, tags, and attachment names
- Filters by type, favorites, and trash
- Live TOTP codes (RFC 6238, SHA-1/6 digits/30 s) with expiry progress
- Copy buttons everywhere; password masking with explicit reveal

Sharing

- Create a password share link from a login; the recipient does not need a Rook account
- Links expire after three days, enforced by the server and by the encrypted payload
- The share key travels in the URL fragment, so the server only stores ciphertext
- Active links can be listed and revoked; the link key is not stored, so copy it when created
- Share links contain only the password. Attachments are never included; the share dialog
  warns when the item has files.

Attachments

- Up to 10 MB per file, 20 files per item, 200 files and 100 MB total per account
- Each file gets a random 32-byte key, wrapped inside the encrypted vault metadata
- The server stores only ciphertext, a nonce, byte size, and opaque item id
- Downloading decrypts in the browser and verifies the bound id, item, name, size, and type
- Removing an attachment deletes the server blob; permanently deleting an item cleans up all
  of its blobs
- Encrypted backups keep attachment metadata but not file bytes

Security

- Argon2id (64 MiB, t=3, p=1) with a per-account random salt
- XChaCha20-Poly1305, fresh 24-byte nonce on every save
- KDF header authenticated as AEAD associated data
- Share links: XChaCha20-Poly1305 with a random 32-byte key in the URL fragment, share id
  bound as AAD, and a 3-day expiry
- Attachments: XChaCha20-Poly1305 with a random per-file key; attachment id, item id, name,
  size, and MIME type bound as AAD
- Master password rotation (fresh salt, re-key, re-encrypt, single atomic server update;
  attachment file keys are re-wrapped, file blobs are not re-encrypted)
- WebAuthn passkey second factor for Rook's own sign-in, required once a passkey is registered
- One-time recovery code for the passkey second factor, shown once and stored only as a hash
- Idle auto-lock (1/5/15/30/60 min), in-memory key wiping
- httpOnly session cookie; only its SHA-256 is stored
- Login rate limiting and deterministic fake salts for unknown handles

Passkeys are a second factor for the Rook server session, not a vault-unlock method. The master
password still derives the vault key in the browser. Rook cannot act as a passkey provider for
other websites without a browser extension, which remains out of scope.

Audit

- Weak passwords (entropy estimate with pattern penalties)
- Reused passwords
- Stale passwords (older than a year)
- Logins without 2FA
- Have I Been Pwned check via k-anonymity (only a 5-char SHA-1 prefix leaves the browser)

Data

- Password generator (length, character classes, ambiguous-character filter, entropy readout)
- Encrypted backup export (needs the master password; new backups use the `rook.vault`
  format, and pre-rename `keynest.vault` backups still import; attachment metadata is included
  but file bytes are not)
- CSV export for portability (with an explicit plaintext warning)
- Encrypted backup import, merged by item id, including trash and version history; attachment
  references are kept only when the encrypted file blob still exists for the account
- Import from Chrome CSV, 1Password CSV, Bitwarden JSON/CSV, and Rook CSV; parsed locally,
  with duplicate detection and a preview before anything is saved
- Optimistic concurrency: the server rejects a save based on a stale version (`CONFLICT`)
- Conflict recovery: merge items from both versions, keep this tab's version, or load the
  server version without discarding the tab's encrypted state until the choice is made

Interface

- Three-pane shell (navigation rail, item list, detail) that becomes a drawer and a list/detail
  swap on small screens
- Light and dark themes restored before paint; one action blue, hairline borders, no decoration
- Inter for the interface, JetBrains Mono for secrets and codes; Lucide icons, never emoji
- The Rook mark is a solid chess rook, used monochrome at 15–21px; it is the one non-Lucide
  mark, reserved for the product identity
- Keyboard: `Cmd/Ctrl+K` search, `Cmd/Ctrl+L` lock, `Cmd/Ctrl+Enter` save

---

## 5. Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

Production:

```bash
npm run build
node .output/server/index.mjs    # PORT=3001 to change
```

The SQLite file lives at `data/rook.db` (override with `ROOK_DATA_DIR`; the legacy
`KEYNEST_DATA_DIR` is still honored). Create an account on first launch — the vault starts
empty and unlocks immediately.

### Tests

```bash
npm test           # crypto, vault, attachments, conflict merge, tombstones, sharing, generator, strength, TOTP, import, and passkey helpers
npm run typecheck
npm run test:e2e   # build, start a disposable server, and run every Playwright flow
```

The Playwright suite lives in `e2e/` and runs in CI. It covers register → save → reload
locks → wrong password rejected → correct password decrypts → generator, import and
duplicate detection, history/trash, sharing (including long and password-only items,
revocation, expiry, and mobile), encrypted attachments (ciphertext-only storage, download,
reload persistence, removal, blob cleanup, and the share warning), two-tab conflict
merge/keep/use-server, and a WebAuthn passkey flow using Chromium's virtual authenticator.
The passkey flow runs on `localhost` because WebAuthn RP IDs must be domain names; the rest of
the suite stays on `127.0.0.1`.
See `e2e/README.md` for running individual flows against an existing server.

Passkeys require a secure context: HTTPS in production, or `localhost` during development.
They are bound to the origin, so a passkey registered at `localhost:3000` will not work at
`127.0.0.1:3000`. Behind a proxy, set `ROOK_WEBAUTHN_ORIGIN` and `ROOK_WEBAUTHN_RP_ID`
together to the public origin and RP ID.

---

## 6. Code map

```
src/lib/crypto.ts          Argon2id, HKDF split, auth proof, AEAD helpers
src/lib/vault.ts           entry schema (zod), seal/open, header AAD, history/trash/tombstones, conflict merge, search/sort
src/lib/attachments.ts     attachment schema, limits, AAD, per-file keys, binary seal/open
src/lib/vault-context.tsx  unlock/register/save/conflict/re-key state machine, auto-lock, attachment flows, exports
src/lib/share.ts           share payload schema, URL-fragment key encoding, seal/open
src/lib/import.ts          Chrome/1Password/Bitwarden/Rook parsers and duplicate fingerprints
src/lib/generator.ts       unbiased CSPRNG password generation + entropy
src/lib/strength.ts        entropy estimator with sequence/repeat/common penalties
src/lib/totp.ts            base32 + RFC 6238 via WebCrypto
src/lib/passkeys.ts        passkey metadata type and recovery-code formatting
src/server/api.ts          server functions (register, login, kdf, pull/push, rotate, share, attachments, passkeys)
src/server/db.server.ts    node:sqlite schema and queries
src/server/webauthn.server.ts  WebAuthn ceremonies, RP/origin handling, recovery codes
src/server/session.server.ts  cookie sessions, constant-time compare
src/components/            lock screen, vault shell, editor, generator, audit, settings, share
src/routes/__root.tsx      document shell; VaultProvider lives above the router
src/routes/share.$shareId.tsx  public recipient page for an expiring share link
```

### Notes from building it

- `@noble/hashes` v2 requires `info` to be a `Uint8Array` in HKDF — a string silently fails.
- Tailwind v4 cannot `@apply` a custom component class; share a selector list instead.
- The vault provider is mounted in the root shell, **not** inside the route. A route-level
  provider is remounted by router invalidation and would drop the in-memory key mid-session.
- Saves are immediate and serialized, not debounced. A debounce window is a data-loss window
  if the tab closes, and every mutation is already an explicit user action.
- WebAuthn is origin-bound. The server derives the RP ID and expected origin from the request,
  with `ROOK_WEBAUTHN_ORIGIN` / `ROOK_WEBAUTHN_RP_ID` overrides for proxies. `localhost` is a
  valid RP ID; `127.0.0.1` is not.
- A passkey prompt needs a user gesture, so the master-password step holds the derived key in
  memory and waits for an explicit "Use passkey" click instead of prompting automatically.
- Attachments are separate blobs, not part of the vault save. Upload the encrypted file first,
  then commit its metadata to the vault; remove metadata first, then delete the blob. The
  ordering makes an interrupted operation leave an unreachable blob, never a live reference to
  missing bytes.
- Attachment metadata is not versioned with the item. Restoring an old credential version keeps
  the current file list, so history can never point at a blob the user already removed.

---

## 7. Roadmap toward "80% of 1Password"

Done: the vault, the crypto, the item types, TOTP, audit, generator, backups, rotation,
item history, trash, permanent-delete tombstones, conflict recovery, encrypted attachments,
expiring password-share links, import from Chrome, 1Password, Bitwarden, and Rook CSV, and a
WebAuthn passkey second factor for Rook's own sign-in with a one-time recovery code.

Next, roughly in order of value:

1. **Recipient-bound sharing** — replace bearer links with public-key envelopes per recipient,
   so a forwarded link cannot be opened by anyone else and access can be revoked per person.
2. **Email breach monitoring** — periodic HIBP checks for account addresses.
3. **Attachment-aware backups** — optionally include encrypted blobs in a backup archive, with
   an explicit size cost and the same zero-knowledge guarantees.

Passkeys here authenticate Rook's server session; they do not store credentials for, or act as
an authenticator for, other websites. That requires a browser extension and remains out of
scope, along with autofill. Also out of scope for this personal build: team administration,
SSO/SCIM, travel mode, and a hosted service.

---

Personal project, for learning. Not audited. Do not use it as your only copy of anything
you cannot afford to lose.
