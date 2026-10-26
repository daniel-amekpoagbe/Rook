import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const port = Number(process.env.E2E_PORT ?? 3100)
const externalBase = process.env.E2E_BASE_URL
const base = externalBase ?? `http://127.0.0.1:${port}`
const dataDir = process.env.ROOK_DATA_DIR ?? (externalBase ? null : await mkdtemp(join(tmpdir(), 'rook-e2e-')))
const dbPath = process.env.DB_PATH ?? (dataDir ? join(dataDir, 'rook.db') : null)
const artifacts = process.env.E2E_ARTIFACTS ?? join(root, 'e2e', 'artifacts')

await mkdir(artifacts, { recursive: true })

// WebAuthn RP IDs must be domain names. localhost is a secure context and a
// valid RP ID, while 127.0.0.1 is not. The rest of the suite stays on the
// loopback address so existing tests do not change origins.
function passkeyOrigin(value) {
  try {
    const url = new URL(value)
    if (url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1') {
      url.hostname = 'localhost'
      return url.origin
    }
  } catch {
    // Fall through to the supplied value; the flow will report a clear error.
  }
  return value
}

const passkeyBase = passkeyOrigin(externalBase ?? `http://127.0.0.1:${port}`)

const scripts = [
  { file: 'e2e/vault.e2e.mjs' },
  { file: 'e2e/passkey.e2e.mjs', env: { BASE_URL: passkeyBase } },
  { file: 'e2e/import.e2e.mjs' },
  { file: 'e2e/history-trash.e2e.mjs' },
  { file: 'e2e/share.e2e.mjs' },
  { file: 'e2e/share-edge.e2e.mjs' },
  { file: 'e2e/share-mobile.e2e.mjs' },
  { file: 'e2e/conflict-recovery.e2e.mjs' },
  { file: 'e2e/conflict-choices.e2e.mjs' },
]

let server = null

async function waitForServer() {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`server did not become ready at ${base}`)
}

function runScript(file, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      cwd: root,
      env: {
        ...process.env,
        BASE_URL: base,
        E2E_ARTIFACTS: artifacts,
        ...(dbPath ? { DB_PATH: dbPath } : {}),
        ...(dataDir ? { ROOK_DATA_DIR: dataDir } : {}),
        ...overrides,
      },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${file} exited with ${signal ?? code}`))
    })
  })
}

try {
  if (!externalBase) {
    server = spawn(process.execPath, ['.output/server/index.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        NITRO_HOST: '127.0.0.1',
        NODE_ENV: 'production',
        ...(dataDir ? { ROOK_DATA_DIR: dataDir } : {}),
      },
      stdio: 'inherit',
    })
    server.on('exit', (code) => {
      if (code && code !== 0) console.error(`server exited with code ${code}`)
    })
    await waitForServer()
  }

  console.log(`\nRunning E2E against ${base}\n`)
  for (const script of scripts) {
    console.log(`\n▶ ${script.file}`)
    await runScript(script.file, script.env)
  }
  console.log('\nE2E_SUITE=PASS')
} catch (error) {
  console.error('\nE2E_SUITE=FAIL')
  console.error(error)
  process.exitCode = 1
} finally {
  if (server) {
    server.kill('SIGTERM')
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        server.kill('SIGKILL')
        resolve()
      }, 5_000)
      server.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }
  if (!externalBase && dataDir) {
    await rm(dataDir, { recursive: true, force: true })
  }
}
