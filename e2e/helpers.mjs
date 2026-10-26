import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

export const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3100'
export const ARTIFACTS = process.env.E2E_ARTIFACTS ?? join(process.cwd(), 'e2e', 'artifacts')
export const PLAYWRIGHT_CHANNEL = process.env.PLAYWRIGHT_CHANNEL || undefined

mkdirSync(ARTIFACTS, { recursive: true })

export function artifactPath(name) {
  return join(ARTIFACTS, name)
}

export function launchBrowser() {
  return chromium.launch({
    ...(PLAYWRIGHT_CHANNEL ? { channel: PLAYWRIGHT_CHANNEL } : {}),
    args: ['--no-sandbox'],
  })
}

/**
 * Attach a Chromium virtual authenticator to the page. This is what lets the
 * passkey flow run headlessly without a real platform authenticator.
 */
export async function addVirtualAuthenticator(page) {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { client, authenticatorId }
}

export function assertNoConsoleErrors(errors, ignored = []) {
  const unexpected = errors.filter(
    (error) => !ignored.some((pattern) => pattern.test(error)),
  )
  if (unexpected.length > 0) {
    console.log('CONSOLE ERRORS:')
    for (const error of unexpected.slice(0, 10)) console.log('  !', error)
    throw new Error('unexpected console errors were recorded')
  }
}
