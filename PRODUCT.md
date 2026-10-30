# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the project owner, a developer who is building this to understand how password managers work and wants to use it as a real daily vault on their own machine. Desktop browser first; the same surface has to survive a narrow window and a phone-sized viewport. Occasionally shares a login with another Rook account; that recipient uses their own vault and identity.

## Product Purpose

A zero-knowledge personal password manager. It stores logins, secure notes, cards, and identities, generates strong passwords, produces TOTP codes, and audits the vault for weak, reused, old, or unprotected credentials. Success means the owner reaches for it instead of a notes file: unlock fast, find an item in seconds, copy or download, lock, move on.

## Positioning

The master password is stretched with Argon2id in the browser, split with HKDF into an auth key and a vault key, and the server holds only opaque ciphertext, public keys, and a hash of a hash. Recipient-bound sharing uses P-256 ECDH envelopes, so the server never receives a share key or a recipient private key. No master-password recovery path exists by design. An optional WebAuthn passkey can add a second factor to Rook's own sign-in; its one-time recovery code can bypass that factor, never the vault key.

## Operating Context

- A browser tab on a personal machine, usually open beside the site being logged into.
- Short, repeated sessions: unlock, search, copy a password or TOTP code, lock.
- Occasional longer sessions for adding items, rotating passwords, running the audit, and sharing a login with another Rook account.
- Node server with SQLite locally and Supabase PostgreSQL in production on Vercel; the vault is decrypted only in memory and locks on reload.
- Keyboard use is normal: `Cmd/Ctrl+K` for search, `Cmd/Ctrl+L` to lock.

## Capabilities and Constraints

- Entry types: login, secure note, card, identity. Favorites, tags, search, sorting.
- Item history (last 20 versions) and trash, both encrypted with the vault; restore a version, restore a deleted item, or remove it permanently.
- Permanent-delete tombstones: a deletion survives conflict merges, so a stale tab or stale vault copy cannot silently resurrect the item. Permanent deletion also revokes the item's recipient shares best-effort.
- Save conflicts are explicit: merge items from both versions, keep this tab's version, or load the server version. Local edits stay encrypted and in memory until the choice is made.
- Share a login's title, username, password, and website with a link. No recipient name is required. The browser seals the payload with a random 32-byte key that stays in the URL fragment; the server stores only ciphertext. Anyone with the full link can view and copy the login. They cannot edit it or save it into a vault from the share. Links expire after three days, and the owner can revoke each one from the item or from Shared by me. Limits: 50 active links per owner, 20 per item.
- Account identity: P-256 ECDH. The PKCS8 private key is sealed under the vault key and stored server-side only as ciphertext; the public key is a server-visible directory entry. Master-password rotation re-wraps the private key atomically with the vault and auth verifier.
- A share link is read-only. It shows the login and copy controls, and it does not grant edit access to the vault item.
- Client-side Argon2id (64 MiB, t=3, p=1), HKDF-SHA256 key split, XChaCha20-Poly1305 vault encryption with the KDF header bound as AAD.
- Vault data version 6 is current. Older versions 2–5 open and migrate; version 5 attachment metadata is discarded on read.
- Optional WebAuthn passkey second factor for Rook's own sign-in. Once a passkey is registered, the master password alone cannot start a session. Adding the first passkey shows a recovery code once; removing the last passkey turns the factor off and discards the code.
- Passkeys require HTTPS or `localhost` and are bound to their origin. The passkey authenticates the server session only; the master password still derives the vault key. Rook is not a passkey provider for other websites; that needs a browser extension and is out of scope.
- Session cookie holds a random token; the database stores only its SHA-256. Eight failed attempts per fifteen minutes.
- Password generator, entropy estimate, an authenticator view with RFC 6238 TOTP codes (SHA-1/256/512, 6 or 8 digits), audit with optional HIBP range check. TOTP secrets stay in the encrypted vault and codes are generated in the browser.
- Local import from Chrome CSV, 1Password CSV, Bitwarden JSON/CSV, and Rook CSV, with a preview and duplicate detection.
- Encrypted backups contain the full vault, including item history and trash. CSV export is plaintext and carries an explicit warning.
- Single vault per account. No master-password recovery; a passkey recovery code only bypasses the passkey second factor. No real-time multi-device sync; concurrent saves reconcile through explicit conflict choices. Handles may be email addresses.
- TanStack Start + React 19 + Vite + Tailwind v4 on the client; Node server functions with `node:sqlite` locally and Supabase PostgreSQL in production, deployed on Vercel.
- Iconography must come from `react-icons` (owner directive). No emoji standing in for icons.

## Brand Commitments

- Name: Rook.
- The mark is a solid chess rook in three rounded pieces: crown, neck, base. A rook is a
  castle and a watchful corvid; the brand should feel quiet, guarded, and precise rather than
  playful or aggressive.
- The name, mark, and vault format are Rook's own.
- The product speaks plainly about security. It never implies a recovery path it does not have: the vault key has no recovery, and a passkey recovery code only bypasses the passkey second factor.

## Evidence on Hand

- Working application at `src/`, with passing unit tests (including the import parsers, history, trash, recipient-share envelopes, and passkey helpers) and Playwright end-to-end flows.
- A passkey end-to-end flow exercises registration, required second-factor unlock, recovery-code unlock, and removing the last passkey using Chromium's virtual authenticator.
- The vault end-to-end flow creates an authenticator-backed login, renders a live code in the detail view and Authenticator dialog, and verifies the plaintext TOTP secret never appears in the DOM or captured request bodies.
- A two-account sharing flow verifies ciphertext-only `recipient_shares`, recipient inbox decryption, per-recipient revocation, expiry cleanup, master-password rotation, and legacy-link read compatibility. Long, password-only, and mobile layouts are covered separately.
- `README.md` documents the architecture, sharing key hierarchy, limits, passkey scope, Vercel/Supabase deployment, and threat model.
- No real user data, testimonials, benchmarks, or press. Any demo entries are synthetic.

## Product Principles

1. Vault and share keys never leave the tab. The server is untrusted for confidentiality, but it is the sharing key directory, so an actively malicious server can substitute a recipient public key.
2. Retrieval speed beats feature breadth.
3. Every state explains itself: locked, deriving, saving, conflict, error.
4. Plain language over security theater; no false assurances.
5. Calm, precise surfaces. The vault is a tool, not a performance.

## Accessibility & Inclusion

Keyboard-first operation with visible focus. Body text meets WCAG AA contrast. Controls carry accessible names. Motion is brief and never required to understand state.

## Open Decisions

- How to operate Supabase backups and restore drills for a deployed vault.
- Whether real-time multi-device sync is in scope later.
- Whether to add out-of-band recipient key verification (fingerprints) or a key-transparency mechanism.
- Whether passkeys should ever become a provider for other websites; that requires a browser extension.
- Browser extension and autofill are explicitly out of scope for now.
