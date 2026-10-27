# Browser end-to-end tests

These flows run against a real Rook server with a disposable SQLite database.
They cover registration and unlock, import, history/trash, the authenticator
view, recipient-bound sharing, mobile sharing, conflict recovery, and a WebAuthn
passkey flow.

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

The main sharing flow creates two accounts. The recipient opens “Shared with me”
once so the client publishes a P-256 identity public key. The owner then shares
a login by handle. The test checks SQLite directly to confirm:

- the identity private key and share payload are ciphertext only;
- the share row carries an ephemeral public key, a wrap nonce, and a wrapped
  share key;
- the lifetime is exactly three days;
- no plaintext password, username, title, or master password appears in the
  recipient-share row;
- no plaintext master password appears in either identity row;
- none of those secrets appears in the captured request bodies.

It then opens the recipient inbox, decrypts the share in the browser, reveals
the password, and confirms the item was not added to the recipient vault. Next
it rotates the recipient master password, locks and unlocks with the new
password, and verifies the same share still decrypts. That exercises the atomic
identity re-wrap. Finally it revokes the share, confirms both the owner and
recipient lose access, creates a second share, expires it directly in SQLite,
and confirms the recipient inbox cleans it up.

Legacy bearer links are no longer created by the UI. To verify read
compatibility, the flow inserts a valid legacy `shares` row directly and opens
its URL-fragment link.

`share-edge.e2e.mjs` covers long and password-only items, including no
horizontal overflow. `share-mobile.e2e.mjs` repeats the share and inbox flow at
a 390 px viewport and checks the mobile navigation.

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
