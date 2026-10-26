import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const STAMP = Date.now().toString().slice(-8)
const OWNER_HANDLE = `share.edge.owner.${STAMP}@example.com`
const RECIPIENT_HANDLE = `share.edge.recipient.${STAMP}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const LONG_TITLE = `Long shared login ${'title '.repeat(18)}`.trim()
const LONG_USERNAME = `long.${'user'.repeat(36)}@example.com`
const LONG_PASSWORD = 'long-share-secret-9f2c'
const LONG_URL = `https://example.com/${'very-long-path-'.repeat(20)}`
const MINIMAL_TITLE = 'Password only'
const MINIMAL_PASSWORD = 'only-secret-123'

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

async function createLogin({ title, username, password, url }) {
  await owner.getByRole('button', { name: 'New item' }).click()
  await owner.getByRole('menuitem', { name: 'Login' }).click()
  await owner.waitForSelector('input[name="title"]')
  await owner.fill('input[name="title"]', title)
  if (username) await owner.fill('input[name="username"]', username)
  await owner.fill('input[name="password"]', password)
  if (url) await owner.fill('input[name="url"]', url)
  await owner.getByRole('button', { name: 'Save', exact: true }).click()
  await owner.getByRole('heading', { name: title, exact: true }).waitFor()
}

async function shareCurrentLogin() {
  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = owner.getByRole('dialog', { name: 'Share password' })
  await dialog.waitFor()
  await dialog.getByLabel('Recipient handle').fill(RECIPIENT_HANDLE)
  await dialog.getByRole('button', { name: 'Share', exact: true }).click()
  await dialog.getByText(`Shared with ${RECIPIENT_HANDLE}.`, { exact: true }).waitFor({
    timeout: 30_000,
  })
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
}

async function openInbox() {
  await recipient.getByRole('button', { name: 'Shared with me', exact: true }).click()
  const dialog = recipient.getByRole('dialog', { name: 'Shared with me' })
  await dialog.waitFor()
  return dialog
}

async function closeDialog(dialog) {
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
}

async function openItem(dialog, title) {
  await dialog.getByRole('button', { name: new RegExp(`^${title}`) }).click()
  await dialog.getByRole('heading', { name: title, exact: true }).waitFor()
}

try {
  await createAccount(owner, OWNER_HANDLE)
  await createAccount(recipient, RECIPIENT_HANDLE)
  const emptyInbox = await openInbox()
  await emptyInbox
    .getByRole('heading', { name: 'Nothing shared with you', exact: true })
    .waitFor({ timeout: 30_000 })
  await closeDialog(emptyInbox)
  console.log('• owner and recipient accounts ready')

  await createLogin({
    title: LONG_TITLE,
    username: LONG_USERNAME,
    password: LONG_PASSWORD,
    url: LONG_URL,
  })
  await shareCurrentLogin()

  const longInbox = await openInbox()
  await openItem(longInbox, LONG_TITLE)
  await longInbox.getByText(LONG_USERNAME, { exact: true }).waitFor()
  await longInbox.getByText(LONG_URL, { exact: true }).waitFor()
  if (await longInbox.getByText(LONG_PASSWORD, { exact: true }).count()) {
    throw new Error('long password was visible before reveal')
  }
  const pageOverflow = await recipient.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  const dialogOverflow = await longInbox.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  )
  if (pageOverflow || dialogOverflow) {
    throw new Error('long shared values caused horizontal overflow')
  }
  await longInbox.getByRole('button', { name: 'Reveal password' }).click()
  await longInbox.getByText(LONG_PASSWORD, { exact: true }).waitFor()
  await longInbox.screenshot({ path: artifactPath('share-edge-long.png') })
  await closeDialog(longInbox)
  console.log('• long title, username, password, and website render without overflow')

  await createLogin({
    title: MINIMAL_TITLE,
    password: MINIMAL_PASSWORD,
  })
  await shareCurrentLogin()

  const minimalInbox = await openInbox()
  await openItem(minimalInbox, MINIMAL_TITLE)
  if (await minimalInbox.getByText('username', { exact: true }).count()) {
    throw new Error('empty username rendered a label')
  }
  if (await minimalInbox.getByText('website', { exact: true }).count()) {
    throw new Error('empty website rendered a label')
  }
  if (await minimalInbox.getByText(MINIMAL_PASSWORD, { exact: true }).count()) {
    throw new Error('minimal password was visible before reveal')
  }
  await minimalInbox.getByRole('button', { name: 'Reveal password' }).click()
  await minimalInbox.getByText(MINIMAL_PASSWORD, { exact: true }).waitFor()
  await minimalInbox.screenshot({ path: artifactPath('share-edge-minimal.png') })
  await closeDialog(minimalInbox)
  console.log('• a password-only item omits the username and website sections')

  if (errors.length > 0) {
    console.log('CONSOLE ERRORS:')
    for (const error of errors.slice(0, 10)) console.log('  !', error)
    throw new Error('console errors were recorded')
  }

  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  await owner.screenshot({ path: artifactPath('share-edge-owner-failure.png') }).catch(() => {})
  await recipient.screenshot({ path: artifactPath('share-edge-recipient-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
