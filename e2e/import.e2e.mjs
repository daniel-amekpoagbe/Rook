import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const HANDLE = `import.${Date.now()}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'

const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

const csv = [
  'name,url,username,password,note',
  'GitHub,https://github.com,octocat,secret,work account',
].join('\n')

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

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.waitForSelector('text=Import from another manager', { timeout: 10000 })
  await page.setInputFiles('input[aria-label="Import CSV or JSON file"]', {
    name: 'chrome.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await page.waitForSelector('text=looks like a', { timeout: 10000 })
  await page.waitForSelector('text=1 item', { timeout: 10000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.waitForSelector('text=Imported 1 item from Chrome.', { timeout: 10000 })
  console.log('• Chrome CSV previewed and imported')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.waitForSelector('text=GitHub', { timeout: 10000 })
  console.log('• imported entry visible in the vault')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.waitForSelector('text=Import from another manager', { timeout: 10000 })
  await page.setInputFiles('input[aria-label="Import CSV or JSON file"]', {
    name: 'chrome.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await page.waitForSelector('text=1 item', { timeout: 10000 })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.waitForSelector('text=Skipped 1 duplicate or unsupported item.', { timeout: 10000 })
  console.log('• duplicate import skipped')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 30000 })
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.locator('form').getByRole('button', { name: 'Unlock' }).click()
  await page.waitForSelector('text=Select an item', { timeout: 180000 })
  await page.waitForSelector('text=GitHub', { timeout: 10000 })
  console.log('• imported entry survives lock/unlock')

  if (errors.length > 0) {
    console.log('CONSOLE ERRORS:')
    for (const error of errors.slice(0, 10)) console.log('  !', error)
    throw new Error('console errors were recorded')
  }

  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  await page.screenshot({ path: artifactPath('import-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
