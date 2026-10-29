import { BASE, launchBrowser } from './helpers.mjs'

const STAMP = Date.now().toString().slice(-8)
const OWNER_HANDLE = `inbox.owner.${STAMP}@example.com`
const RECIPIENT_HANDLE = `inbox.recipient.${STAMP}@example.com`
const OWNER_MASTER = 'mango-otter-vinyl-harbor-cobalt'
const RECIPIENT_MASTER = 'cedar-lantern-pixel-orbit-quartz'
const TITLE = 'Inbox shared login'
const USERNAME = 'inbox@example.com'
const PASSWORD = 'inbox-secret-7f3a9c'

const browser = await launchBrowser()
const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const owner = await ownerContext.newPage()
const recipientContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const recipient = await recipientContext.newPage()
const errors = []

for (const [label, page] of [
  ['owner', owner],
  ['recipient', recipient],
]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
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

async function createLogin(page, title, username, password) {
  await page.getByRole('button', { name: 'New item' }).click()
  await page.getByRole('menuitem', { name: 'Login' }).click()
  await page.waitForSelector('input[name="title"]')
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
}

async function openInbox(page) {
  await page.getByRole('button', { name: /^Shared with me(?:, \d+ unread)?$/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Shared with me' })
  await dialog.waitFor()
  return dialog
}

async function closeDialog(dialog) {
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await dialog.waitFor({ state: 'detached' })
}

try {
  await createAccount(owner, OWNER_HANDLE, OWNER_MASTER)
  await createLogin(owner, TITLE, USERNAME, PASSWORD)
  console.log('• owner vault and login created')

  await createAccount(recipient, RECIPIENT_HANDLE, RECIPIENT_MASTER)
  const emptyInbox = await openInbox(recipient)
  await emptyInbox
    .getByRole('heading', { name: 'Nothing shared with you', exact: true })
    .waitFor({ timeout: 30_000 })
  await closeDialog(emptyInbox)
  console.log('• recipient published a sharing identity')

  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const shareDialog = owner.getByRole('dialog', { name: 'Share password' })
  await shareDialog.waitFor()
  await shareDialog.getByLabel('Recipient handle').fill(RECIPIENT_HANDLE)
  await shareDialog.getByRole('button', { name: 'Share', exact: true }).click()
  await shareDialog
    .getByText(`Shared with ${RECIPIENT_HANDLE}.`, { exact: true })
    .waitFor({ timeout: 30_000 })
  await closeDialog(shareDialog)
  console.log('• owner shared a login with the recipient')

  await recipient.evaluate(() => window.dispatchEvent(new Event('focus')))
  const unreadButton = recipient.getByRole('button', { name: 'Shared with me, 1 unread', exact: true })
  await unreadButton.waitFor({ timeout: 30_000 })
  await recipient.getByRole('status').getByText('1 new shared item', { exact: true }).waitFor()
  console.log('• unread badge and notification appear for the recipient')

  await recipient.getByRole('status').getByRole('button', { name: 'Review' }).click()
  const inbox = recipient.getByRole('dialog', { name: 'Shared with me' })
  await inbox.waitFor()
  await inbox.getByRole('button', { name: new RegExp(`^${TITLE}`) }).waitFor({ timeout: 30_000 })
  await recipient
    .getByRole('button', { name: 'Shared with me', exact: true })
    .waitFor({ timeout: 10_000 })
  console.log('• opening the inbox clears the unread state')

  await inbox.getByRole('button', { name: new RegExp(`^${TITLE}`) }).click()
  await inbox.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  await inbox.getByRole('button', { name: 'Add to my vault', exact: true }).click()
  const detail = recipient.getByRole('main')
  await detail.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  await detail.getByText(USERNAME, { exact: true }).first().waitFor()
  await detail.getByText(`Shared by ${OWNER_HANDLE}`, { exact: true }).waitFor()
  await detail.getByText('shared', { exact: true }).waitFor()
  console.log('• add to my vault creates a permanent local login')

  const reopen = await openInbox(recipient)
  await reopen.getByRole('button', { name: new RegExp(`^${TITLE}`) }).click()
  const already = reopen.getByRole('button', { name: 'Already in your vault', exact: true })
  await already.waitFor()
  assert(await already.isDisabled(), 'duplicate add button was not disabled')
  await closeDialog(reopen)
  console.log('• duplicate detection prevents a second copy')

  await owner.getByRole('button', { name: 'Shared by me', exact: true }).click()
  const sent = owner.getByRole('dialog', { name: 'Shared by me' })
  await sent.waitFor()
  await sent.getByText(TITLE, { exact: true }).waitFor({ timeout: 30_000 })
  await sent.getByText(RECIPIENT_HANDLE, { exact: true }).waitFor()
  await sent.getByRole('button', { name: 'Revoke', exact: true }).click()
  await sent.getByText('Nothing shared yet', { exact: true }).waitFor({ timeout: 30_000 })
  await closeDialog(sent)
  console.log('• shared-by-me view lists and revokes the active share')

  await recipient.evaluate(() => window.dispatchEvent(new Event('focus')))
  const revokedInbox = await openInbox(recipient)
  await revokedInbox
    .getByRole('heading', { name: 'Nothing shared with you', exact: true })
    .waitFor({ timeout: 30_000 })
  await closeDialog(revokedInbox)
  await recipient.getByRole('main').getByRole('heading', { name: TITLE, exact: true }).waitFor()
  console.log('• revoking removes the inbox share but keeps the saved vault copy')

  if (errors.length > 0) throw new Error(`console errors: ${errors.slice(0, 5).join(' | ')}`)
  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  await owner.screenshot({ path: 'e2e/artifacts/share-inbox-owner-failure.png' }).catch(() => {})
  await recipient
    .screenshot({ path: 'e2e/artifacts/share-inbox-recipient-failure.png' })
    .catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
