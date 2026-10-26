# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the project owner, a developer who is building this to understand how password managers work and wants to use it as a real daily vault on their own machine. Desktop browser first; the same surface has to survive a narrow window and a phone-sized viewport.

## Product Purpose

A zero-knowledge personal password manager. It stores logins, secure notes, cards, and identities, generates strong passwords, produces TOTP codes, and audits the vault for weak, reused, old, or unprotected credentials. Success means the owner reaches for it instead of a notes file: unlock fast, find an item in seconds, copy, lock, move on.

## Positioning

An original implementation, not a clone: the master password is stretched with Argon2id in the browser, split with HKDF into an auth key and a vault key, and the server only ever holds opaque ciphertext plus a hash of a hash. No master-password recovery path exists by design. An optional WebAuthn passkey can add a second factor to Rook's own sign-in; its one-time recovery code can bypass that factor, never the vault key.

## Operating Context

- A browser tab on a personal machine, usually open beside the site being logged into.
- Short, repeated sessions: unlock, search, copy a password or TOTP code, lock.
- Occasional longer sessions for adding items, rotating passwords, and running the audit.
- Local Node server with SQLite; the vault is decrypted only in memory and locks on reload.
- Keyboard use is normal: `Cmd/Ctrl+K` for search, `Cmd/Ctrl+L` to lock.

## Capabilities and Constraints

- Entry types: login, secure note, card, identity. Favorites, tags, search, sorting.
- Item history (last 20 versions) and trash, both encrypted with the vault; restore a version, restore a deleted item, or remove it permanently.
- Permanent-delete tombstones: a deletion survives conflict merges, so a stale tab or stale vault copy cannot silently resurrect the item.
- Save conflicts are explicit: merge items from both versions, keep this tab's version, or load the server version. Local edits stay encrypted and in memory until the choice is made.
- Share a login password as a three-day bearer link. The recipient needs no Rook account; the key travels in the URL fragment, the server stores only ciphertext, and the owner can list and revoke active links.
- Client-side Argon2id (64 MiB, t=3, p=1), HKDF-SHA256 key split, XChaCha20-Poly1305 vault encryption with the KDF header bound as AAD.
- Optional WebAuthn passkey second factor for Rook's own sign-in. Once a passkey is registered, the master password alone cannot start a session. Adding the first passkey shows a recovery code once; removing the last passkey turns the factor off and discards the code.
- Passkeys require HTTPS or `localhost` and are bound to their origin. The passkey authenticates the server session only; the master password still derives the vault key. Rook is not a passkey provider for other websites; that needs a browser extension and is out of scope.
- Session cookie holds a random token; the database stores only its SHA-256. Eight failed attempts per fifteen minutes.
- Password generator, entropy estimate, TOTP (RFC 6238), audit with optional HIBP range check.
- Local import from Chrome CSV, 1Password CSV, Bitwarden JSON/CSV, and Rook CSV, with a preview and duplicate detection.
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

- Working application at `src/`, with passing unit tests (including the import parsers, history, trash, schema migration, and passkey helpers) and Playwright end-to-end flows.
- A passkey end-to-end flow exercises registration, required second-factor unlock, recovery-code unlock, and removing the last passkey using Chromium's virtual authenticator.
- `README.md` documents the architecture, passkey scope, and threat model.
- No real user data, testimonials, benchmarks, or press. Any demo entries are synthetic.

## Product Principles

1. The key never leaves the tab; the server is untrusted by construction.
2. Retrieval speed beats feature breadth.
3. Every state explains itself: locked, deriving, saving, conflict, error.
4. Plain language over security theater; no false assurances.
5. Calm, precise surfaces. The vault is a tool, not a performance.

## Accessibility & Inclusion

Keyboard-first operation with visible focus. Body text meets WCAG AA contrast. Controls carry accessible names. Motion is brief and never required to understand state.

## Open Decisions

- Whether this is ever deployed beyond the owner's machine.
- Whether multi-device sync is in scope later.
- Whether sharing should stay as bearer links or become recipient-bound (public-key envelopes) later.
- Whether passkeys should ever become a provider for other websites; that requires a browser extension.
- Browser extension and autofill are explicitly out of scope for now.
