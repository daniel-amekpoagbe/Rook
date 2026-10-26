import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const HANDLE = `history.${Date.now()}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const TITLE = 'History item'
const OLD_PASSWORD = 'old-secret'
const NEW_PASSWORD = 'new-secret'

const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

async function unlock() {
  await page.waitForSelector('input[name="handle"]', { timeout: 30000 })
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.locator('form').getByRole('button', { name: 'Unlock vault' }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 180000 })
}

async function openTrash() {
  await page.getByRole('button', { name: /^Trash, \d+ items?$/ }).click()
}

async function moveSelectedToTrash() {
  await page.getByRole('button', { name: 'Delete item' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move to trash' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Move to trash', exact: true }).click()
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 30000 })
  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.fill('input[name="confirm-password"]', MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('text=Your vault is unlocked', { timeout: 180000 })
  console.log('• temp vault created')

  await page.getByRole('button', { name: 'New item' }).click()
  await page.getByRole('menuitem', { name: 'Login' }).click()
  await page.waitForSelector('input[name="title"]')
  await page.fill('input[name="title"]', TITLE)
  await page.fill('input[name="username"]', 'tester@example.com')
  await page.fill('input[name="password"]', OLD_PASSWORD)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  console.log('• item created')

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.waitForSelector('input[name="password"]')
  await page.fill('input[name="password"]', NEW_PASSWORD)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('heading', { name: 'History', exact: true }).waitFor()
  await page.getByText('1 previous version', { exact: true }).waitFor()
  console.log('• edit created a history version')

  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByText('2 previous versions', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const restoredPassword = await page.locator('input[name="password"]').inputValue()
  if (restoredPassword !== OLD_PASSWORD) {
    throw new Error(`history restore produced ${restoredPassword}, expected ${OLD_PASSWORD}`)
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  console.log('• history restored the previous password')

  await moveSelectedToTrash()
  await page.getByRole('button', { name: /^Trash, 1 item$/ }).waitFor()
  await page.getByRole('button', { name: /^Trash, 1 item$/ }).click()
  await page.getByRole('button', { name: new RegExp(TITLE) }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).waitFor()
  console.log('• item moved to trash')

  await page.reload({ waitUntil: 'networkidle' })
  await unlock()
  await page.getByRole('button', { name: /^Trash, 1 item$/ }).click()
  await page.getByRole('button', { name: new RegExp(TITLE) }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.getByRole('heading', { name: TITLE, exact: true }).waitFor()
  await page.getByRole('button', { name: /^Trash, 0 items$/ }).waitFor()
  console.log('• trash survived reload and restored the item')

  await moveSelectedToTrash()
  await page.getByRole('button', { name: /^Trash, 1 item$/ }).click()
  await page.getByRole('button', { name: new RegExp(TITLE) }).click()
  await page.getByRole('button', { name: 'Delete permanently' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete permanently' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Delete permanently', exact: true }).click()
  await page.getByText('Trash is empty', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: /^Trash, 0 items$/ }).waitFor()
  console.log('• permanent delete removed the item and its trash entry')

  if (errors.length > 0) {
    console.log('CONSOLE ERRORS:')
    for (const error of errors.slice(0, 10)) console.log('  !', error)
    throw new Error('console errors were recorded')
  }

  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  await page.screenshot({ path: artifactPath('history-trash-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
