import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decoyKdf } from '../src/server/decoy-kdf'
import { registrationAllowed } from '../src/server/registration-policy'

test('decoy KDF salt is stable, full length, and not derived from the username alone', () => {
  const first = decoyKdf('ada@example.com', 'pepper-one-pepper-one')
  const second = decoyKdf('ada@example.com', 'pepper-one-pepper-one')
  const other = decoyKdf('ada@example.com', 'pepper-two-pepper-two')
  assert.deepEqual(first, second)
  assert.equal(first.salt.length, 24)
  assert.notEqual(first.salt, other.salt)
  assert.equal(first.t, 3)
  assert.equal(first.m, 65536)
})

test('public registration stays open for the first vault and then closes', () => {
  assert.equal(registrationAllowed({ flag: undefined, publicDeployment: true, userCount: 0 }), true)
  assert.equal(registrationAllowed({ flag: undefined, publicDeployment: true, userCount: 1 }), false)
  assert.equal(registrationAllowed({ flag: 'true', publicDeployment: true, userCount: 4 }), true)
  assert.equal(registrationAllowed({ flag: 'false', publicDeployment: false, userCount: 0 }), false)
  assert.equal(registrationAllowed({ flag: undefined, publicDeployment: false, userCount: 3 }), true)
})
