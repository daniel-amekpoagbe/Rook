import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const HANDLE = `share.edge.${Date.now()}@example.com`
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
const recipientContext = await browser.newContext({ viewport: { width: 960, height: 900 } })
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

async function createVault() {
  await owner.goto(BASE, { waitUntil: 'networkidle' })
  await owner.waitForSelector('input[name="handle"]', { timeout: 30_000 })
  await owner.getByRole('button', { name: 'Create vault', exact: true }).click()
  await owner.waitForSelector('input[name="confirm-password"]')
  await owner.fill('input[name="handle"]', HANDLE)
  await owner.fill('input[name="master-password"]', MASTER)
  await owner.fill('input[name="confirm-password"]', MASTER)
  await owner.getByRole('button', { name: 'Create encrypted vault' }).click()
  await owner.waitForSelector('input[aria-label="Search vault"]', { timeout: 180_000 })
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

async function createShareLink(title) {
  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = owner.getByRole('dialog', { name: 'Share password' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Create link' }).click()
  const link = await dialog.getByLabel('Share link').inputValue()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  return { link, title }
}

async function openAsRecipient(link, title) {
  await recipient.goto(link, { waitUntil: 'networkidle' })
  await recipient.getByRole('heading', { name: 'Someone shared an item with you.' }).waitFor({ timeout: 30_000 })
  await recipient.getByRole('heading', { name: title, exact: true }).waitFor()
}

try {
  await createVault()
  console.log('• temporary vault created')

  await createLogin({
    title: LONG_TITLE,
    username: LONG_USERNAME,
    password: LONG_PASSWORD,
    url: LONG_URL,
  })
  const longShare = await createShareLink(LONG_TITLE)
  await openAsRecipient(longShare.link, LONG_TITLE)
  await recipient.getByText(LONG_USERNAME, { exact: true }).waitFor()
  await recipient.getByText(LONG_URL, { exact: true }).waitFor()
  if (await recipient.getByText(LONG_PASSWORD, { exact: true }).count()) {
    throw new Error('long password was visible before reveal')
  }
  const overflow = await recipient.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  if (overflow) throw new Error('long shared values caused horizontal overflow')
  await recipient.getByRole('button', { name: 'Reveal password' }).click()
  await recipient.getByText(LONG_PASSWORD, { exact: true }).waitFor()
  await recipient.screenshot({ path: artifactPath('share-edge-long.png'), fullPage: true })
  console.log('• long title, username, password, and website render without overflow')

  await createLogin({
    title: MINIMAL_TITLE,
    password: MINIMAL_PASSWORD,
  })
  const minimalShare = await createShareLink(MINIMAL_TITLE)
  await openAsRecipient(minimalShare.link, MINIMAL_TITLE)
  if (await recipient.getByText('username', { exact: true }).count()) {
    throw new Error('empty username rendered a label')
  }
  if (await recipient.getByText('website', { exact: true }).count()) {
    throw new Error('empty website rendered a label')
  }
  if (await recipient.getByText(MINIMAL_PASSWORD, { exact: true }).count()) {
    throw new Error('minimal password was visible before reveal')
  }
  await recipient.getByRole('button', { name: 'Reveal password' }).click()
  await recipient.getByText(MINIMAL_PASSWORD, { exact: true }).waitFor()
  await recipient.screenshot({ path: artifactPath('share-edge-minimal.png'), fullPage: true })
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
