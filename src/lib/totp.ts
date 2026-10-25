/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s), the parameters every mainstream
 * provider uses for authenticator-app secrets.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function normalizeTotpSecret(input: string): string {
  return input
    .replace(/^otpauth:\/\/[^?]*\?/i, '')
    .replace(/^secret=/i, '')
    .replace(/&.*$/, '')
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '')
    .toUpperCase()
}

export function isValidTotpSecret(secret: string): boolean {
  const normalized = normalizeTotpSecret(secret)
  if (normalized.length < 8) return false
  return /^[A-Z2-7]+$/.test(normalized)
}

export function base32Decode(secret: string): Uint8Array {
  const normalized = normalizeTotpSecret(secret)
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message as unknown as ArrayBuffer)
  return new Uint8Array(signature)
}

export interface TotpResult {
  code: string
  /** Seconds until this code expires. */
  remaining: number
  period: number
  progress: number
}

export async function generateTotp(secret: string, now = Date.now()): Promise<TotpResult> {
  const key = base32Decode(secret)
  const period = 30
  const digits = 6
  const counter = Math.floor(now / 1000 / period)

  const message = new Uint8Array(8)
  let temp = counter
  for (let i = 7; i >= 0; i--) {
    message[i] = temp & 0xff
    temp = Math.floor(temp / 256)
  }

  const digest = await hmacSha1(key, message)
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff)

  const code = (binary % 10 ** digits).toString().padStart(digits, '0')
  const secondsIntoPeriod = (now / 1000) % period
  const remaining = Math.ceil(period - secondsIntoPeriod)
  return { code, remaining, period, progress: secondsIntoPeriod / period }
}

/** Build the otpauth:// URI so the secret can be moved to another app. */
export function totpUri(secret: string, account: string, issuer = 'Rook'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({ secret: normalizeTotpSecret(secret), issuer, period: '30', digits: '6' })
  return `otpauth://totp/${label}?${params.toString()}`
}
