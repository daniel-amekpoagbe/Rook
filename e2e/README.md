# Browser end-to-end tests

These flows run against a real Rook server with a disposable SQLite database.
They cover registration and unlock, import, history/trash, encrypted
attachments, sharing, mobile sharing, conflict recovery, and a WebAuthn passkey
flow.

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

`DB_PATH` is used by the share flow to check ciphertext-only storage and expired
link cleanup, and by the attachment flow to check that the server never sees the
file name or plaintext and that removing a file deletes its blob.

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

## Attachment flow

The attachment flow uploads a 1 MiB text file to a login. It then checks the
SQLite attachment row for ciphertext only, downloads and byte-compares the
decrypted file, reloads and unlocks to confirm the metadata persisted, checks
the share dialog warning, removes the file, and verifies the server blob is
gone. It uses the normal `127.0.0.1` origin and does not need a virtual
authenticator.

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
