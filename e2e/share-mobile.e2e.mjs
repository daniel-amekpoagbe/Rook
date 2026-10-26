import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const STAMP = Date.now().toString().slice(-8)
const OWNER_HANDLE = `mobile.share.owner.${STAMP}@example.com`
const RECIPIENT_HANDLE = `mobile.share.recipient.${STAMP}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const TITLE = 'Mobile shared login'
const USERNAME = 'mobile@example.com'
const PASSWORD = 'mobile-share-secret-42'

const browser = await launchBrowser()
const ownerContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})
const owner = await ownerContext.newPage()
const recipientContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})
const recipient = await recipientContext.newPage()
const errors = []

for (const [label, page] of [
  ['owner', owner],
  ['recipient', recipient],
]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${label}: pageerror: ${error.message}`))
}

async function createAccount(page, handle) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', handle)
  await page.fill('input[name="master-password"]', MASTER)
  await page.fill('input[name="confirm-password"]', MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 180_000 })
}

async function openMobileNav(page) {
  const open = page.getByRole('button', { name: 'Open navigation' })
  if (await open.isVisible().catch(() => false)) await open.click()
}

async function openInbox(page) {
  await openMobileNav(page)
  await page.getByRole('button', { name: 'Shared with me', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Shared with me' })
  await dialog.waitFor()
  return dialog
}

async function closeDialog(dialog) {
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
}

try {
  await createAccount(owner, OWNER_HANDLE)
  await owner.getByRole('button', { name: 'New item' }).click()
  await owner.getByRole('menuitem', { name: 'Login' }).click()
  await owner.fill('input[name="title"]', TITLE)
  await owner.fill('input[name="username"]', USERNAME)
  await owner.fill('input[name="password"]', PASSWORD)
  await owner.getByRole('button', { name: 'Save', exact: true }).click()
  await owner.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  console.log('• mobile owner vault and login created')

  await createAccount(recipient, RECIPIENT_HANDLE)
  const emptyInbox = await openInbox(recipient)
  await emptyInbox
    .getByRole('heading', { name: 'Nothing shared with you', exact: true })
    .waitFor({ timeout: 30_000 })
  await closeDialog(emptyInbox)
  console.log('• mobile recipient identity ready')

  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const shareDialog = owner.getByRole('dialog', { name: 'Share password' })
  await shareDialog.waitFor()
  await owner.screenshot({ path: artifactPath('share-dialog-mobile.png') })
  await shareDialog.getByLabel('Recipient handle').fill(RECIPIENT_HANDLE)
  await shareDialog.getByRole('button', { name: 'Share', exact: true }).click()
  await shareDialog.getByText(`Shared with ${RECIPIENT_HANDLE}.`, { exact: true }).waitFor({
    timeout: 30_000,
  })
  await owner.screenshot({ path: artifactPath('share-dialog-mobile-created.png') })
  await closeDialog(shareDialog)
  console.log('• mobile owner shared the login with a recipient handle')

  const inbox = await openInbox(recipient)
  await inbox.getByRole('button', { name: new RegExp(`^${TITLE}`) }).waitFor({
    timeout: 30_000,
  })
  await inbox.screenshot({ path: artifactPath('share-inbox-mobile.png') })
  await inbox.getByRole('button', { name: new RegExp(`^${TITLE}`) }).click()
  await inbox.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  await inbox.getByText(USERNAME, { exact: true }).waitFor()
  if (await inbox.getByText(PASSWORD, { exact: true }).count()) {
    throw new Error('mobile password was visible before reveal')
  }
  await inbox.getByRole('button', { name: 'Reveal password' }).click()
  await inbox.getByText(PASSWORD, { exact: true }).waitFor()
  const overflow = await recipient.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  if (overflow) throw new Error('mobile shared item caused horizontal overflow')
  await recipient.screenshot({ path: artifactPath('share-inbox-mobile-detail.png') })
  console.log('• mobile recipient decrypted the shared login')

  if (errors.length > 0) {
    console.log('CONSOLE ERRORS:')
    for (const error of errors.slice(0, 10)) console.log('  !', error)
    throw new Error('console errors were recorded')
  }

  console.log('MOBILE_RESULT=PASS')
} catch (error) {
  console.error('MOBILE_RESULT=FAIL')
  console.error(error)
  await owner.screenshot({ path: artifactPath('share-mobile-owner-failure.png') }).catch(() => {})
  await recipient
    .screenshot({ path: artifactPath('share-mobile-recipient-failure.png') })
    .catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
