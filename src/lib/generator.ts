/** Unbiased random integers from the platform CSPRNG (rejection sampling). */
function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error('maxExclusive must be positive')
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]!
  } while (value >= limit)
  return value % maxExclusive
}

export function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]!
}

export interface GeneratorOptions {
  length: number
  lowercase: boolean
  uppercase: boolean
  digits: boolean
  symbols: boolean
  /** Drop characters that are easy to confuse: O/0, l/1/I, etc. */
  avoidAmbiguous: boolean
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
}

const AMBIGUOUS = new Set(['O', '0', 'o', 'l', '1', 'I', 'i', '|', '`', "'"])

function charsetFor(options: GeneratorOptions): string {
  const sets: string[] = []
  if (options.lowercase) sets.push('abcdefghijklmnopqrstuvwxyz')
  if (options.uppercase) sets.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
  if (options.digits) sets.push('0123456789')
  if (options.symbols) sets.push('!@#$%^&*()-_=+[]{};:,.?/~')
  let charset = sets.join('')
  if (options.avoidAmbiguous) {
    charset = [...charset].filter((c) => !AMBIGUOUS.has(c)).join('')
  }
  return charset
}

export function generatePassword(options: GeneratorOptions): string {
  const charset = charsetFor(options)
  if (!charset) throw new Error('Select at least one character set')
  const length = Math.max(4, Math.min(128, Math.round(options.length)))

  const required: string[] = []
  const pools = [
    options.lowercase && 'abcdefghijklmnopqrstuvwxyz',
    options.uppercase && 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    options.digits && '0123456789',
    options.symbols && '!@#$%^&*()-_=+[]{};:,.?/~',
  ].filter(Boolean) as string[]

  for (const pool of pools) {
    const filtered = [...pool].filter((c) => charset.includes(c))
    if (filtered.length) required.push(filtered[randomInt(filtered.length)]!)
  }

  const chars: string[] = required.slice(0, length)
  while (chars.length < length) {
    chars.push(charset[randomInt(charset.length)]!)
  }

  // Fisher–Yates so the guaranteed characters are not stuck at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

export function charsetSize(options: GeneratorOptions): number {
  return charsetFor(options).length
}

export function generatorEntropyBits(options: GeneratorOptions): number {
  const size = charsetSize(options)
  if (size <= 1) return 0
  return options.length * Math.log2(size)
}
