import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatRecoveryCode, normalizeRecoveryCode } from '../src/lib/passkeys'

test('recovery-code normalization ignores case, spaces, and dashes', () => {
  assert.equal(normalizeRecoveryCode('ABCDE-12345 fghij'), 'abcde12345fghij')
  assert.equal(normalizeRecoveryCode('  aBcDe-12345  '), 'abcde12345')
})

test('recovery-code formatting groups a 40-character code', () => {
  const formatted = formatRecoveryCode('a'.repeat(40))
  assert.equal(formatted, 'aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa-aaaaa')
  assert.equal(normalizeRecoveryCode(formatted), 'a'.repeat(40))
})

test('recovery-code formatting is idempotent for grouped input', () => {
  const code = '0123456789abcdef0123456789abcdef01234567'
  assert.equal(formatRecoveryCode(formatRecoveryCode(code)), formatRecoveryCode(code))
})
