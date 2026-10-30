# Rook

Rook is a zero-knowledge password manager. The master password never leaves the browser. The server stores ciphertext, public keys, and hashes.

The name and mark are a chess rook: a quiet castle for the things that unlock your day.

Rook has not been independently audited. Keep another copy of anything you cannot afford to lose. There is no way to recover a forgotten master password.

## Stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript |
| UI | React 19, TanStack Router, TanStack Start |
| Build | Vite 8, Nitro |
| Styling | Tailwind CSS v4 |
| Type | Inter (interface), JetBrains Mono (secrets and codes) |
| Icons | `react-icons` |
| Validation | Zod |
| Crypto | `@noble/hashes` (Argon2id, HKDF-SHA256, SHA-256), `@noble/ciphers` (XChaCha20-Poly1305), WebCrypto (TOTP, P-256) |
| Sign-in | Master password in the browser, httpOnly session cookie, optional WebAuthn (`@simplewebauthn`) |
| Local database | SQLite through `node:sqlite` |
| Production database | PostgreSQL through `pg`, hosted on Supabase |
| App hosting | Vercel (Nitro `vercel` preset) |
| Landing page | Static HTML, CSS, and JS on GitHub Pages |
| Tests | Node.js test runner via `tsx`, Playwright |

Supabase is the PostgreSQL host. Rook does not use Supabase Auth, because the master password must never be sent to the server.

## Features

**Vault**

- Logins, secure notes, cards, and identities
- Create, edit, favorite, tag, search, and sort
- The last 20 versions of an item, trash, restore, and permanent delete
- Permanent-delete tombstones, so a stale copy cannot resurrect a deleted item
- Save conflicts: merge both versions, keep this tab, or load the server version
- Authenticator codes (RFC 6238) generated in the browser
- Password generator and a strength estimate
- Audit for weak, reused, and stale passwords, and logins without a second factor
- Optional Have I Been Pwned check using k-anonymity (a 5-character SHA-1 prefix leaves the browser)

**Sharing**

- Share a login with another Rook account by handle
- The share key is wrapped to the recipient’s P-256 public key in the owner’s browser
- Shares expire after three days
- The recipient can read the item. It is not copied into their vault
- Owners can revoke one recipient. Recipients can remove a share from their inbox
- Older link-style shares stay readable until they expire. New links are not created

**Account**

- Argon2id (64 MiB, 3 iterations, parallelism 1) and a per-account salt
- Master-password rotation re-wraps the vault and the sharing identity in one update
- Optional passkey as a second factor for the Rook session, with a one-time recovery code
- The passkey does not unlock the vault and is not a passkey for other websites
- Idle auto-lock, and copied secrets cleared from the clipboard after 30 seconds
- Encrypted backup export and import
- CSV export, with a plaintext warning
- Import from Chrome CSV, 1Password CSV, Bitwarden JSON or CSV, and Rook CSV, with a preview and duplicate detection

**Interface**

- Three panes on a wide screen: navigation, item list, and detail
- A drawer and a list/detail swap on a narrow screen
- Light and dark themes
- `Cmd/Ctrl+K` search, `Cmd/Ctrl+L` lock, `Cmd/Ctrl+Enter` save

## How encryption works

```
browser                                              server
──────                                               ──────

master password
      │
      │ Argon2id(salt, t=3, m=64 MiB, p=1)
      ▼
  masterKey
      │
      ├── HKDF-SHA256("keynest/auth/v1")  ──► authKey ──► SHA-256 ──► auth hash
      │
      └── HKDF-SHA256("keynest/vault/v1") ──► vaultKey
                                                  │
                                           XChaCha20-Poly1305
                                                  │
                                           ciphertext + nonce  ──►  database
```

| Key | Role | Where it lives |
| --- | --- | --- |
| `masterKey` | Root secret | Browser memory. It is never stored. |
| `authKey` | Proves who you are | Hashed again before it is sent. The database stores that hash. |
| `vaultKey` | Encrypts the vault | Browser memory only. |

The two HKDF info strings are domain separators. They are part of key derivation. Changing them produces different keys and makes existing vaults impossible to open.

The server stores `SHA-256(authHash)` and ciphertext. A database copy is not enough to sign in or to decrypt a vault. The KDF parameters and salt are public, and they are bound into the ciphertext as associated data, so a modified header fails to open.

Each account also has a P-256 identity. The public key is stored in the clear so other people can share with that account. The private key is encrypted with the vault key before it is saved.

## What the database holds

```sql
users(id, handle, kdf, auth_hash, created_at)
vaults(user_id, ciphertext, nonce, version, updated_at)
sessions(token_hash, user_id, expires_at, created_at)
login_attempts(bucket, failures, reset_at)
shares(id, user_id, entry_id, ciphertext, nonce, expires_at, created_at)
user_identities(user_id, public_key, ciphertext, nonce, created_at, updated_at)
recipient_shares(id, owner_id, recipient_id, entry_id, ciphertext, nonce,
                 ephemeral_public_key, wrap_nonce, wrapped_key, created_at, expires_at)
passkeys(id, user_id, credential_id, public_key, counter, transports, device_type,
         backed_up, aaguid, name, created_at, last_used_at)
webauthn_challenges(id, user_id, kind, challenge, expires_at)
passkey_recovery(user_id, code_hash, created_at)
```

`shares` is the older link-style table. `recipient_shares` is the current share. Session rows store a hash of the cookie, not the cookie itself. Passkey rows store public keys. The recovery code is stored as a SHA-256 hash.

The current vault format is version 6. Versions 2 through 5 still open and are rewritten on the next save.

## Threat model

Rook is built so that a stolen database, a stolen session cookie, or a tampered ciphertext does not reveal the vault. Online guessing is slowed by Argon2id and by a limit of 8 failures per handle per 15 minutes. Unknown handles receive a deterministic fake salt, so the unlock request looks the same.

Rook does not protect a compromised browser, a malicious extension, or a weak master password. A lost master password cannot be reset. If a passkey is registered, losing both that passkey and its recovery code blocks sign-in even when the master password is known. A recipient who already copied a shared password still has it after the share is revoked.

The server is the directory of recipient public keys. A server that substitutes a key could receive a share meant for someone else. A database-only attacker still cannot read the share.

The server can see your handle, vault size, save times, share expiry, who shared with whom, public keys, and passkey metadata such as device type and last use.

## Develop

Requires Node.js 24.

```bash
npm install
npm run dev        # http://localhost:3000
```

With no `ROOK_DATABASE_URL`, Rook uses SQLite at `data/rook.db`. Override the directory with `ROOK_DATA_DIR`.

```bash
npm test           # crypto, vault, sharing, import, TOTP, passkeys
npm run typecheck
npm run test:e2e   # production build plus the Playwright flows
```

End-to-end tests cover registration, unlock, import, history and trash, sharing, conflicts, and a passkey flow that uses Chromium’s virtual authenticator. See `e2e/README.md` for running one flow against a server that is already up.

Passkeys need `localhost` or HTTPS. A passkey registered at `localhost:3000` does not work at `127.0.0.1:3000`.

## Deploy

The app runs on Vercel. Supabase provides PostgreSQL. The schema is created on the first request. Use the transaction-pooler connection string (port `6543`).

```env
ROOK_DATABASE_URL=postgresql://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:6543/postgres?sslmode=require
ROOK_DATABASE_SSL=true
ROOK_DATABASE_SSL_REJECT_UNAUTHORIZED=true
ROOK_DATABASE_SSL_CA=certs/supabase-root-2021.crt
ROOK_DATABASE_POOL_MAX=3
ROOK_DATABASE_CONNECT_TIMEOUT_MS=15000
ROOK_WEBAUTHN_ORIGIN=https://your-project.vercel.app
ROOK_WEBAUTHN_RP_ID=your-project.vercel.app
```

Keep `ROOK_DATABASE_URL` on the server. Do not expose it as a `VITE_` variable. If the certificate file is missing at runtime, the server uses the copy bundled in `src/server/supabase-ca.ts`.

Set both WebAuthn variables to the final origin before anyone registers a passkey. On a public host the server rejects passkey ceremonies until both are set, so a forwarded `Host` header cannot choose the passkey domain.

On Vercel, the first account can be created and further registration then stays closed. Set `ROOK_ALLOW_REGISTRATION=true` only if this server should keep accepting new vaults. Set it to `false` to close registration before that first account.

`npm run build` is the Vercel build. Vercel sets `VERCEL=1`, which selects the Nitro `vercel` preset. Local builds use the `node-server` preset so `npm start` can run `.output/server/index.mjs`.

The landing page in `landing/` is deployed by `.github/workflows/pages.yml`. Set the repository variable `ROOK_APP_URL` to the Vercel app URL. The workflow writes that URL into the launch button. GitHub Pages does not run the app.

## Project layout

```
src/lib/crypto.ts              Argon2id, HKDF split, auth proof, AEAD
src/lib/vault.ts               Item schema, seal and open, history, trash, merge, search
src/lib/vault-context.tsx      Unlock, save, conflict, re-key, and auto-lock
src/lib/share.ts               Share payload and older link-style shares
src/lib/recipient-share.ts     P-256 identity and recipient envelopes
src/lib/import.ts              Chrome, 1Password, Bitwarden, and Rook parsers
src/lib/generator.ts           Password generator
src/lib/strength.ts            Strength estimate
src/lib/totp.ts                RFC 6238 codes
src/lib/passkeys.ts            Passkey metadata and recovery-code formatting
src/lib/webauthn-origin.ts     Origin and relying-party id for proxies
src/server/api.ts              Register, login, vault sync, sharing, passkeys
src/server/schema.ts           SQLite and PostgreSQL schema
src/server/sql.server.ts       Shared SQL API and both drivers
src/server/db.server.ts        Users, vaults, sessions, shares, passkeys
src/server/webauthn.server.ts  WebAuthn ceremonies and recovery codes
src/server/session.server.ts   Cookie sessions
src/components/                Lock screen, vault, editor, audit, settings, sharing
src/routes/                    App shell and the older public share page
landing/                       GitHub Pages landing page
certs/                         Supabase pooler root certificate
e2e/                           Playwright flows
```

The vault provider is mounted in the root shell. A provider inside a route is remounted when the router invalidates, which would drop the in-memory key. Saves run immediately and one at a time. A delayed save is a lost save if the tab closes.

## Contributing

Open an issue or a pull request.

1. Fork the repository and create a branch.
2. Keep secrets in the browser. The server may store ciphertext, public keys, salts, and hashes. It must not receive a master password, vault key, share key, or passkey private key.
3. Add or update a test for behavior you change. Run `npm run typecheck` and `npm test`. Run `npm run test:e2e` when the change touches a flow the browser suite covers.
4. Match the existing UI: Inter for the interface, JetBrains Mono for secrets, icons from `react-icons`, and one action blue.
5. Describe the behavior in the pull request, including how you tested it.

Useful places to work:

- Verify a recipient’s public key outside the server, so a substituted key is visible
- Email breach monitoring for addresses already stored in the vault
- Health checks, migration visibility, and a written restore drill for a deployed database

Browser extension, autofill, teams, and single sign-on are outside this repository. A passkey in Rook authenticates the Rook session only.
