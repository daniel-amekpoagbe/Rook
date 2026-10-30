import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const HANDLE = process.env.HANDLE ?? `e2e.${Date.now().toString().slice(-6)}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

const t0 = Date.now()
const log = (...args) => console.log(`• [${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args)

const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()

const consoleErrors = []
const requestBodies = []
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
page.on('request', (request) => {
  const body = request.postData()
  if (body) requestBodies.push(body)
})
page.on('response', (r) => { if (r.status() >= 400) console.log('  ✗ response', r.status(), r.request().method(), r.url().slice(0, 120)) })

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 20000 })
  log('lock screen hydrated')

  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', HANDLE)

  await page.fill('input[name="master-password"]', HANDLE)
  await page.fill('input[name="confirm-password"]', HANDLE)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector("text=Your master password can't be your username.", { timeout: 5000 })
  log('password equal to username rejected locally')

  await page.fill('input[name="master-password"]', MASTER)
  await page.fill('input[name="confirm-password"]', MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('text=Your vault is unlocked', { timeout: 180000 })
  log('vault created and unlocked')

  await page.getByRole('main').getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForSelector('input[name="title"]', { timeout: 10000 })
  await page.fill('input[name="title"]', 'GitHub')
  await page.fill('input[name="username"]', 'daniel@example.com')
  await page.fill('input[name="password"]', 'Tr0ub4dor&3-correct-horse')
  await page.fill('input[name="url"]', 'https://github.com/login')
  await page.fill('textarea[name="notes"]', 'Personal account, 2FA enabled.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForSelector('h2:has-text("GitHub")', { timeout: 20000 })
  log('entry saved, detail view rendered')

  await page.waitForSelector('button:has-text("Copy password")', { timeout: 5000 })
  log('copy controls present')

  await page.getByRole('button', { name: 'Security audit', exact: true }).click()
  await page.waitForSelector('text=Security audit', { timeout: 10000 })
  await page.waitForSelector('text=No one-time password set up', { timeout: 5000 })
  log('audit flags the missing 2FA')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.waitForSelector('input[name="totp"]', { timeout: 10000 })
  await page.fill('input[name="totp"]', TOTP_SECRET)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForSelector('[data-testid="totp-code"]', { timeout: 10000 })
  const detailCode = (await page.locator('[data-testid="totp-code"]').first().innerText()).trim()
  if (!/^\d{3} \d{3}$/.test(detailCode)) throw new Error(`unexpected TOTP code: ${detailCode}`)
  if ((await page.content()).includes(TOTP_SECRET)) {
    throw new Error('plaintext authenticator secret is in the DOM')
  }
  log('authenticator secret saved and a live code rendered')

  await page.getByRole('button', { name: /Authenticator/ }).click()
  const authenticator = page.getByRole('dialog', { name: 'Authenticator' })
  await authenticator.waitFor({ timeout: 10000 })
  await authenticator.locator('[data-testid="authenticator-code"]').first().waitFor({ timeout: 10000 })
  const modalCode = (
    await authenticator.locator('[data-testid="authenticator-code"]').first().innerText()
  ).trim()
  if (!/^\d{3} \d{3}$/.test(modalCode)) throw new Error(`unexpected authenticator code: ${modalCode}`)
  if ((await page.content()).includes(TOTP_SECRET)) {
    throw new Error('plaintext authenticator secret is in the authenticator dialog')
  }
  if (requestBodies.some((body) => body.includes(TOTP_SECRET))) {
    throw new Error('plaintext authenticator secret reached the network')
  }
  log('authenticator dialog shows the code without exposing the secret')
  await page.screenshot({ path: artifactPath('e2e-authenticator.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.screenshot({ path: artifactPath('e2e-vault.png') })

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('text=Select an item', { timeout: 20000 })
  log('reload keeps the vault unlocked')

  await page.getByRole('button', { name: 'Lock vault' }).click()
  await page.waitForSelector('input[name="handle"]', { timeout: 20000 })
  log('explicit lock returns to the lock screen')

  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', 'definitely-the-wrong-password')
  await page.locator('form').getByRole('button', { name: 'Unlock' }).click()
  await page.waitForSelector('text=Wrong master password.', { timeout: 180000 })
  log('wrong password rejected')

  await page.fill('input[name="master-password"]', MASTER)
  await page.locator('form').getByRole('button', { name: 'Unlock' }).click()
  await page.waitForSelector('text=Select an item', { timeout: 180000 })
  await page.waitForSelector('text=GitHub', { timeout: 10000 })
  log('correct password decrypts the persisted vault')

  await page.getByText('GitHub', { exact: true }).click()
  await page.waitForSelector('[data-testid="totp-code"]', { timeout: 10000 })
  if ((await page.content()).includes(TOTP_SECRET)) {
    throw new Error('plaintext authenticator secret is in the DOM after unlock')
  }
  log('authenticator secret survives lock/unlock without appearing in the DOM')

  await page.getByRole('button', { name: 'New item' }).click()
  await page.getByRole('menuitem', { name: 'Login' }).click()
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.waitForSelector('text=Password generator', { timeout: 5000 })
  log('generator modal opens')
  await page.keyboard.press('Escape')

  const themeButton = page.getByRole('button', { name: /Switch to dark theme/ })
  await themeButton.click()
  const dark = await page.evaluate(() => document.documentElement.dataset.theme)
  if (dark !== 'dark') throw new Error('theme toggle did not switch to dark')
  log('theme toggle switches to dark')
  await page.getByRole('button', { name: /Switch to light theme/ }).click()

  if (consoleErrors.length) {
    console.log('\nCONSOLE ERRORS:')
    for (const error of consoleErrors.slice(0, 12)) console.log('  !', error)
  } else {
    console.log('\nno console errors')
  }
  console.log('\nE2E_RESULT=PASS')
} catch (error) {
  console.error('\nE2E_RESULT=FAIL')
  console.error(error)
  await page.screenshot({ path: artifactPath('e2e-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
