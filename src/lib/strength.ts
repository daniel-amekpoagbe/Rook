export type StrengthLabel = 'very weak' | 'weak' | 'fair' | 'strong' | 'excellent'

export interface PasswordStrength {
  bits: number
  score: 0 | 1 | 2 | 3 | 4
  label: StrengthLabel
  /** Offline attack estimate against a fast hash, 1e10 guesses/second. */
  crackTime: string
  warnings: string[]
}

const COMMON = new Set([
  'password',
  'password1',
  'passw0rd',
  'letmein',
  'welcome',
  'qwerty',
  'qwerty123',
  '123456',
  '12345678',
  '123456789',
  'iloveyou',
  'admin',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'abc123',
  'trustno1',
  'sunshine',
  'master',
  'shadow',
  'superman',
  'batman',
])

function charsetSize(password: string): number {
  let size = 0
  if (/[a-z]/.test(password)) size += 26
  if (/[A-Z]/.test(password)) size += 26
  if (/[0-9]/.test(password)) size += 10
  if (/[^a-zA-Z0-9]/.test(password)) size += 33
  return size
}

/** Longest run of ascending/descending characters, e.g. "abcd" or "9876". */
function sequenceRun(password: string): number {
  let longest = 1
  let run = 1
  for (let i = 1; i < password.length; i++) {
    const delta = password.charCodeAt(i) - password.charCodeAt(i - 1)
    if (delta === 1 || delta === -1) run += 1
    else run = 1
    longest = Math.max(longest, run)
  }
  return longest
}

function repeatRatio(password: string): number {
  if (password.length === 0) return 0
  let repeated = 0
  for (let i = 1; i < password.length; i++) {
    if (password[i] === password[i - 1]) repeated += 1
  }
  return repeated / password.length
}

function formatCrackTime(seconds: number): string {
  if (seconds < 1) return 'instantly'
  const units: Array<[number, string]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [365, 'day'],
    [1e9, 'year'],
  ]
  let value = seconds
  let unit = 'second'
  for (const [factor, name] of units) {
    unit = name
    if (value < factor) break
    value /= factor
  }
  if (unit === 'year' && value > 1e6) return 'centuries'
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${rounded.toLocaleString()} ${unit}${rounded === 1 ? '' : 's'}`
}

export function scorePassword(password: string): PasswordStrength {
  const warnings: string[] = []
  if (!password) {
    return { bits: 0, score: 0, label: 'very weak', crackTime: 'instantly', warnings: ['Empty'] }
  }

  const size = charsetSize(password)
  let bits = password.length * Math.log2(Math.max(size, 2))

  const lower = password.toLowerCase()
  if (COMMON.has(lower)) {
    bits = Math.min(bits, 12)
    warnings.push('This is a well-known password')
  }

  // An email address is public, appears in breach dumps, and has structure.
  // Charset math says "112 bits"; reality says "already on a wordlist".
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(password)) {
    bits = Math.min(bits, 18)
    warnings.push('This looks like an email address')
  }

  // word-word-word chains: estimate by dictionary size per word, not per character.
  if (!/[^a-z._\-\s]/i.test(password) && /[._\-\s]/.test(password) && password.length >= 10) {
    const words = password.split(/[._\-\s]+/).filter(Boolean).length
    if (words >= 2) {
      bits = Math.min(bits, words * 13.5)
      warnings.push('Built from dictionary words')
    }
  }

  if (/^\d+$/.test(password)) {
    bits *= 0.6
    warnings.push('Digits only')
  }

  if (password.length < 12) warnings.push('Shorter than 12 characters')

  const seq = sequenceRun(password)
  if (seq >= 3) {
    bits -= (seq - 2) * 2
    warnings.push('Contains a keyboard/number sequence')
  }

  const repeats = repeatRatio(password)
  if (repeats > 0.2) {
    bits *= 1 - repeats * 0.8
    warnings.push('Contains repeated characters')
  }

  if (/(.)\1{2,}/.test(password)) {
    bits -= 8
    warnings.push('Contains a repeated run')
  }

  // Two-character blocks repeated, e.g. "abababab"
  if (/^(.{2,4})\1+$/.test(password)) {
    bits *= 0.5
    warnings.push('Contains a repeating pattern')
  }

  bits = Math.max(0, Math.round(bits))

  let score: PasswordStrength['score'] = 0
  if (bits >= 40) score = 1
  if (bits >= 60) score = 2
  if (bits >= 80) score = 3
  if (bits >= 100) score = 4

  const labels: StrengthLabel[] = ['very weak', 'weak', 'fair', 'strong', 'excellent']
  const guesses = 2 ** Math.min(bits, 200) / 2
  const crackTime = formatCrackTime(guesses / 1e10)

  return { bits, score, label: labels[score]!, crackTime, warnings }
}

export const STRENGTH_COLORS = ['#d92d20', '#c4320a', '#b54708', '#067647', '#05603a']
