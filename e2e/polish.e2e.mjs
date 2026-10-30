import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const HANDLE = `polish.${Date.now().toString().slice(-7)}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const browser = await launchBrowser()
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: 'light',
})
const page = await context.newPage()
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function addLogin(title, username, password, tags) {
  await page.getByRole('button', { name: 'New item' }).click()
  await page.getByRole('menuitem', { name: 'Login' }).click()
  await page.waitForSelector('input[name="title"]')
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.fill('#entry-tags', tags)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForSelector(`h2:has-text("${title}")`, { timeout: 20000 })
}

async function moveSelectedToTrash() {
  await page.getByRole('button', { name: 'Delete item' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move to trash' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Move to trash', exact: true }).click()
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 20000 })

  assert(
    (await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).count()) === 0,
    'lock screen still shows the theme toggle',
  )
  console.log('• lock screen has no theme toggle')

  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.fill('input[name="confirm-password"]', MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('text=Your vault is unlocked', { timeout: 180000 })
  console.log('• vault created')

  await addLogin('Alpha Mail', 'alpha@example.com', 'weakpass', 'work, urgent')
  await addLogin('Beta Bank', 'beta@example.com', 'Tr0ub4dor&3-correct-horse', 'personal')

  await page.getByRole('region', { name: 'Item list' }).getByRole('button', { name: /^Alpha Mail/ }).click()
  await page.getByRole('button', { name: 'Toggle favorite' }).click()
  const listRegion = page.getByRole('region', { name: 'Item list' })
  await listRegion.getByText('Favorites', { exact: true }).waitFor({ timeout: 5000 })
  const listText = await listRegion.innerText()
  const upperList = listText.toUpperCase()
  assert(upperList.includes('FAVORITES') && upperList.includes('OTHER ITEMS'), `favorites are not grouped: ${listText}`)
  assert(upperList.indexOf('FAVORITES') < upperList.indexOf('ALPHA MAIL'), 'favorite group missing Alpha')
  console.log('• favorites group is visible')

  await page.locator('#entry-tag').selectOption('work')
  await page.waitForTimeout(200)
  const filteredText = await page.getByRole('region', { name: 'Item list' }).innerText()
  assert(filteredText.includes('Alpha Mail'), 'tag filter hid the matching item')
  assert(!filteredText.includes('Beta Bank'), 'tag filter did not hide the other item')
  await page.locator('#entry-tag').selectOption('all')
  await page.locator('#entry-sort').selectOption('updated')
  assert((await page.locator('#entry-sort').inputValue()) === 'updated', 'sort control did not change')
  console.log('• tag filter and sort controls work')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.waitFor()
  const focusState = await page.evaluate(() => {
    const modalRoot = document.getElementById('rook-modal-root')
    const background = Array.from(document.body.children).filter(
      (child) =>
        child !== modalRoot &&
        child instanceof HTMLElement &&
        !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'].includes(child.tagName),
    )
    return {
      activeInDialog: Boolean(modalRoot?.contains(document.activeElement)),
      backgroundInert: background.length > 0 && background.every((child) => child.inert),
      modalRoot: Boolean(modalRoot),
      background: background.map((child) => ({ tag: child.tagName, id: child.id, inert: child.inert })),
    }
  })
  assert(focusState.modalRoot, 'modal root was not created')
  assert(focusState.activeInDialog, 'initial focus was not inside the dialog')
  assert(focusState.backgroundInert, `background was not inert: ${JSON.stringify(focusState.background)}`)
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() => Boolean(document.querySelector('#rook-modal-root')?.contains(document.activeElement)))
    assert(inside, `focus escaped the dialog on tab ${i + 1}`)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const returned = await page.evaluate(() => {
    const modalRoot = document.getElementById('rook-modal-root')
    const background = Array.from(document.body.children).filter(
      (child) =>
        child !== modalRoot &&
        child instanceof HTMLElement &&
        !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'].includes(child.tagName),
    )
    return {
      label: document.activeElement?.textContent?.trim(),
      backgroundInert: background.some((child) => child.inert),
    }
  })
  assert(returned.label === 'Settings', `focus returned to ${returned.label}, expected Settings`)
  assert(!returned.backgroundInert, 'background stayed inert after closing')
  console.log('• modal traps focus, inerts the background, and restores focus')

  await page.getByRole('button', { name: 'Security audit', exact: true }).click()
  const audit = page.getByRole('dialog', { name: 'Security audit' })
  await audit.waitFor()
  await audit.getByRole('button', { name: 'Ignore', exact: true }).first().click()
  await page.waitForTimeout(300)
  await audit.getByText(/Ignored items \(1\)/).waitFor()
  await audit.getByText(/Ignored items \(1\)/).click()
  await audit.getByRole('button', { name: 'Restore', exact: true }).click()
  await page.waitForTimeout(300)
  assert((await audit.innerText()).includes('Findings'), 'audit did not restore the ignored item')
  await audit.getByRole('button', { name: 'New password' }).first().click()
  const generator = page.getByRole('dialog', { name: 'Generator' })
  await generator.waitFor({ timeout: 10000 })
  console.log('• audit ignore/restore and generate-new-password work')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.waitForTimeout(250)

  await page.getByRole('region', { name: 'Item list' }).getByRole('button', { name: /^Alpha Mail/ }).click()
  await moveSelectedToTrash()
  await page.getByRole('region', { name: 'Item list' }).getByRole('button', { name: /^Beta Bank/ }).click()
  await moveSelectedToTrash()
  await page.getByRole('button', { name: /^Trash, 2 items$/ }).click()
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await page.getByRole('button', { name: 'Restore selected' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /^Trash, 0 items$/ }).waitFor()
  console.log('• trash multi-select and bulk restore work')

  await page.getByRole('region', { name: 'Item list' }).getByRole('button', { name: /^Alpha Mail/ }).click()
  await moveSelectedToTrash()
  await page.getByRole('region', { name: 'Item list' }).getByRole('button', { name: /^Beta Bank/ }).click()
  await moveSelectedToTrash()
  await page.getByRole('button', { name: /^Trash, 2 items$/ }).click()
  await page.getByRole('button', { name: 'Empty trash' }).click()
  const emptyDialog = page.getByRole('dialog', { name: 'Empty trash' })
  await emptyDialog.waitFor()
  await emptyDialog.getByRole('button', { name: 'Empty trash', exact: true }).click()
  await page.getByText('Trash is empty', { exact: true }).first().waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: /^Trash, 0 items$/ }).waitFor()
  console.log('• empty trash works')

  if (errors.length) throw new Error(`console errors: ${errors.slice(0, 5).join(' | ')}`)
  console.log('E2E_RESULT=PASS')
} catch (error) {
  console.error('E2E_RESULT=FAIL')
  console.error(error)
  await page.screenshot({ path: artifactPath('polish-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
