# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the project owner, a developer who is building this to understand how password managers work and wants to use it as a real daily vault on their own machine. Desktop browser first; the same surface has to survive a narrow window and a phone-sized viewport. Occasionally shares a login with another Rook account; that recipient uses their own vault and identity.

## Product Purpose

A zero-knowledge personal password manager. It stores logins, secure notes, cards, identities, and encrypted file attachments, generates strong passwords, produces TOTP codes, and audits the vault for weak, reused, old, or unprotected credentials. Success means the owner reaches for it instead of a notes file: unlock fast, find an item in seconds, copy or download, lock, move on.

## Positioning

An original implementation, not a clone: the master password is stretched with Argon2id in the browser, split with HKDF into an auth key and a vault key, and the server holds only opaque ciphertext, public keys, and a hash of a hash. Attachment files are encrypted separately with random per-file keys that live inside the encrypted vault. Recipient-bound sharing uses P-256 ECDH envelopes, so the server never receives a share key or a recipient private key. No master-password recovery path exists by design. An optional WebAuthn passkey can add a second factor to Rook's own sign-in; its one-time recovery code can bypass that factor, never the vault key.

## Operating Context

- A browser tab on a personal machine, usually open beside the site being logged into.
- Short, repeated sessions: unlock, search, copy a password or TOTP code, lock.
- Occasional longer sessions for adding items, rotating passwords, running the audit, and sharing a login with another Rook account.
- Local Node server with SQLite; the vault is decrypted only in memory and locks on reload.
- Keyboard use is normal: `Cmd/Ctrl+K` for search, `Cmd/Ctrl+L` to lock.

## Capabilities and Constraints

- Entry types: login, secure note, card, identity. Favorites, tags, search, sorting.
- Item history (last 20 versions) and trash, both encrypted with the vault; restore a version, restore a deleted item, or remove it permanently.
- Encrypted file attachments on any item. Limit: 10 MB per file, 20 per item, 200 per account and 100 MB total. The browser encrypts with a random per-file key; the server stores only ciphertext, a nonce, byte size, and the opaque item id. Attachment names, MIME types, and keys stay inside the encrypted vault.
- Permanent-delete tombstones: a deletion survives conflict merges, so a stale tab or stale vault copy cannot silently resurrect the item. Permanent deletion also removes the item's attachment blobs and revokes its recipient shares best-effort.
- Save conflicts are explicit: merge items from both versions, keep this tab's version, or load the server version. Local edits stay encrypted and in memory until the choice is made.
- Share a login's title, username, password, and website with another Rook account by handle. The recipient needs a Rook account and must unlock it once to publish a P-256 identity public key. The owner's browser wraps a random 32-byte share key to that public key with ephemeral P-256 ECDH + HKDF-SHA256 + XChaCha20-Poly1305; the server stores only ciphertext and the envelope. Shares expire after three days, the owner can list and revoke each recipient independently, and the recipient's "Shared with me" inbox decrypts client-side. Shared items are read-only and never include attachments; the dialog says so when the item has files. Limits: 50 active shares per owner, 20 per item.
- Account identity: P-256 ECDH. The PKCS8 private key is sealed under the vault key and stored server-side only as ciphertext; the public key is a server-visible directory entry. Master-password rotation re-wraps the private key atomically with the vault and auth verifier.
- Existing bearer links remain readable until their original expiry, but new link creation has been removed.
- Client-side Argon2id (64 MiB, t=3, p=1), HKDF-SHA256 key split, XChaCha20-Poly1305 vault encryption with the KDF header bound as AAD. Attachments use XChaCha20-Poly1305 with per-file keys and bind the attachment id, item id, name, size, and MIME type as AAD.
- Vault data version 5 adds attachment metadata. Older versions 2–4 open and migrate with an empty attachment list.
- Optional WebAuthn passkey second factor for Rook's own sign-in. Once a passkey is registered, the master password alone cannot start a session. Adding the first passkey shows a recovery code once; removing the last passkey turns the factor off and discards the code.
- Passkeys require HTTPS or `localhost` and are bound to their origin. The passkey authenticates the server session only; the master password still derives the vault key. Rook is not a passkey provider for other websites; that needs a browser extension and is out of scope.
- Session cookie holds a random token; the database stores only its SHA-256. Eight failed attempts per fifteen minutes.
- Password generator, entropy estimate, TOTP (RFC 6238), audit with optional HIBP range check.
- Local import from Chrome CSV, 1Password CSV, Bitwarden JSON/CSV, and Rook CSV, with a preview and duplicate detection.
- Encrypted backups include attachment metadata but not file bytes. On import, attachment references are kept only when the encrypted blob already exists for the account. CSV export contains no files.
- Single vault per account. No master-password recovery; a passkey recovery code only bypasses the passkey second factor. No multi-device sync. Handles may be email addresses.
- TanStack Start + React 19 + Vite + Tailwind v4 on the client; Node with `node:sqlite` on the server.
- Iconography must come from `react-icons` (owner directive). No emoji standing in for icons.

## Brand Commitments

- Name: Rook.
- The mark is a solid chess rook in three rounded pieces: crown, neck, base. A rook is a
  castle and a watchful corvid; the brand should feel quiet, guarded, and precise rather than
  playful or aggressive.
- Original code, naming, and vault format. Never copy 1Password's implementation, branding, or visual identity.
- The product speaks plainly about security. It never implies a recovery path it does not have: the vault key has no recovery, and a passkey recovery code only bypasses the passkey second factor.

## Evidence on Hand

- Working application at `src/`, with passing unit tests (including the import parsers, history, trash, schema migration, attachment crypto, recipient-share envelopes, and passkey helpers) and Playwright end-to-end flows.
- A passkey end-to-end flow exercises registration, required second-factor unlock, recovery-code unlock, and removing the last passkey using Chromium's virtual authenticator.
- An attachment end-to-end flow verifies ciphertext-only server storage, browser decryption and download, reload persistence, removal, blob cleanup, and the share-dialog warning.
- A two-account sharing flow verifies ciphertext-only `recipient_shares`, recipient inbox decryption, per-recipient revocation, expiry cleanup, master-password rotation, and legacy-link read compatibility. Long, password-only, and mobile layouts are covered separately.
- `README.md` documents the architecture, attachment and sharing key hierarchies, limits, passkey scope, and threat model.
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

- Whether this is ever deployed beyond the owner's machine.
- Whether multi-device sync is in scope later.
- Whether to add out-of-band recipient key verification (fingerprints) or a key-transparency mechanism.
- Whether encrypted backups should ever include attachment blobs, and how to keep that archive manageable.
- Whether passkeys should ever become a provider for other websites; that requires a browser extension.
- Browser extension and autofill are explicitly out of scope for now.
