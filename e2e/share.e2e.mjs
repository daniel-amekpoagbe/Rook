import { DatabaseSync } from 'node:sqlite'
import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const DB_PATH = process.env.DB_PATH ?? 'data/rook.db'
const HANDLE = `share.${Date.now()}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const TITLE = 'Shared account'
const USERNAME = 'shared@example.com'
const PASSWORD = 'share-secret-7f3a9c'
const DAY_MS = 24 * 60 * 60 * 1000

const browser = await launchBrowser()
const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const owner = await ownerContext.newPage()
const recipientContext = await browser.newContext({ viewport: { width: 960, height: 900 } })
const recipient = await recipientContext.newPage()
const errors = []
const ownerRequests = []
const recipientRequests = []

for (const page of [owner, recipient]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${page === owner ? 'owner' : 'recipient'}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${page === owner ? 'owner' : 'recipient'}: ${error.message}`))
}
owner.on('request', (request) => {
  ownerRequests.push({ url: request.url(), body: request.postData() ?? '' })
})
recipient.on('request', (request) => {
  recipientRequests.push({ url: request.url(), body: request.postData() ?? '' })
})

async function createVaultAndItem() {
  await owner.goto(BASE, { waitUntil: 'networkidle' })
  await owner.waitForSelector('input[name="handle"]', { timeout: 30_000 })
  await owner.getByRole('button', { name: 'Create vault', exact: true }).click()
  await owner.waitForSelector('input[name="confirm-password"]')
  await owner.fill('input[name="handle"]', HANDLE)
  await owner.fill('input[name="master-password"]', MASTER)
  await owner.fill('input[name="confirm-password"]', MASTER)
  await owner.getByRole('button', { name: 'Create encrypted vault' }).click()
  await owner.waitForSelector('text=Your vault is unlocked', { timeout: 180_000 })

  await owner.getByRole('button', { name: 'New item' }).click()
  await owner.getByRole('menuitem', { name: 'Login' }).click()
  await owner.waitForSelector('input[name="title"]')
  await owner.fill('input[name="title"]', TITLE)
  await owner.fill('input[name="username"]', USERNAME)
  await owner.fill('input[name="password"]', PASSWORD)
  await owner.getByRole('button', { name: 'Save', exact: true }).click()
  await owner.getByRole('heading', { name: TITLE, exact: true }).waitFor()
}

async function openShareDialog() {
  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = owner.getByRole('dialog', { name: 'Share password' })
  await dialog.waitFor()
  return dialog
}

async function createLink() {
  const dialog = await openShareDialog()
  await dialog.getByRole('button', { name: 'Create link' }).click()
  const input = dialog.getByLabel('Share link')
  await input.waitFor({ timeout: 30_000 })
  return { dialog, link: await input.inputValue() }
}

function parseShare(link) {
  const url = new URL(link)
  const id = url.pathname.split('/').filter(Boolean).pop()
  const key = url.hash.replace(/^#/, '')
  if (!id || !key) throw new Error(`Malformed share link: ${link}`)
  return { id, key, url }
}

function readShareRow(id) {
  const db = new DatabaseSync(DB_PATH)
  try {
    return db.prepare('SELECT * FROM shares WHERE id = ?').get(id)
  } finally {
    db.close()
  }
}

function expireShare(id) {
  const db = new DatabaseSync(DB_PATH)
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.prepare('UPDATE shares SET expires_at = 0 WHERE id = ?').run(id)
  } finally {
    db.close()
  }
}

try {
  await createVaultAndItem()
  console.log('• temporary vault and login created')

  ownerRequests.length = 0
  const first = await createLink()
  const firstShare = parseShare(first.link)
  console.log('• share link created')

  if (!/^[0-9a-f-]{36}$/i.test(firstShare.id)) throw new Error('share id is not a UUID')
  if (firstShare.key.length !== 43) throw new Error(`unexpected share key length ${firstShare.key.length}`)
  if (!first.link.includes(`/share/${firstShare.id}#${firstShare.key}`)) {
    throw new Error('share link is missing its fragment key')
  }

  const leakedOwnerRequest = ownerRequests.find(
    (request) => request.url.includes(firstShare.key) || request.body.includes(firstShare.key),
  )
  if (leakedOwnerRequest) throw new Error(`share key leaked to ${leakedOwnerRequest.url}`)
  const leakedPassword = ownerRequests.find((request) => request.body.includes(PASSWORD))
  if (leakedPassword) throw new Error(`plaintext password leaked to ${leakedPassword.url}`)

  const row = readShareRow(firstShare.id)
  if (!row) throw new Error('share row was not stored')
  const stored = JSON.stringify(row)
  if (stored.includes(PASSWORD)) throw new Error('plaintext password found in shares table')
  if (stored.includes(firstShare.key)) throw new Error('share key found in shares table')
  if (row.expires_at - row.created_at !== 3 * DAY_MS) {
    throw new Error(`share lifetime was ${row.expires_at - row.created_at}ms, expected 3 days`)
  }
  console.log('• server stored only ciphertext with a 3-day lifetime')

  await owner.screenshot({ path: artifactPath('share-dialog-light.png') })

  recipientRequests.length = 0
  await recipient.goto(first.link, { waitUntil: 'networkidle' })
  await recipient.getByRole('heading', { name: 'Someone shared an item with you.' }).waitFor({ timeout: 30_000 })
  await recipient.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  await recipient.getByText(USERNAME, { exact: true }).waitFor()
  await recipient.getByText(/You can view this item until/).waitFor()
  if (await recipient.getByText(PASSWORD, { exact: true }).count()) {
    throw new Error('password was visible before reveal')
  }
  await recipient.screenshot({ path: artifactPath('share-page-initial.png') })
  await recipient.getByRole('button', { name: 'Reveal password' }).click()
  await recipient.getByText(PASSWORD, { exact: true }).waitFor()
  console.log('• recipient without an account decrypted the password')

  const leakedRecipientRequest = recipientRequests.find(
    (request) => request.url.includes(firstShare.key) || request.body.includes(firstShare.key),
  )
  if (leakedRecipientRequest) throw new Error(`share key leaked to ${leakedRecipientRequest.url}`)

  await recipient.screenshot({ path: artifactPath('share-page-dark.png') })
  console.log('• share page renders in the dark shared-item style')

  await recipient.goto(`${BASE}/share/${firstShare.id}`, { waitUntil: 'networkidle' })
  await recipient.getByRole('heading', { name: 'Link unavailable' }).waitFor()
  await recipient.getByText(/incomplete or damaged/).waitFor()
  console.log('• a link without its fragment key is rejected')

  await recipient.goto(`${BASE}/share/${firstShare.id}#${'A'.repeat(43)}`, { waitUntil: 'networkidle' })
  await recipient.getByRole('heading', { name: 'Link unavailable' }).waitFor()
  await recipient.getByText(/could not be opened/).waitFor()
  console.log('• a wrong fragment key is rejected')

  await first.dialog.getByRole('button', { name: 'Close dialog' }).click()
  const reopened = await openShareDialog()
  await reopened.getByText(/Expires in \d+/).waitFor()
  await reopened.getByRole('button', { name: 'Revoke' }).click()
  await reopened.getByText(/Expires in \d+/).waitFor({ state: 'hidden' })
  await reopened.getByRole('button', { name: 'Close dialog' }).click()
  console.log('• active link listed and revoked')

  await recipient.goto(first.link, { waitUntil: 'networkidle' })
  await recipient.getByRole('heading', { name: 'Link unavailable' }).waitFor()
  console.log('• revoked link no longer opens')

  const second = await createLink()
  const secondShare = parseShare(second.link)
  await second.dialog.getByRole('button', { name: 'Close dialog' }).click()
  expireShare(secondShare.id)
  await recipient.goto(second.link, { waitUntil: 'networkidle' })
  await recipient.getByRole('heading', { name: 'Link unavailable' }).waitFor()
  if (readShareRow(secondShare.id)) throw new Error('expired share was not removed from the database')
  console.log('• expired link is refused and cleaned up')

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
  await recipient.screenshot({ path: artifactPath('share-recipient-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
