/**
 * RFC 6238 TOTP, the same 6- or 8-digit, 30-second authenticator codes used by
 * Google Authenticator, 1Password, and most providers.
 *
 * Everything here runs in the browser. The secret is read from the decrypted
 * vault and is never sent to the server; only the short-lived code is displayed
 * or copied.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DEFAULT_PERIOD = 30
const DEFAULT_DIGITS = 6
const DEFAULT_ALGORITHM = 'SHA-1'

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512'

export interface TotpConfig {
  secret: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  issuer?: string
  account?: string
}

export interface TotpResult {
  code: string
  /** Seconds until this code expires. */
  remaining: number
  period: number
  progress: number
  digits: number
  algorithm: TotpAlgorithm
  issuer?: string
  account?: string
}

function normalizeBase32(input: string): string {
  return input
    .replace(/^secret=/i, '')
    .replace(/&.*$/, '')
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '')
    .toUpperCase()
}

export function normalizeTotpSecret(input: string): string {
  const value = input.trim()
  if (/^otpauth:\/\//i.test(value)) {
    try {
      return normalizeBase32(new URL(value).searchParams.get('secret') ?? '')
    } catch {
      return ''
    }
  }
  return normalizeBase32(value)
}

export function isValidTotpSecret(secret: string): boolean {
  const normalized = normalizeTotpSecret(secret)
  if (normalized.length < 8) return false
  return /^[A-Z2-7]+$/.test(normalized)
}

function parseAlgorithm(value: string | null): TotpAlgorithm | null {
  const normalized = (value ?? '').trim().toUpperCase().replace(/[-_]/g, '')
  if (!normalized || normalized === 'SHA1') return DEFAULT_ALGORITHM
  if (normalized === 'SHA256') return 'SHA-256'
  if (normalized === 'SHA512') return 'SHA-512'
  return null
}

/**
 * Parse either a raw base32 secret or an otpauth:// URI. The URI form carries
 * the issuer, algorithm, digit count, and period, so importing a code from a
 * provider does not silently generate the wrong kind of code.
 */
export function parseTotp(input: string): TotpConfig | null {
  const value = input.trim()
  if (!value) return null

  let params: URLSearchParams | null = null
  let label = ''
  if (/^otpauth:\/\//i.test(value)) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return null
    }
    if (url.protocol.toLowerCase() !== 'otpauth:' || url.host.toLowerCase() !== 'totp') {
      return null
    }
    params = url.searchParams
    try {
      label = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return null
    }
  }

  const secret = normalizeTotpSecret(params?.get('secret') ?? value)
  if (!isValidTotpSecret(secret)) return null

  const algorithm = parseAlgorithm(params?.get('algorithm') ?? null)
  if (!algorithm) return null

  const digitsValue = params?.get('digits')
  const digits =
    digitsValue === null || digitsValue === undefined || digitsValue === ''
      ? DEFAULT_DIGITS
      : Number(digitsValue)
  if (!Number.isInteger(digits) || (digits !== 6 && digits !== 8)) return null

  const periodValue = params?.get('period')
  const period =
    periodValue === null || periodValue === undefined || periodValue === ''
      ? DEFAULT_PERIOD
      : Number(periodValue)
  if (!Number.isInteger(period) || period < 15 || period > 120) return null

  let issuer = params?.get('issuer')?.trim() || undefined
  let account = label.trim() || undefined
  if (account) {
    const separator = account.indexOf(':')
    if (separator >= 0) {
      const prefix = account.slice(0, separator).trim()
      if (!issuer && prefix) issuer = prefix
      account = account.slice(separator + 1).trim() || undefined
    }
  }

  return { secret, algorithm, digits, period, issuer, account }
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

async function hmac(
  key: Uint8Array,
  message: Uint8Array,
  algorithm: TotpAlgorithm,
): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) throw new Error('TOTP_UNAVAILABLE')
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message as unknown as ArrayBuffer)
  return new Uint8Array(signature)
}

export async function generateTotp(
  input: string | TotpConfig,
  now = Date.now(),
): Promise<TotpResult> {
  const config = typeof input === 'string' ? parseTotp(input) : input
  if (!config) throw new Error('INVALID_TOTP')

  const key = base32Decode(config.secret)
  try {
    const counter = Math.floor(now / 1000 / config.period)
    const message = new Uint8Array(8)
    let temp = counter
    for (let i = 7; i >= 0; i--) {
      message[i] = temp & 0xff
      temp = Math.floor(temp / 256)
    }

    const digest = await hmac(key, message, config.algorithm)
    const offset = digest[digest.length - 1]! & 0x0f
    const binary =
      ((digest[offset]! & 0x7f) << 24) |
      ((digest[offset + 1]! & 0xff) << 16) |
      ((digest[offset + 2]! & 0xff) << 8) |
      (digest[offset + 3]! & 0xff)

    const code = (binary % 10 ** config.digits).toString().padStart(config.digits, '0')
    const secondsIntoPeriod = (now / 1000) % config.period
    const remaining = Math.max(0, Math.ceil(config.period - secondsIntoPeriod))
    return {
      code,
      remaining,
      period: config.period,
      progress: secondsIntoPeriod / config.period,
      digits: config.digits,
      algorithm: config.algorithm,
      issuer: config.issuer,
      account: config.account,
    }
  } finally {
    key.fill(0)
  }
}

/** Build the otpauth:// URI so the secret can be moved to another app. */
export function totpUri(secret: string, account: string, issuer = 'Rook'): string {
  const config = parseTotp(secret)
  const params = new URLSearchParams({
    secret: config?.secret ?? normalizeTotpSecret(secret),
    issuer,
    period: String(config?.period ?? DEFAULT_PERIOD),
    digits: String(config?.digits ?? DEFAULT_DIGITS),
  })
  if (config && config.algorithm !== DEFAULT_ALGORITHM) params.set('algorithm', config.algorithm)
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?${params.toString()}`
}
