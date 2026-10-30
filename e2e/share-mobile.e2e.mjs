import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const STAMP = Date.now().toString().slice(-8)
const OWNER_HANDLE = `mobile.share.owner.${STAMP}@example.com`
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
const guestContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})
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

  await owner.getByRole('button', { name: 'New item' }).click()
  await owner.getByRole('menuitem', { name: 'Login' }).click()
  await owner.fill('input[name="title"]', TITLE)
  await owner.fill('input[name="username"]', USERNAME)
  await owner.fill('input[name="password"]', PASSWORD)
  await owner.getByRole('button', { name: 'Save', exact: true }).click()
  await owner.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  console.log('• mobile owner vault and login created')

  await owner.getByRole('button', { name: 'Share', exact: true }).click()
  const shareDialog = owner.getByRole('dialog', { name: 'Share' })
  await shareDialog.waitFor()
  await owner.screenshot({ path: artifactPath('share-dialog-mobile.png') })
  await shareDialog.getByRole('button', { name: 'Create link', exact: true }).click()
  const field = shareDialog.getByRole('textbox', { name: 'Share link' })
  await field.waitFor({ timeout: 30_000 })
  const link = await field.inputValue()
  await owner.screenshot({ path: artifactPath('share-dialog-mobile-created.png') })
  await shareDialog.getByRole('button', { name: 'Close dialog' }).click()
  console.log('• mobile owner created a read-only link')

  await guest.goto(link, { waitUntil: 'networkidle' })
  await guest.getByRole('heading', { name: TITLE, exact: true }).waitFor({ timeout: 30_000 })
  await guest.getByText(USERNAME, { exact: true }).waitFor()
  await guest.getByText(/Read only/).waitFor()
  if (await guest.getByText(PASSWORD, { exact: true }).count()) {
    throw new Error('mobile password was visible before reveal')
  }
  await guest.getByRole('button', { name: 'Reveal password' }).click()
  await guest.getByText(PASSWORD, { exact: true }).waitFor()
  const overflow = await guest.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  if (overflow) throw new Error('mobile shared item caused horizontal overflow')
  await guest.screenshot({ path: artifactPath('share-link-mobile.png') })
  console.log('• mobile guest viewed the shared login')

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
  await guest.screenshot({ path: artifactPath('share-mobile-guest-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
