# Browser end-to-end tests

These flows run against a real Rook server with a disposable SQLite database.
They cover registration and unlock, import, history/trash, sharing, mobile
sharing, and conflict recovery.

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

`DB_PATH` is required by the share flow because it checks that the database
contains ciphertext only and that expired links are cleaned up.

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
