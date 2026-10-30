import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const HANDLE = `conflict.${Date.now()}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const A1 = 'Alpha one'
const A2 = 'Alpha two'
const B1 = 'Beta one'

const browser = await launchBrowser()
const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const pageA = await contextA.newPage()
const pageB = await contextB.newPage()
const errors = []

for (const [name, page] of [
  ['A', pageA],
  ['B', pageB],
]) {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${name}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${name}: pageerror: ${error.message}`))
}

async function register(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 30000 })
  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.fill('input[name="confirm-password"]', MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('text=Your vault is unlocked', { timeout: 180000 })
}

async function unlock(page) {
  await page.waitForSelector('input[name="handle"]', { timeout: 30000 })
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.locator('form').getByRole('button', { name: 'Unlock vault' }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 180000 })
}

async function openNewLogin(page) {
  await page.getByRole('button', { name: 'New item' }).click()
  await page.getByRole('menuitem', { name: 'Login' }).click()
  await page.waitForSelector('input[name="title"]')
}

async function fillLogin(page, title) {
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="username"]', `${title.toLowerCase().replaceAll(' ', '.')}@example.com`)
  await page.fill('input[name="password"]', 'secret')
}

async function saveLogin(page, title) {
  await openNewLogin(page)
  await fillLogin(page, title)
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().includes('/_serverFn/'),
    { timeout: 30000 },
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const response = await responsePromise
  if (response.status() !== 200) {
    throw new Error(`saving ${title} returned HTTP ${response.status()}`)
  }
  await page.getByRole('heading', { name: title, exact: true }).waitFor()
}

async function waitForItem(page, title) {
  await page.getByText(title, { exact: true }).first().waitFor({ timeout: 30000 })
}

try {
  await register(pageA)
  console.log('• vault created')
  await saveLogin(pageA, A1)
  console.log('• first item saved on tab A')

  await pageB.goto(BASE, { waitUntil: 'networkidle' })
  await unlock(pageB)
  await waitForItem(pageB, A1)
  console.log('• tab B unlocked against the first version')

  await saveLogin(pageA, A2)
  console.log('• tab A saved a second item')

  await openNewLogin(pageB)
  await fillLogin(pageB, B1)
  await pageB.getByRole('button', { name: 'Save', exact: true }).click()
  const conflict = pageB.getByRole('dialog', { name: 'Resolve vault conflict' })
  await conflict.waitFor({ timeout: 30000 })
  console.log('• tab B detected the version conflict')

  await conflict.getByRole('button', { name: /Merge items/ }).click()
  await conflict.waitFor({ state: 'detached', timeout: 30000 })
  await pageB.locator('[data-sync="saved"]').waitFor({ timeout: 30000 })
  await waitForItem(pageB, A1)
  await waitForItem(pageB, A2)
  await waitForItem(pageB, B1)
  console.log('• merge kept items from both tabs')

  await pageA.reload({ waitUntil: 'networkidle' })
  await pageA.waitForSelector('input[aria-label="Search vault"]', { timeout: 20000 })
  await waitForItem(pageA, A1)
  await waitForItem(pageA, A2)
  await waitForItem(pageA, B1)
  console.log('• merged vault is visible after a fresh unlock')

  const unexpected = errors.filter(
    (error) => !/CONFLICT|Failed to load resource|500 \(Internal Server Error\)/.test(error),
  )
  if (unexpected.length > 0) {
    console.log('CONSOLE ERRORS:')
    for (const error of unexpected.slice(0, 10)) console.log('  !', error)
    throw new Error('unexpected console errors were recorded')
  }

  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  await pageB.screenshot({ path: artifactPath('conflict-recovery-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
