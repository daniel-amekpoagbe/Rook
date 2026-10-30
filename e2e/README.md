# Browser end-to-end tests

These flows run against a real Rook server with a disposable SQLite database.
They cover registration and unlock, import, history/trash, the authenticator
view, recipient-bound sharing, mobile sharing, conflict recovery, a WebAuthn
passkey flow, and the product polish checks (theme-aware lock screen, list
grouping and filters, modal focus/inert behavior, audit actions, and bulk trash
actions).

## Run the whole suite

```bash
npm run test:e2e
```

This builds the production server, starts it on `127.0.0.1:3100`, runs every
flow in order, and removes the temporary data directory.

## Run against an existing server

```bash
E2E_BASE_URL=http://127.0.0.1:3000 \
DB_PATH=data/rook.db \
npm run test:e2e:only
```

`DB_PATH` is used by the sharing flows to inspect `recipient_shares` and
`user_identities` for ciphertext-only storage, the recipient envelope, and
expiry cleanup.

## Authenticator flow

The main vault flow adds a TOTP secret to a login, checks that a live code is
rendered in the detail view, opens the Authenticator dialog, and verifies the
same account appears there. It also checks that the plaintext secret never
appears in the page DOM or in any captured request body, before and after a
lock/unlock cycle.

## Sharing flow

The main sharing flow creates one vault, then a read-only link. The test checks
SQLite directly to confirm the `shares` row is ciphertext only, lasts exactly
three days, and that the password never appears in a request body. A second
browser opens the link, reveals the password, and confirms there is no edit
control. Revoking the link makes it unavailable. A second link is expired in
SQLite and the public page refuses it.

`share-inbox.e2e.mjs` opens Shared by me, finds the read-only link, and revokes
it. `share-edge.e2e.mjs` covers long and password-only items on the public
page, including no horizontal overflow. `share-mobile.e2e.mjs` creates and
opens a link at a 390 px viewport.

## Polish flow

`polish.e2e.mjs` creates an account and checks that the lock screen follows the
light/dark theme, favorites are grouped, tag filtering and sorting work, modals
trap focus and inert the background, audit findings can be ignored/restored and
open the generator, and trash supports multi-select restore and empty-trash.

## Passkey flow and origins

WebAuthn RP IDs must be domain names. The suite normally runs on
`127.0.0.1:3100`, but the passkey flow is launched with `localhost` instead;
`e2e/run.mjs` rewrites a loopback `E2E_BASE_URL` to `localhost` for that flow
only. `localhost` is also a secure context, so passkeys work over plain HTTP
during development. In production, passkeys require HTTPS.

The passkey flow attaches Chromium's virtual authenticator through CDP. It
registers a passkey, verifies that the master password alone no longer unlocks,
unlocks with the passkey, unlocks with the recovery code, then removes the last
passkey and confirms password-only unlock works again. No real authenticator or
browser extension is involved.

A passkey is bound to its origin. A credential registered at
`http://localhost:3100` will not work at `http://127.0.0.1:3100`. Use the same
address each time.

## Local browser selection

By default the suite uses the Chromium bundled with Playwright. Install it once:

```bash
npx playwright install chromium
```

To use a system Chrome instead:

```bash
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e:only
```

Screenshots and failure captures are written to `e2e/artifacts/` (ignored by
git). CI uploads that directory when a run fails.
