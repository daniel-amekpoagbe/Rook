import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const MASTER = 'mango-otter-vinyl-harbor-cobalt'

async function runScenario(choice, expected, absent) {
  const handle = `${choice}.${Date.now()}@example.com`
  const browser = await launchBrowser()
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  async function register(page) {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('input[name="handle"]', { timeout: 30000 })
    await page.getByRole('button', { name: 'Create vault', exact: true }).click()
    await page.waitForSelector('input[name="confirm-password"]')
    await page.fill('input[name="handle"]', handle)
    await page.fill('input[name="master-password"]', MASTER)
    await page.fill('input[name="confirm-password"]', MASTER)
    await page.getByRole('button', { name: 'Create encrypted vault' }).click()
    await page.waitForSelector('text=Your vault is unlocked', { timeout: 180000 })
  }

  async function unlock(page) {
    await page.waitForSelector('input[name="handle"]', { timeout: 30000 })
    await page.fill('input[name="handle"]', handle)
    await page.fill('input[name="master-password"]', MASTER)
    await page.locator('form').getByRole('button', { name: 'Unlock vault' }).click()
    await page.waitForSelector('input[aria-label="Search vault"]', { timeout: 180000 })
  }

  async function saveLogin(page, title) {
    await page.getByRole('button', { name: 'New item' }).click()
    await page.getByRole('menuitem', { name: 'Login' }).click()
    await page.waitForSelector('input[name="title"]')
    await page.fill('input[name="title"]', title)
    await page.fill('input[name="username"]', `${title.toLowerCase().replaceAll(' ', '.')}@example.com`)
    await page.fill('input[name="password"]', 'secret')
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/_serverFn/'),
      { timeout: 30000 },
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const response = await responsePromise
    if (response.status() !== 200) throw new Error(`saving ${title} returned HTTP ${response.status()}`)
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
  }

  async function visible(page, title) {
    return (await page.getByText(title, { exact: true }).count()) > 0
  }

  try {
    const A1 = 'Choice alpha one'
    const A2 = 'Choice alpha two'
    const B1 = 'Choice beta one'

    await register(pageA)
    await saveLogin(pageA, A1)
    await pageB.goto(BASE, { waitUntil: 'networkidle' })
    await unlock(pageB)
    await pageB.getByText(A1, { exact: true }).first().waitFor()
    await saveLogin(pageA, A2)

    await pageB.getByRole('button', { name: 'New item' }).click()
    await pageB.getByRole('menuitem', { name: 'Login' }).click()
    await pageB.waitForSelector('input[name="title"]')
    await pageB.fill('input[name="title"]', B1)
    await pageB.fill('input[name="username"]', 'choice.beta@example.com')
    await pageB.fill('input[name="password"]', 'secret')
    await pageB.getByRole('button', { name: 'Save', exact: true }).click()

    const dialog = pageB.getByRole('dialog', { name: 'Resolve vault conflict' })
    await dialog.waitFor({ timeout: 30000 })
    const label = choice === 'mine' ? 'Keep mine' : 'Use server'
    await dialog.getByRole('button', { name: label, exact: true }).click()
    await dialog.waitFor({ state: 'detached', timeout: 30000 })
    await pageB.locator('[data-sync="saved"]').waitFor({ timeout: 30000 })
    await pageB.waitForTimeout(400)

    for (const title of expected) {
      if (!(await visible(pageB, title))) throw new Error(`${choice}: tab B is missing ${title}`)
    }
    for (const title of absent) {
      if (await visible(pageB, title)) throw new Error(`${choice}: tab B still shows ${title}`)
    }

    await pageA.reload({ waitUntil: 'networkidle' })
    await pageA.waitForSelector('input[aria-label="Search vault"]', { timeout: 20000 })
    for (const title of expected) {
      if (!(await visible(pageA, title))) throw new Error(`${choice}: fresh tab A is missing ${title}`)
    }
    for (const title of absent) {
      if (await visible(pageA, title)) throw new Error(`${choice}: fresh tab A still shows ${title}`)
    }

    console.log(`• ${label} resolved the conflict as expected`)
  } finally {
    await browser.close()
  }
}

try {
  await runScenario('mine', ['Choice alpha one', 'Choice beta one'], ['Choice alpha two'])
  await runScenario('server', ['Choice alpha one', 'Choice alpha two'], ['Choice beta one'])
  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  process.exitCode = 1
}
