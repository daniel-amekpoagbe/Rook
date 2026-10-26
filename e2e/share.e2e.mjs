import { DatabaseSync } from 'node:sqlite'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const DB_PATH = process.env.DB_PATH ?? 'data/rook.db'
const STAMP = Date.now().toString().slice(-8)
const OWNER_HANDLE = `share.owner.${STAMP}@example.com`
const RECIPIENT_HANDLE = `share.recipient.${STAMP}@example.com`
const OWNER_MASTER = 'mango-otter-vinyl-harbor-cobalt'
let RECIPIENT_MASTER = 'cedar-lantern-pixel-orbit-quartz'
const NEXT_RECIPIENT_MASTER = 'sable-orbit-canyon-velvet-ember'
const TITLE = 'Shared account'
const USERNAME = 'shared@example.com'
const PASSWORD = 'share-secret-7f3a9c'
const URL = 'https://github.com/login'
const DAY_MS = 24 * 60 * 60 * 1000

const browser = await launchBrowser()
const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const owner = await ownerContext.newPage()
const recipientContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const recipient = await recipientContext.newPage()
const errors = []
const ownerRequests = []
const recipientRequests = []

for (const [label, page] of [
  ['owner', owner],
  ['recipient', recipient],
]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`))
}
owner.on('request', (request) => {
  ownerRequests.push({ url: request.url(), body: request.postData() ?? '' })
})
recipient.on('request', (request) => {
  recipientRequests.push({ url: request.url(), body: request.postData() ?? '' })
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

function readUser(handle) {
  return withDb((db) => db.prepare('SELECT * FROM users WHERE handle = ?').get(handle))
}

function readIdentity(handle) {
  return withDb((db) =>
    db
      .prepare(
        `SELECT ui.* FROM user_identities ui
         JOIN users u ON u.id = ui.user_id
         WHERE u.handle = ?`,
      )
      .get(handle),
  )
}

function readRecipientShare(ownerHandle, recipientHandle) {
  return withDb((db) =>
    db
      .prepare(
        `SELECT rs.* FROM recipient_shares rs
         JOIN users owner ON owner.id = rs.owner_id
         JOIN users recipient ON recipient.id = rs.recipient_id
         WHERE owner.handle = ? AND recipient.handle = ?
         ORDER BY rs.created_at DESC
         LIMIT 1`,
      )
      .get(ownerHandle, recipientHandle),
  )
}

function expireRecipientShare(id) {
  withDb((db) => {
    db.prepare('UPDATE recipient_shares SET expires_at = 0 WHERE id = ?').run(id)
  })
}

function insertLegacyShare(ownerHandle, payload) {
  const owner = readUser(ownerHandle)
  if (!owner) throw new Error('legacy share owner was not found')
  const id = crypto.randomUUID()
  const key = randomBytes(32)
  const nonce = randomBytes(24)
  const aad = new TextEncoder().encode(`rook.share.v1:${id}`)
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(
    new TextEncoder().encode(JSON.stringify(payload)),
  )
  const now = Date.now()
  withDb((db) => {
    db.prepare(
      `INSERT INTO shares (id, user_id, entry_id, ciphertext, nonce, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      owner.id,
      'legacy-entry',
      Buffer.from(ciphertext).toString('base64'),
      Buffer.from(nonce).toString('base64'),
      now + 3 * DAY_MS,
      now,
    )
  })
  return {
    id,
    link: `${BASE}/share/${id}#${Buffer.from(key).toString('base64url')}`,
  }
}

function deleteLegacyShare(id) {
  withDb((db) => {
    db.prepare('DELETE FROM shares WHERE id = ?').run(id)
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
  const dialog = owner.getByRole('dialog', { name: 'Share password' })
  await dialog.waitFor()
  return dialog
}

async function shareWithRecipient(dialog) {
  await dialog.getByLabel('Recipient handle').fill(RECIPIENT_HANDLE)
  await dialog.getByRole('button', { name: 'Share', exact: true }).click()
  await dialog.getByText(`Shared with ${RECIPIENT_HANDLE}.`, { exact: true }).waitFor({
    timeout: 30_000,
  })
}

async function openInbox(page = recipient) {
  await page.getByRole('button', { name: 'Shared with me', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Shared with me' })
  await dialog.waitFor()
  return dialog
}

async function closeDialog(dialog) {
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
}

try {
  await createAccount(owner, OWNER_HANDLE, OWNER_MASTER)
  await createLogin(owner, {
    title: TITLE,
    username: USERNAME,
    password: PASSWORD,
    url: URL,
  })
  console.log('• owner vault and login created')

  await createAccount(recipient, RECIPIENT_HANDLE, RECIPIENT_MASTER)
  const emptyInbox = await openInbox()
  await emptyInbox
    .getByRole('heading', { name: 'Nothing shared with you', exact: true })
    .waitFor({ timeout: 30_000 })
  await closeDialog(emptyInbox)
  console.log('• recipient unlocked and published a sharing identity')

  const identity = readIdentity(RECIPIENT_HANDLE)
  if (!identity) throw new Error('recipient identity was not stored')
  if (!identity.public_key || !identity.ciphertext || !identity.nonce) {
    throw new Error('recipient identity is incomplete')
  }
  const ownerIdentity = readIdentity(OWNER_HANDLE)
  if (!ownerIdentity) throw new Error('owner identity was not stored')
  for (const [label, row] of [
    ['recipient', identity],
    ['owner', ownerIdentity],
  ]) {
    const storedIdentity = JSON.stringify(row)
    for (const secret of [OWNER_MASTER, RECIPIENT_MASTER]) {
      if (storedIdentity.includes(secret)) {
        throw new Error(`plaintext master password found in the ${label} identity row`)
      }
    }
  }

  ownerRequests.length = 0
  const dialog = await openShareDialog()
  if (await dialog.getByLabel('Share link').count()) {
    throw new Error('the recipient-bound dialog still exposes a bearer link')
  }
  if (await dialog.getByRole('button', { name: 'Create link' }).count()) {
    throw new Error('the recipient-bound dialog still creates bearer links')
  }
  await shareWithRecipient(dialog)
  console.log('• owner shared the login with the recipient handle')

  const row = readRecipientShare(OWNER_HANDLE, RECIPIENT_HANDLE)
  if (!row) throw new Error('recipient share was not stored')
  const stored = JSON.stringify(row)
  for (const secret of [PASSWORD, USERNAME, TITLE, OWNER_MASTER, RECIPIENT_MASTER]) {
    if (stored.includes(secret)) throw new Error(`plaintext ${secret} found in recipient_shares`)
  }
  if (row.owner_id === row.recipient_id) throw new Error('share was stored to the owner')
  if (!row.ephemeral_public_key || !row.wrap_nonce || !row.wrapped_key) {
    throw new Error('share envelope is incomplete')
  }
  if (row.expires_at - row.created_at !== 3 * DAY_MS) {
    throw new Error(`share lifetime was ${row.expires_at - row.created_at}ms, expected 3 days`)
  }
  const ownerSecrets = [PASSWORD, USERNAME, TITLE, OWNER_MASTER, RECIPIENT_MASTER]
  const leakedOwnerSecret = ownerRequests.find((request) =>
    ownerSecrets.some((secret) => request.body.includes(secret)),
  )
  if (leakedOwnerSecret) {
    throw new Error(`plaintext share data leaked to ${leakedOwnerSecret.url}`)
  }
  await owner.screenshot({ path: artifactPath('share-dialog-recipient-bound.png') })
  await closeDialog(dialog)
  console.log('• server stored only ciphertext, a recipient envelope, and a 3-day lifetime')

  recipientRequests.length = 0
  const inbox = await openInbox()
  await inbox.getByRole('button', { name: new RegExp(`^${TITLE}`) }).waitFor({
    timeout: 30_000,
  })
  await inbox.getByText(OWNER_HANDLE, { exact: false }).waitFor()
  await inbox.screenshot({ path: artifactPath('share-inbox-list.png') })
  await inbox.getByRole('button', { name: new RegExp(`^${TITLE}`) }).click()
  await inbox.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  await inbox.getByText(USERNAME, { exact: true }).waitFor()
  await inbox.getByText(URL, { exact: true }).waitFor()
  if (await inbox.getByText(PASSWORD, { exact: true }).count()) {
    throw new Error('password was visible before reveal')
  }
  await inbox.screenshot({ path: artifactPath('share-inbox-detail.png') })
  await inbox.getByRole('button', { name: 'Reveal password' }).click()
  await inbox.getByText(PASSWORD, { exact: true }).waitFor()
  console.log('• recipient decrypted the share in the app')

  const recipientSecrets = [PASSWORD, USERNAME, TITLE, OWNER_MASTER, RECIPIENT_MASTER]
  const leakedRecipientSecret = recipientRequests.find((request) =>
    recipientSecrets.some((secret) => request.body.includes(secret)),
  )
  if (leakedRecipientSecret) {
    throw new Error(`plaintext share data leaked to ${leakedRecipientSecret.url}`)
  }
  await closeDialog(inbox)
  if (await recipient.getByText(TITLE, { exact: true }).count()) {
    throw new Error('shared item was added to the recipient vault')
  }
  console.log('• recipient decryption stayed client-side and did not modify the vault')

  await recipient.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = recipient.getByRole('dialog', { name: 'Settings' })
  await settings.waitFor()
  await settings.locator('#current-master-password').fill(RECIPIENT_MASTER)
  await settings.locator('#next-master-password').fill(NEXT_RECIPIENT_MASTER)
  await settings.locator('#confirm-master-password').fill(NEXT_RECIPIENT_MASTER)
  await settings.getByRole('button', { name: 'Change password', exact: true }).click()
  await settings
    .getByText('Master password changed. The vault was re-encrypted with a new key.')
    .waitFor({ timeout: 60_000 })
  await settings.getByRole('button', { name: 'Close panel' }).click()
  await settings.waitFor({ state: 'detached' })
  RECIPIENT_MASTER = NEXT_RECIPIENT_MASTER

  await recipient.getByRole('button', { name: 'Lock vault' }).click()
  await recipient.waitForSelector('input[name="handle"]', { timeout: 10_000 })
  await recipient.fill('input[name="handle"]', RECIPIENT_HANDLE)
  await recipient.fill('input[name="master-password"]', RECIPIENT_MASTER)
  await recipient
    .locator('form')
    .getByRole('button', { name: 'Unlock vault', exact: true })
    .click()
  await recipient.waitForSelector('input[aria-label="Search vault"]', { timeout: 180_000 })
  const rotatedInbox = await openInbox()
  await rotatedInbox.getByRole('button', { name: new RegExp(`^${TITLE}`) }).waitFor({
    timeout: 30_000,
  })
  await rotatedInbox.getByRole('button', { name: new RegExp(`^${TITLE}`) }).click()
  await rotatedInbox.getByRole('button', { name: 'Reveal password' }).click()
  await rotatedInbox.getByText(PASSWORD, { exact: true }).waitFor()
  await closeDialog(rotatedInbox)
  console.log('• recipient master-password rotation re-wrapped the identity and kept the share readable')

  const sent = await openShareDialog()
  await sent.getByText(RECIPIENT_HANDLE, { exact: true }).waitFor()
  await sent.getByRole('button', { name: 'Revoke' }).click()
  await sent.getByText('Access revoked.', { exact: true }).waitFor()
  await closeDialog(sent)
  if (readRecipientShare(OWNER_HANDLE, RECIPIENT_HANDLE)) {
    throw new Error('revoked share was not removed from the database')
  }
  console.log('• owner revoked access for that recipient')

  const revokedInbox = await openInbox()
  await revokedInbox
    .getByRole('heading', { name: 'Nothing shared with you', exact: true })
    .waitFor({ timeout: 30_000 })
  await closeDialog(revokedInbox)
  console.log('• revoked share disappeared from the recipient inbox')

  const second = await openShareDialog()
  await shareWithRecipient(second)
  await closeDialog(second)
  const secondRow = readRecipientShare(OWNER_HANDLE, RECIPIENT_HANDLE)
  if (!secondRow) throw new Error('second recipient share was not stored')
  expireRecipientShare(secondRow.id)

  const expiredInbox = await openInbox()
  await expiredInbox
    .getByRole('heading', { name: 'Nothing shared with you', exact: true })
    .waitFor({ timeout: 30_000 })
  await closeDialog(expiredInbox)
  if (readRecipientShare(OWNER_HANDLE, RECIPIENT_HANDLE)) {
    throw new Error('expired share was not removed from the database')
  }
  console.log('• expired share is refused and cleaned up')

  const legacy = insertLegacyShare(OWNER_HANDLE, {
    version: 1,
    title: 'Legacy shared item',
    username: 'legacy@example.com',
    password: 'legacy-share-secret',
    from: OWNER_HANDLE,
    expiresAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
  })
  await recipient.goto(legacy.link, { waitUntil: 'networkidle' })
  await recipient.getByRole('heading', { name: 'Someone shared an item with you.' }).waitFor({
    timeout: 30_000,
  })
  await recipient.getByRole('heading', { name: 'Legacy shared item', exact: true }).waitFor()
  await recipient.getByRole('button', { name: 'Reveal password' }).click()
  await recipient.getByText('legacy-share-secret', { exact: true }).waitFor()
  deleteLegacyShare(legacy.id)
  console.log('• legacy bearer links remain readable until expiry')

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
