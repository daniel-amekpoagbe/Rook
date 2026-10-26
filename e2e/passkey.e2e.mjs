import {
  BASE,
  addVirtualAuthenticator,
  artifactPath,
  assertNoConsoleErrors,
  launchBrowser,
} from './helpers.mjs'

const HANDLE = process.env.HANDLE ?? `passkey.${Date.now().toString().slice(-6)}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const NEXT_MASTER = 'cedar-lantern-quartz-meadow-saffron'
let master = MASTER

const t0 = Date.now()
const log = (...args) => console.log(`• [${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args)

const browser = await launchBrowser()
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await context.newPage()

const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
page.on('response', (response) => {
  if (response.status() >= 400) {
    console.log('  ✗ response', response.status(), response.request().method(), response.url().slice(0, 120))
  }
})

let authenticator
try {
  authenticator = await addVirtualAuthenticator(page)
  log('Chromium virtual authenticator attached')

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 20000 })
  log(`lock screen hydrated at ${BASE}`)

  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.fill('input[name="confirm-password"]', MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 180000 })
  log('vault created')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.waitFor({ timeout: 10000 })
  await settings.getByRole('button', { name: 'Add passkey' }).click()

  const recoveryInput = settings.getByLabel('Recovery code')
  await recoveryInput.waitFor({ timeout: 60000 })
  const recoveryCode = await recoveryInput.inputValue()
  if (!/^[a-f0-9]{5}(?:-[a-f0-9]{5}){7}$/.test(recoveryCode)) {
    throw new Error(`unexpected recovery-code format: ${recoveryCode}`)
  }
  log('passkey registered and recovery code shown once')

  await settings.getByRole('button', { name: 'I saved it' }).click()
  await settings.getByRole('button', { name: 'Close panel' }).click()
  await settings.waitFor({ state: 'detached', timeout: 5000 })

  await page.getByRole('button', { name: 'Lock vault' }).click()
  await page.waitForSelector('input[name="handle"]', { timeout: 10000 })
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.locator('form').getByRole('button', { name: 'Unlock vault', exact: true }).click()

  await page.getByRole('button', { name: 'Use passkey', exact: true }).waitFor({ timeout: 60000 })
  log('master password alone did not unlock; passkey is required')
  await page.getByRole('button', { name: 'Use passkey', exact: true }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 60000 })
  log('passkey verified the session and unlocked the vault')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const rotationSettings = page.getByRole('dialog', { name: 'Settings' })
  await rotationSettings.waitFor({ timeout: 10000 })
  await rotationSettings.locator('#current-master-password').fill(master)
  await rotationSettings.locator('#next-master-password').fill(NEXT_MASTER)
  await rotationSettings.locator('#confirm-master-password').fill(NEXT_MASTER)
  await rotationSettings.getByRole('button', { name: 'Change password', exact: true }).click()
  await rotationSettings
    .getByText('Master password changed. The vault was re-encrypted with a new key.')
    .waitFor({ timeout: 60000 })
  master = NEXT_MASTER
  log('master-password rotation did not ask for the passkey and kept it registered')
  await rotationSettings.getByRole('button', { name: 'Close panel' }).click()
  await rotationSettings.waitFor({ state: 'detached', timeout: 5000 })

  await page.getByRole('button', { name: 'Lock vault' }).click()
  await page.waitForSelector('input[name="handle"]', { timeout: 10000 })
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', master)
  await page.locator('form').getByRole('button', { name: 'Unlock vault', exact: true }).click()
  await page.getByRole('button', { name: 'Use recovery code', exact: true }).click()
  await page.fill('input[name="recovery-code"]', recoveryCode)
  await page.getByRole('button', { name: 'Verify code', exact: true }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 60000 })
  log('recovery code verified the session and unlocked the vault')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settingsAgain = page.getByRole('dialog', { name: 'Settings' })
  await settingsAgain.waitFor({ timeout: 10000 })
  await settingsAgain.getByRole('button', { name: /^Remove Passkey/ }).click()
  await settingsAgain.getByRole('button', { name: 'Remove', exact: true }).click()
  await settingsAgain.getByText('No passkeys yet.').waitFor({ timeout: 10000 })
  log('last passkey removed and recovery code discarded')
  await settingsAgain.getByRole('button', { name: 'Close panel' }).click()
  await settingsAgain.waitFor({ state: 'detached', timeout: 5000 })

  await page.getByRole('button', { name: 'Lock vault' }).click()
  await page.waitForSelector('input[name="handle"]', { timeout: 10000 })
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', master)
  await page.locator('form').getByRole('button', { name: 'Unlock vault', exact: true }).click()
  await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 60000 })
  log('password-only unlock works again after removing the last passkey')

  assertNoConsoleErrors(consoleErrors)
  await page.screenshot({ path: artifactPath('e2e-passkey.png') })
  console.log('\nE2E_RESULT=PASS')
} catch (error) {
  console.error('\nE2E_RESULT=FAIL')
  console.error(error)
  await page.screenshot({ path: artifactPath('e2e-passkey-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  if (authenticator?.client) {
    await authenticator.client.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: authenticator.authenticatorId,
    }).catch(() => {})
  }
  await browser.close()
}
