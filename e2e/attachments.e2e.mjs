import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { BASE, artifactPath, launchBrowser } from './helpers.mjs'

const HANDLE = process.env.HANDLE ?? `attach.${Date.now().toString().slice(-6)}@example.com`
const MASTER = 'mango-otter-vinyl-harbor-cobalt'
const FILE_NAME = 'secret.txt'
const FILE_CONTENT = Buffer.from(
  `attachment-secret\n${'A'.repeat(1024 * 1024)}\n`,
  'utf8',
)

const t0 = Date.now()
const log = (...args) => console.log(`• [${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args)

const browser = await launchBrowser()
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
})
const page = await context.newPage()

const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

try {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 20000 })

  await page.getByRole('button', { name: 'Create vault', exact: true }).click()
  await page.waitForSelector('input[name="confirm-password"]')
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.fill('input[name="confirm-password"]', MASTER)
  await page.getByRole('button', { name: 'Create encrypted vault' }).click()
  await page.waitForSelector('text=Your vault is unlocked', { timeout: 180000 })
  log('vault created')

  await page.getByRole('main').getByRole('button', { name: 'Login', exact: true }).click()
  await page.waitForSelector('input[name="title"]', { timeout: 10000 })
  await page.fill('input[name="title"]', 'GitHub')
  await page.fill('input[name="username"]', 'daniel@example.com')
  await page.fill('input[name="password"]', 'Tr0ub4dor&3-correct-horse')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForSelector('h2:has-text("GitHub")', { timeout: 20000 })
  log('entry saved')

  await page.locator('input[type="file"]').setInputFiles({
    name: FILE_NAME,
    mimeType: 'text/plain',
    buffer: FILE_CONTENT,
  })
  await page.waitForSelector('text=Attachment encrypted and saved.', { timeout: 30000 })
  await page.waitForSelector(`text=${FILE_NAME}`, { timeout: 10000 })
  log('attachment uploaded')

  const dbPath = process.env.DB_PATH
  let attachmentRow
  if (dbPath) {
    const db = new DatabaseSync(dbPath)
    try {
      attachmentRow = db
        .prepare(
          `SELECT id, user_id, ciphertext, nonce, size
           FROM attachments
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get()
      assert.ok(attachmentRow, 'the server should have an attachment row')
      assert.equal(attachmentRow.size, FILE_CONTENT.length)
      assert.ok(attachmentRow.ciphertext.length > FILE_CONTENT.length)
      const raw = Buffer.from(attachmentRow.ciphertext, 'base64')
      assert.ok(!raw.includes(Buffer.from('attachment-secret')), 'plaintext must not reach the server')
      const vault = db
        .prepare('SELECT ciphertext FROM vaults WHERE user_id = ?')
        .get(attachmentRow.user_id)
      assert.ok(vault)
      assert.ok(
        !Buffer.from(vault.ciphertext, 'base64').includes(Buffer.from(FILE_NAME)),
        'the encrypted vault must not expose the file name',
      )
    } finally {
      db.close()
    }
    log('server stores ciphertext only')
  }

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.waitForSelector('input[name="username"]', { timeout: 10000 })
  await page.fill('input[name="username"]', 'daniel+edited@example.com')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForSelector('text=daniel+edited@example.com', { timeout: 20000 })
  await page.waitForSelector(`text=${FILE_NAME}`, { timeout: 10000 })
  log('editing the item preserved its attachments')

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await page.waitForSelector('text=Attachments are not included.', { timeout: 10000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  log('share dialog warns that attachments stay private')

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: `Download ${FILE_NAME}` }).click(),
  ])
  const downloadPath = await download.path()
  assert.ok(downloadPath, 'the browser should provide a download path')
  assert.deepEqual(await readFile(downloadPath), FILE_CONTENT)
  log('attachment downloads and decrypts correctly')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('input[name="handle"]', { timeout: 20000 })
  await page.fill('input[name="handle"]', HANDLE)
  await page.fill('input[name="master-password"]', MASTER)
  await page.locator('form').getByRole('button', { name: 'Unlock' }).click()
  await page.waitForSelector('text=Select an item', { timeout: 180000 })
  await page.getByRole('button', { name: /GitHub/ }).first().click()
  await page.waitForSelector(`text=${FILE_NAME}`, { timeout: 10000 })
  log('attachment metadata survives a reload and unlock')

  await page.getByRole('button', { name: `Remove ${FILE_NAME}` }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await page.waitForSelector('text=Attachment removed.', { timeout: 30000 })
  await page.waitForSelector('text=No files attached yet.', { timeout: 10000 })
  log('attachment removed from the vault')

  if (dbPath && attachmentRow) {
    const db = new DatabaseSync(dbPath)
    try {
      const row = db
        .prepare('SELECT COUNT(*) AS count FROM attachments WHERE id = ?')
        .get(attachmentRow.id)
      assert.equal(row.count, 0, 'removing an attachment should delete the server blob')
    } finally {
      db.close()
    }
    log('server blob cleaned up')
  }

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
  await page.screenshot({ path: artifactPath('attachments-failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
