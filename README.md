# Rook

A personal, zero-knowledge password manager built to understand how tools like 1Password
actually work. Original code, no copied vault formats or branding. The name and mark are a
chess rook: a quiet, watchful castle for the things that unlock your day.

- **Frontend:** TanStack Start (React 19, file-based router, Vite 8, Tailwind v4, Inter + JetBrains Mono, Lucide icons via `react-icons`)
- **Backend:** Node.js server functions + `node:sqlite` (no native dependencies)
- **Crypto:** Argon2id → HKDF-SHA256 → XChaCha20-Poly1305, all in the browser

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

---

## 2. What is actually stored

```sql
users(id, handle, kdf, auth_hash, created_at)     -- kdf = {algorithm,t,m,p,salt} (public)
vaults(user_id, ciphertext, nonce, version, updated_at)
shares(id, user_id, entry_id, ciphertext, nonce, expires_at, created_at)
sessions(token_hash, user_id, expires_at)         -- only SHA-256 of the cookie token
login_attempts(bucket, failures, reset_at)        -- 8 failures / 15 min, per handle
```

A share row holds an opaque entry id, ciphertext, a nonce, and timestamps. The 32-byte key
that decrypts it lives only in the recipient URL fragment (`/share/{id}#{key}`), so the server
never receives it. Expired rows are removed lazily on share reads and writes.

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
- Clipboard snooping — copied secrets are cleared after 30 seconds (best effort).
- Shoulder surfing / unattended laptops — idle auto-lock wipes the in-memory key.
- Server-side share leaks — a share row is ciphertext only; the URL fragment key is never sent
  to the server, and the encrypted payload carries its own expiry.

**Does not protect against**

- A compromised browser, malicious extension, or XSS in this app (the key is in JS memory).
- A weak master password. Argon2id makes guessing expensive, not impossible.
- **Losing the master password.** There is no recovery, no reset link, no escrow. That is the
  price of zero-knowledge, and it is deliberate.
- **Anyone holding a share link.** It is a bearer link: until it expires or is revoked, anyone
  with the full URL can read the shared password. Send it only over a trusted channel.
- Metadata: the server learns your handle, vault size, save timestamps, version count, and the
  opaque entry id and expiry of any active share.

---

## 4. Features

Vault

- Item types: login, secure note, card, identity
- Create, edit, move to trash, restore, favorite, tags
- Item history: the previous 20 versions stay encrypted, and any version can be restored
- Trash: deleted items can be restored or permanently removed with their history
- Permanent-delete tombstones: a deletion survives conflict merges, so a stale vault copy
  cannot silently resurrect the item
- Full-text search across title, username, URL, notes, tags
- Filters by type, favorites, and trash
- Live TOTP codes (RFC 6238, SHA-1/6 digits/30 s) with expiry progress
- Copy buttons everywhere; password masking with explicit reveal

Sharing

- Create a password share link from a login; the recipient does not need a Rook account
- Links expire after three days, enforced by the server and by the encrypted payload
- The share key travels in the URL fragment, so the server only stores ciphertext
- Active links can be listed and revoked; the link key is not stored, so copy it when created

Security

- Argon2id (64 MiB, t=3, p=1) with a per-account random salt
- XChaCha20-Poly1305, fresh 24-byte nonce on every save
- KDF header authenticated as AEAD associated data
- Share links: XChaCha20-Poly1305 with a random 32-byte key in the URL fragment, share id
  bound as AAD, and a 3-day expiry
- Master password rotation (fresh salt, re-key, re-encrypt, single atomic server update)
- Idle auto-lock (1/5/15/30/60 min), in-memory key wiping
- httpOnly session cookie; only its SHA-256 is stored
- Login rate limiting and deterministic fake salts for unknown handles

Audit

- Weak passwords (entropy estimate with pattern penalties)
- Reused passwords
- Stale passwords (older than a year)
- Logins without 2FA
- Have I Been Pwned check via k-anonymity (only a 5-char SHA-1 prefix leaves the browser)

Data

- Password generator (length, character classes, ambiguous-character filter, entropy readout)
- Encrypted backup export (self-contained, needs the master password; new backups use the
  `rook.vault` format, and pre-rename `keynest.vault` backups still import)
- CSV export for portability (with an explicit plaintext warning)
- Encrypted backup import, merged by item id, including trash and version history
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
npm test           # crypto, vault, conflict merge, tombstones, sharing, generator, strength, TOTP, and import parsers
npm run typecheck
npm run test:e2e   # build, start a disposable server, and run every Playwright flow
```

The Playwright suite lives in `e2e/` and runs in CI. It covers register → save → reload
locks → wrong password rejected → correct password decrypts → generator, import and
duplicate detection, history/trash, sharing (including long and password-only items,
revocation, expiry, and mobile), and two-tab conflict merge/keep/use-server. See
`e2e/README.md` for running individual flows against an existing server.

---

## 6. Code map

```
src/lib/crypto.ts          Argon2id, HKDF split, auth proof, AEAD helpers
src/lib/vault.ts           entry schema (zod), seal/open, header AAD, history/trash/tombstones, conflict merge, search/sort
src/lib/vault-context.tsx  unlock/register/save/conflict/re-key state machine, auto-lock, exports
src/lib/share.ts           share payload schema, URL-fragment key encoding, seal/open
src/lib/import.ts          Chrome/1Password/Bitwarden/Rook parsers and duplicate fingerprints
src/lib/generator.ts       unbiased CSPRNG password generation + entropy
src/lib/strength.ts        entropy estimator with sequence/repeat/common penalties
src/lib/totp.ts            base32 + RFC 6238 via WebCrypto
src/server/api.ts          server functions (register, login, kdf, pull/push, rotate, share)
src/server/db.server.ts    node:sqlite schema and queries
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

---

## 7. Roadmap toward "80% of 1Password"

Done: the vault, the crypto, the item types, TOTP, audit, generator, backups, rotation,
item history, trash, permanent-delete tombstones, conflict recovery, expiring password-share
links, and import from Chrome, 1Password, Bitwarden, and Rook CSV.

Next, roughly in order of value:

1. **Passkeys / WebAuthn** — store credentials and act as an authenticator.
2. **Attachments** — encrypt file blobs separately, same key hierarchy.
3. **Recipient-bound sharing** — replace bearer links with public-key envelopes per recipient,
   so a forwarded link cannot be opened by anyone else and access can be revoked per person.
4. **Email breach monitoring** — periodic HIBP checks for account addresses.

Deliberately out of scope for now: a browser extension and autofill. Also out of scope for
this personal build: team administration, SSO/SCIM, travel mode, and a hosted service.

---

Personal project, for learning. Not audited. Do not use it as your only copy of anything
you cannot afford to lose.
