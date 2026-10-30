import { BASE, launchBrowser } from './helpers.mjs'

const STAMP = Date.now().toString().slice(-8)
const OWNER_HANDLE = `inbox.owner.${STAMP}@example.com`
const OWNER_MASTER = 'mango-otter-vinyl-harbor-cobalt'
const TITLE = 'Inbox shared login'
const USERNAME = 'inbox@example.com'
const PASSWORD = 'inbox-secret-7f3a9c'

const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []

page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(error.message))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function closeDialog(dialog) {
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await dialog.waitFor({ state: 'detached' })
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', OWNER_HANDLE)
  await page.fill('input[name="master-password"]', OWNER_MASTER)
  await page.fill('input[name="confirm-password"]', OWNER_MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 180_000 })

  await page.getByRole('button', { name: 'New item' }).click()
  await page.getByRole('menuitem', { name: 'Login' }).click()
  await page.waitForSelector('input[name="title"]')
  await page.fill('input[name="title"]', TITLE)
  await page.fill('input[name="username"]', USERNAME)
  await page.fill('input[name="password"]', PASSWORD)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  console.log('• owner vault and login created')

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const shareDialog = page.getByRole('dialog', { name: 'Share' })
  await shareDialog.waitFor()
  await shareDialog.getByRole('button', { name: 'Create link', exact: true }).click()
  await shareDialog.getByRole('textbox', { name: 'Share link' }).waitFor({ timeout: 30_000 })
  await closeDialog(shareDialog)
  console.log('• owner created a read-only link')

  await page.getByRole('button', { name: 'Shared by me', exact: true }).click()
  const sent = page.getByRole('dialog', { name: 'Shared by me' })
  await sent.waitFor()
  await sent.getByText(TITLE, { exact: true }).waitFor({ timeout: 30_000 })
  await sent.getByText('Read-only link', { exact: true }).waitFor()
  assert((await page.getByRole('button', { name: 'Shared with me' }).count()) === 0, 'inbox is still in the navigation')
  await sent.getByRole('button', { name: 'Revoke', exact: true }).click()
  await sent.getByText('Nothing shared yet', { exact: true }).waitFor({ timeout: 30_000 })
  await closeDialog(sent)
  console.log('• shared-by-me view lists and revokes the link')

  if (errors.length > 0) throw new Error(`console errors: ${errors.slice(0, 5).join(' | ')}`)
  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  await page.screenshot({ path: 'e2e/artifacts/share-inbox-owner-failure.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
