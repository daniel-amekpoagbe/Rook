import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const STAMP = Date.now().toString().slice(-8)
const OWNER_HANDLE = `share.edge.owner.${STAMP}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const LONG_TITLE = `Long shared login ${'title '.repeat(8)}`.trim()
const LONG_USERNAME = `long.${'user'.repeat(12)}@example.com`
const LONG_PASSWORD = 'long-share-secret-9f2c'
const LONG_URL = `https://example.com/${'path-'.repeat(12)}`
const MINIMAL_TITLE = 'Password only'
const MINIMAL_PASSWORD = 'only-secret-123'

const browser = await launchBrowser()
const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const owner = await ownerContext.newPage()
const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const guest = await guestContext.newPage()
const errors = []

for (const [label, page] of [
  ['owner', owner],
  ['guest', guest],
]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${label}: pageerror: ${error.message}`))
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
  const dialog = owner.getByRole('dialog', { name: 'Share' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Create link', exact: true }).click()
  const field = dialog.getByRole('textbox', { name: 'Share link' })
  await field.waitFor({ timeout: 30_000 })
  const link = await field.inputValue()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  return link
}

try {
  await owner.goto(BASE, { waitUntil: 'networkidle' })
  await owner.waitForSelector('input[name="handle"]', { timeout: 30_000 })
  await owner.getByRole('button', { name: 'Create vault', exact: true }).click()
  await owner.waitForSelector('input[name="confirm-password"]')
  await owner.fill('input[name="handle"]', OWNER_HANDLE)
  await owner.fill('input[name="master-password"]', MASTER)
  await owner.fill('input[name="confirm-password"]', MASTER)
  await owner.getByRole('button', { name: 'Create encrypted vault' }).click()
  await owner.waitForSelector('input[aria-label="Search vault"]', { timeout: 180_000 })
  console.log('• owner account ready')

  await createLogin({
    title: LONG_TITLE,
    username: LONG_USERNAME,
    password: LONG_PASSWORD,
    url: LONG_URL,
  })
  const longLink = await shareCurrentLogin()
  await guest.goto(longLink, { waitUntil: 'networkidle' })
  await guest.getByRole('heading', { name: LONG_TITLE, exact: true }).waitFor({ timeout: 30_000 })
  await guest.getByText(LONG_USERNAME, { exact: true }).waitFor()
  await guest.getByText(LONG_URL, { exact: true }).waitFor()
  if (await guest.getByText(LONG_PASSWORD, { exact: true }).count()) {
    throw new Error('long password was visible before reveal')
  }
  const pageOverflow = await guest.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  if (pageOverflow) throw new Error('long shared values caused horizontal overflow')
  await guest.getByRole('button', { name: 'Reveal password' }).click()
  await guest.getByText(LONG_PASSWORD, { exact: true }).waitFor()
  await guest.screenshot({ path: artifactPath('share-edge-long.png') })
  console.log('• long title, username, password, and website render without overflow')

  await owner.getByRole('button', { name: 'Close item' }).click()
  await createLogin({ title: MINIMAL_TITLE, password: MINIMAL_PASSWORD })
  const minimalLink = await shareCurrentLogin()
  await guest.goto(minimalLink, { waitUntil: 'networkidle' })
  await guest.getByRole('heading', { name: MINIMAL_TITLE, exact: true }).waitFor({ timeout: 30_000 })
  if (await guest.getByText('username', { exact: true }).count()) {
    throw new Error('empty username rendered a label')
  }
  if (await guest.getByText('website', { exact: true }).count()) {
    throw new Error('empty website rendered a label')
  }
  if (await guest.getByText(MINIMAL_PASSWORD, { exact: true }).count()) {
    throw new Error('minimal password was visible before reveal')
  }
  await guest.getByRole('button', { name: 'Reveal password' }).click()
  await guest.getByText(MINIMAL_PASSWORD, { exact: true }).waitFor()
  await guest.screenshot({ path: artifactPath('share-edge-minimal.png') })
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
  await guest.screenshot({ path: artifactPath('share-edge-guest-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
