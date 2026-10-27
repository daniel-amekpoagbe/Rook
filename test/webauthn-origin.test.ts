import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveRelyingParty } from '../src/lib/webauthn-origin'

test('uses forwarded host and protocol on Vercel-style proxies', () => {
  assert.deepEqual(
    resolveRelyingParty({
      forwardedHost: 'rook.vercel.app',
      forwardedProto: 'https',
      host: 'internal:3000',
    }),
    { origin: 'https://rook.vercel.app', rpID: 'rook.vercel.app' },
  )
})

test('defaults a public host to https and a local host to http', () => {
  assert.deepEqual(resolveRelyingParty({ host: 'rook.example.com' }), {
    origin: 'https://rook.example.com',
    rpID: 'rook.example.com',
  })
  assert.deepEqual(resolveRelyingParty({ host: 'localhost:3000' }), {
    origin: 'http://localhost:3000',
    rpID: 'localhost',
  })
})

test('strips ports from the RP ID but keeps them in the origin', () => {
  assert.deepEqual(
    resolveRelyingParty({
      forwardedHost: 'rook.example.com:8443',
      forwardedProto: 'https',
    }),
    { origin: 'https://rook.example.com:8443', rpID: 'rook.example.com' },
  )
})

test('accepts explicit overrides and normalizes them', () => {
  assert.deepEqual(
    resolveRelyingParty({
      originOverride: 'https://rook.example.com/',
      rpIdOverride: 'ROOK.EXAMPLE.COM.',
      host: 'ignored.example.com',
    }),
    { origin: 'https://rook.example.com', rpID: 'rook.example.com' },
  )
})

test('requires both overrides and rejects an invalid or missing host', () => {
  assert.throws(() => resolveRelyingParty({ originOverride: 'https://rook.example.com' }), {
    message: 'WEBAUTHN_CONFIG',
  })
  assert.throws(() => resolveRelyingParty({ rpIdOverride: 'rook.example.com' }), {
    message: 'WEBAUTHN_CONFIG',
  })
  assert.throws(() => resolveRelyingParty({}), { message: 'WEBAUTHN_CONFIG' })
})

test('falls back to a known origin when proxy headers are absent', () => {
  assert.deepEqual(
    resolveRelyingParty({ fallbackOrigin: 'https://rook.example.com/path' }),
    { origin: 'https://rook.example.com', rpID: 'rook.example.com' },
  )
})
