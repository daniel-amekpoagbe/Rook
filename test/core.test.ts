import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  authProof,
  deriveAuthKey,
  deriveMasterKey,
  deriveVaultKey,
  encrypt,
  decrypt,
  newKdfConfig,
  toB64,
} from '../src/lib/crypto'
import {
  emptyVault,
  headerAad,
  matchesQuery,
  newEntry,
  openVault,
  openVaultWithFallback,
  sealVault,
  sortEntries,
} from '../src/lib/vault'
import { DEFAULT_GENERATOR_OPTIONS, generatePassword, generatorEntropyBits } from '../src/lib/generator'
import { scorePassword } from '../src/lib/strength'
import { base32Decode, generateTotp, isValidTotpSecret, normalizeTotpSecret } from '../src/lib/totp'
import { brandForEntry, brandForUrl } from '../src/components/BrandIcon'

// Cheap KDF for tests; production params are exercised once below.
const TEST_KDF = { algorithm: 'argon2id' as const, t: 1, m: 8192, p: 1, salt: toB64(new Uint8Array(16).fill(7)) }

test('argon2id derivation is deterministic and salt-dependent', async () => {
  const a = await deriveMasterKey('correct horse battery staple', TEST_KDF)
  const b = await deriveMasterKey('correct horse battery staple', TEST_KDF)
  assert.deepEqual(a, b)
  assert.equal(a.length, 32)

  const otherSalt = { ...TEST_KDF, salt: toB64(new Uint8Array(16).fill(9)) }
  const c = await deriveMasterKey('correct horse battery staple', otherSalt)
  assert.notDeepEqual(a, c)

  const wrongPassword = await deriveMasterKey('correct horse battery stapl3', TEST_KDF)
  assert.notDeepEqual(a, wrongPassword)
})

test('auth and vault keys are independent subkeys', async () => {
  const master = await deriveMasterKey('hunter2-hunter2-hunter2', TEST_KDF)
  const auth = deriveAuthKey(master)
  const vault = deriveVaultKey(master)
  assert.notDeepEqual(auth, vault)
  assert.notEqual(authProof(auth), authProof(vault))
  assert.match(authProof(auth), /^[0-9a-f]{64}$/)
})

test('AEAD roundtrip, and it rejects a wrong key or a different AAD', () => {
  const key = new Uint8Array(32).fill(1)
  const sealed = encrypt(key, 'secret payload', 'header-a')
  assert.equal(decrypt(key, sealed, 'header-a'), 'secret payload')
  assert.throws(() => decrypt(new Uint8Array(32).fill(2), sealed, 'header-a'))
  assert.throws(() => decrypt(key, sealed, 'header-b'))
})

test('vault seals and opens, and rejects tampering', async () => {
  const kdf = newKdfConfig()
  const master = await deriveMasterKey('a-long-master-password', { ...kdf, t: 1, m: 8192 })
  const vaultKey = deriveVaultKey(master)

  const data = emptyVault()
  data.entries.push(newEntry('login', { title: 'GitHub', username: 'daniel', password: 'abc123' }))

  const sealed = sealVault(data, vaultKey, { ...kdf, t: 1, m: 8192 })
  const opened = openVault(sealed, vaultKey)
  assert.equal(opened.entries.length, 1)
  assert.equal(opened.entries[0]?.title, 'GitHub')

  // Header downgrade must break the AEAD tag because the header is the AAD.
  const downgraded = { ...sealed, kdf: { ...sealed.kdf, m: 16384 } }
  assert.throws(() => openVault(downgraded, vaultKey))

  // Ciphertext corruption must also fail.
  const corrupted = { ...sealed, ciphertext: toB64(new Uint8Array(64).fill(3)) }
  assert.throws(() => openVault(corrupted, vaultKey))

  // Wrong password must fail.
  const otherMaster = await deriveMasterKey('another-master-password', { ...kdf, t: 1, m: 8192 })
  assert.throws(() => openVault(sealed, deriveVaultKey(otherMaster)))
})

test('legacy keynest.vault backups still open after the Rook rename', () => {
  const kdf = { ...newKdfConfig(), t: 1, m: 8192 }
  const key = new Uint8Array(32).fill(5)
  const data = emptyVault()
  data.entries.push(newEntry('note', { title: 'Legacy note' }))

  const legacySealed = {
    format: 'keynest.vault' as const,
    version: 1 as const,
    kdf,
    updatedAt: new Date().toISOString(),
    ...encrypt(key, JSON.stringify(data), headerAad(kdf, 'keynest.vault')),
  }

  const opened = openVault(legacySealed, key)
  assert.equal(opened.entries[0]?.title, 'Legacy note')

  // The server stores no format label, so unlock tries the current label first
  // and falls back to the legacy one for pre-rename vaults.
  const fallbackOpened = openVaultWithFallback(
    {
      version: 1,
      kdf,
      updatedAt: legacySealed.updatedAt,
      nonce: legacySealed.nonce,
      ciphertext: legacySealed.ciphertext,
    },
    key,
  )
  assert.equal(fallbackOpened.entries[0]?.title, 'Legacy note')
})

test('generated passwords respect the selected alphabet', () => {
  const options = { ...DEFAULT_GENERATOR_OPTIONS, length: 40, symbols: false, avoidAmbiguous: true }
  const value = generatePassword(options)
  assert.equal(value.length, 40)
  assert.match(value, /^[a-zA-Z0-9]+$/)
  assert.ok(!/[O0l1Ii|]/.test(value), 'ambiguous characters should be excluded')
  // 62 alphanumerics minus the 7 ambiguous ones (O, 0, o, l, 1, I, i)
  assert.equal(generatorEntropyBits(options), 40 * Math.log2(55))

  const unique = new Set(Array.from({ length: 200 }, () => generatePassword(options)))
  assert.equal(unique.size, 200)
})

test('strength scoring separates weak from random', () => {
  assert.ok(scorePassword('password').score <= 1)
  assert.ok(scorePassword('123456').score <= 1)
  assert.ok(scorePassword('aaaaaaaaaaaaaaaa').score <= 1)
  const strong = scorePassword(generatePassword({ ...DEFAULT_GENERATOR_OPTIONS, length: 24 }))
  assert.ok(strong.score >= 3, `expected strong, got ${strong.score} (${strong.bits} bits)`)
})

test('strength scoring treats public identifiers and word chains as weak', () => {
  const email = scorePassword('demo.person@example.com')
  assert.equal(email.score, 0, `email should score 0, got ${email.bits} bits`)
  assert.ok(email.warnings.includes('This looks like an email address'))

  const chain = scorePassword('correct-horse-battery-staple')
  assert.ok(chain.score <= 1, `4-word chain should be weak, got ${chain.bits} bits`)

  const fiveWords = scorePassword('correct-horse-battery-staple-umbrella')
  assert.ok(fiveWords.bits > chain.bits, 'each extra word should add entropy')
})

test('base32 and TOTP match RFC 6238 test vectors', async () => {
  // "Hello!" followed by the raw bytes DE AD BE EF
  const expected = new Uint8Array([72, 101, 108, 108, 111, 33, 0xde, 0xad, 0xbe, 0xef])
  assert.deepEqual(base32Decode('JBSWY3DPEHPK3PXP'), expected)

  // RFC 6238 SHA-1 seed "12345678901234567890"
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  assert.ok(isValidTotpSecret(secret))
  assert.equal(normalizeTotpSecret('jbsw y3dp ehpk 3pxp'), 'JBSWY3DPEHPK3PXP')

  const at59 = await generateTotp(secret, 59_000)
  assert.equal(at59.code, '287082')
  const at1111 = await generateTotp(secret, 1111111109000)
  assert.equal(at1111.code, '081804')
})

test('entry search, sorting and validation', () => {
  const github = newEntry('login', { title: 'GitHub', username: 'daniel', url: 'https://github.com' })
  const bank = newEntry('login', { title: 'Zenith Bank', username: 'd.amekpo' })
  bank.favorite = true

  const sorted = sortEntries([github, bank])
  assert.equal(sorted[0]?.title, 'Zenith Bank', 'favorites sort first')

  assert.ok(matchesQuery(github, 'git hub'))
  assert.ok(matchesQuery(github, 'github daniel'))
  assert.ok(matchesQuery(bank, 'zenith'))
  assert.ok(!matchesQuery(bank, 'github'))
})

test('login avatars resolve familiar platform brands from URLs and titles', () => {
  assert.equal(brandForUrl('https://accounts.google.com/signin'), 'google')
  assert.equal(brandForUrl('https://mail.google.com'), 'gmail')
  assert.equal(brandForUrl('instagram.com'), 'instagram')
  assert.equal(brandForUrl('https://supabase.com/dashboard'), 'supabase')
  assert.equal(brandForUrl('https://linear.app/rook'), 'linear')
  assert.equal(brandForUrl('https://console.aws.amazon.com'), 'amazon')
  assert.equal(brandForUrl('https://login.microsoftonline.com'), 'microsoft')
  assert.equal(brandForUrl('https://www.example.com'), null)
  assert.equal(brandForEntry(undefined, 'Google Workspace'), 'google')
  assert.equal(brandForEntry(undefined, 'Gmail'), 'gmail')
  assert.equal(brandForEntry(undefined, 'AWS Console'), 'amazon')
  assert.equal(brandForEntry(undefined, 'Instagram'), 'instagram')
})
