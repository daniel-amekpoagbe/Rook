import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decodeShareKey,
  formatShareRemaining,
  newShareKey,
  openShare,
  sealShare,
  sharePayloadSchema,
  SHARE_FORMAT_VERSION,
  SHARE_TTL_MS,
  type SharePayload,
} from '../src/lib/share'

const payload: SharePayload = {
  version: SHARE_FORMAT_VERSION,
  title: 'GitHub',
  username: 'daniel',
  password: 'correct horse battery staple',
  url: 'https://github.com',
  from: 'daniel',
  expiresAt: new Date(Date.now() + SHARE_TTL_MS).toISOString(),
}

test('share links use a three-day lifetime', () => {
  assert.equal(SHARE_TTL_MS, 3 * 24 * 60 * 60 * 1000)
})

test('share expiry labels stay readable near the deadline', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')
  assert.equal(formatShareRemaining(now + 30_000, now), '30s')
  assert.equal(formatShareRemaining(now + 90_000, now), '1m')
  assert.equal(formatShareRemaining(now + 3_600_000, now), '1h 0m')
  assert.equal(formatShareRemaining(now + 90_000_000, now), '1d 1h')
})

test('a share key round-trips through the URL-safe encoding', () => {
  const { key, encoded } = newShareKey()
  assert.equal(key.length, 32)
  assert.deepEqual(decodeShareKey(encoded), key)
  assert.doesNotMatch(encoded, /[+/=]/)
})

test('a share payload seals and opens with the right key and id', () => {
  const { key } = newShareKey()
  const sealed = sealShare(payload, key, 'share-id')

  assert.deepEqual(openShare(sealed, key, 'share-id'), payload)
})

test('a share cannot be opened with another key or a swapped id', () => {
  const { key } = newShareKey()
  const other = newShareKey()
  const sealed = sealShare(payload, key, 'share-id')

  assert.throws(() => openShare(sealed, other.key, 'share-id'))
  assert.throws(() => openShare(sealed, key, 'other-id'))
})

test('tampered ciphertext fails authentication', () => {
  const { key } = newShareKey()
  const sealed = sealShare(payload, key, 'share-id')
  const tampered = {
    ...sealed,
    ciphertext: `${sealed.ciphertext.slice(0, -4)}AAAA`,
  }

  assert.throws(() => openShare(tampered, key, 'share-id'))
})

test('share payloads require a password and a valid expiry', () => {
  assert.throws(() =>
    sharePayloadSchema.parse({
      version: SHARE_FORMAT_VERSION,
      title: 'Missing password',
      expiresAt: payload.expiresAt,
    }),
  )
  assert.throws(() =>
    sharePayloadSchema.parse({
      ...payload,
      expiresAt: 'not-a-date',
    }),
  )
})
