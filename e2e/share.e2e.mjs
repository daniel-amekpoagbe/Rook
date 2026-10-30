import { DatabaseSync } from 'node:sqlite'
import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const DB_PATH = process.env.DB_PATH ?? 'data/rook.db'
const STAMP = Date.now().toString().slice(-8)
const OWNER_HANDLE = `share.owner.${STAMP}@example.com`
const OWNER_MASTER = 'mango-otter-vinyl-harbor-cobalt'
const TITLE = 'Shared account'
const USERNAME = 'shared@example.com'
const PASSWORD = 'share-secret-7f3a9c'
const URL = 'https://github.com/login'
const DAY_MS = 24 * 60 * 60 * 1000

const browser = await launchBrowser()
const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const owner = await ownerContext.newPage()
const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const guest = await guestContext.newPage()
const errors = []
const ownerRequests = []

for (const [label, page] of [
  ['owner', owner],
  ['guest', guest],
]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`))
}
owner.on('request', (request) => {
  ownerRequests.push({ url: request.url(), body: request.postData() ?? '' })
})

function withDb(callback) {
  const db = new DatabaseSync(DB_PATH)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return callback(db)
  } finally {
    db.close()
  }
}

function readLatestShare(handle) {
  return withDb((db) =>
    db
      .prepare(
        `SELECT s.* FROM shares s
         JOIN users u ON u.id = s.user_id
         WHERE u.handle = ?
         ORDER BY s.created_at DESC
         LIMIT 1`,
      )
      .get(handle),
  )
}

function expireShare(id) {
  withDb((db) => {
    db.prepare('UPDATE shares SET expires_at = 0 WHERE id = ?').run(id)
  })
}

async function createAccount(page, handle, master) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', handle)
  await page.fill('input[name="master-password"]', master)
  await page.fill('input[name="confirm-password"]', master)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 180_000 })
}

async function createLogin(page, { title, username, password, url }) {
  await page.getByRole('button', { name: 'New item' }).click()
  await page.getByRole('menuitem', { name: 'Login' }).click()
  await page.waitForSelector('input[name="title"]')
  await page.fill('input[name="title"]', title)
  if (username) await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  if (url) await page.fill('input[name="url"]', url)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
}

async function openShareDialog() {
  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = owner.getByRole('dialog', { name: 'Share' })
  await dialog.waitFor()
  return dialog
}

async function createLink(dialog) {
  await dialog.getByRole('button', { name: 'Create link', exact: true }).click()
  const field = dialog.getByRole('textbox', { name: 'Share link' })
  await field.waitFor({ timeout: 30_000 })
  const link = await field.inputValue()
  if (!link.includes('/share/') || !link.includes('#')) {
    throw new Error('share link is missing its fragment key')
  }
  return link
}

try {
  await createAccount(owner, OWNER_HANDLE, OWNER_MASTER)
  await createLogin(owner, { title: TITLE, username: USERNAME, password: PASSWORD, url: URL })
  console.log('• owner vault and login created')

  ownerRequests.length = 0
  const dialog = await openShareDialog()
  if (await dialog.getByLabel('Recipient handle').count()) {
    throw new Error('share dialog still asks for a recipient name')
  }
  const link = await createLink(dialog)
  console.log('• owner created a read-only link without a recipient name')

  const row = readLatestShare(OWNER_HANDLE)
  if (!row) throw new Error('share link was not stored')
  const stored = JSON.stringify(row)
  for (const secret of [PASSWORD, USERNAME, TITLE, OWNER_MASTER]) {
    if (stored.includes(secret)) throw new Error(`plaintext ${secret} found in shares`)
  }
  if (row.expires_at - row.created_at !== 3 * DAY_MS) {
    throw new Error(`share lifetime was ${row.expires_at - row.created_at}ms, expected 3 days`)
  }
  const leaked = ownerRequests.find((request) =>
    [PASSWORD, USERNAME, TITLE, OWNER_MASTER].some((secret) => request.body.includes(secret)),
  )
  if (leaked) throw new Error(`plaintext share data leaked to ${leaked.url}`)
  await owner.screenshot({ path: artifactPath('share-dialog-link.png') })
  console.log('• server stored only ciphertext for three days')

  await guest.goto(link, { waitUntil: 'networkidle' })
  await guest.getByRole('heading', { name: 'Someone shared an item with you.' }).waitFor({
    timeout: 30_000,
  })
  await guest.getByText(/Read only/).waitFor()
  await guest.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  await guest.getByText(USERNAME, { exact: true }).waitFor()
  if (await guest.getByRole('button', { name: 'Edit', exact: true }).count()) {
    throw new Error('shared page exposed an edit control')
  }
  if (await guest.getByText(PASSWORD, { exact: true }).count()) {
    throw new Error('password was visible before reveal')
  }
  await guest.getByRole('button', { name: 'Reveal password' }).click()
  await guest.getByText(PASSWORD, { exact: true }).waitFor()
  await guest.screenshot({ path: artifactPath('share-link-ready.png') })
  console.log('• guest viewed the login read-only')

  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click()
  await dialog.getByText('No active links.').waitFor({ timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await dialog.waitFor({ state: 'detached' })
  await guest.reload({ waitUntil: 'networkidle' })
  await guest.getByRole('heading', { name: 'Link unavailable', exact: true }).waitFor({
    timeout: 30_000,
  })
  if (readLatestShare(OWNER_HANDLE)) throw new Error('revoked share was not removed')
  console.log('• revoking the link removes access')

  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const second = owner.getByRole('dialog', { name: 'Share' })
  await second.waitFor()
  const secondLink = await createLink(second)
  const secondRow = readLatestShare(OWNER_HANDLE)
  if (!secondRow) throw new Error('second share was not stored')
  expireShare(secondRow.id)
  await guest.goto(secondLink, { waitUntil: 'networkidle' })
  await guest.getByRole('heading', { name: 'Link unavailable', exact: true }).waitFor({
    timeout: 30_000,
  })
  console.log('• an expired link is refused')

  if (errors.length > 0) {
    console.log('CONSOLE ERRORS:')
    for (const error of errors.slice(0, 10)) console.log('  !', error)
    throw new Error('console errors were recorded')
  }

  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  await owner.screenshot({ path: artifactPath('share-owner-failure.png') }).catch(() => {})
  await guest.screenshot({ path: artifactPath('share-guest-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
