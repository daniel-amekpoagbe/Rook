import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const HANDLE = `mobile.share.${Date.now()}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const TITLE = 'Mobile shared login'
const PASSWORD = 'mobile-share-secret-42'

const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const recipientContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const recipient = await recipientContext.newPage()

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]')
  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.fill('input[name="confirm-password"]', MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 180_000 })
  await page.getByRole('button', { name: 'New item' }).click()
  await page.getByRole('menuitem', { name: 'Login' }).click()
  await page.fill('input[name="title"]', TITLE)
  await page.fill('input[name="username"]', 'mobile@example.com')
  await page.fill('input[name="password"]', PASSWORD)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share password' })
  await dialog.waitFor()
  await page.screenshot({ path: artifactPath('share-dialog-mobile.png') })
  await dialog.getByRole('button', { name: 'Create link' }).click()
  const link = await dialog.getByLabel('Share link').inputValue()
  await page.screenshot({ path: artifactPath('share-dialog-mobile-created.png') })
  await recipient.goto(link, { waitUntil: 'networkidle' })
  await recipient.getByRole('heading', { name: 'Someone shared an item with you.' }).waitFor({ timeout: 30_000 })
  await recipient.getByRole('button', { name: 'Reveal password' }).click()
  await recipient.getByText(PASSWORD, { exact: true }).waitFor()
  await recipient.screenshot({ path: artifactPath('share-page-mobile.png') })
  console.log('MOBILE_RESULT=PASS')
} catch (error) {
  console.error('MOBILE_RESULT=FAIL')
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
}
