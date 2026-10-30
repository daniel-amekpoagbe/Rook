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
  entrySchema,
  headerAad,
  matchesQuery,
  newEntry,
  openVault,
  openVaultWithFallback,
  restoreVersion,
  sealVault,
  sortEntries,
  upsertEntry,
} from '../src/lib/vault'
import { DEFAULT_GENERATOR_OPTIONS, generatePassword, generatorEntropyBits } from '../src/lib/generator'
import { scorePassword } from '../src/lib/strength'
import {
  base32Decode,
  generateTotp,
  isValidTotpSecret,
  normalizeTotpSecret,
  parseTotp,
} from '../src/lib/totp'
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
  const totpSecret = 'JBSWY3DPEHPK3PXP'
  data.entries.push(
    newEntry('login', {
      title: 'GitHub',
      username: 'daniel',
      password: 'abc123',
      totp: totpSecret,
    }),
  )

  const sealed = sealVault(data, vaultKey, { ...kdf, t: 1, m: 8192 })
  assert.equal(JSON.stringify(sealed).includes(totpSecret), false, 'TOTP secret is not in the sealed envelope')
  const opened = openVault(sealed, vaultKey)
  assert.equal(opened.entries.length, 1)
  assert.equal(opened.entries[0]?.title, 'GitHub')
  assert.equal(opened.entries[0]?.totp, totpSecret)

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
  assert.equal('secret' in at59, false)
  const at1111 = await generateTotp(secret, 1111111109000)
  assert.equal(at1111.code, '081804')

  const beforeBoundary = await generateTotp(secret, 29_999)
  const atBoundary = await generateTotp(secret, 30_000)
  assert.notEqual(beforeBoundary.code, atBoundary.code)
  assert.equal(beforeBoundary.remaining, 1)
  assert.equal(atBoundary.remaining, 30)

  const raw = parseTotp('jbsw y3dp ehpk 3pxp')
  assert.equal(raw?.secret, 'JBSWY3DPEHPK3PXP')
  assert.equal(raw?.algorithm, 'SHA-1')
  assert.equal(raw?.digits, 6)
  assert.equal(raw?.period, 30)

  // RFC 6238 SHA-256 seed "12345678901234567890123456789012".
  const sha256 = parseTotp(
    'otpauth://totp/GitHub:octocat?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&issuer=GitHub&algorithm=SHA256&digits=8&period=30',
  )
  assert.equal(sha256?.issuer, 'GitHub')
  assert.equal(sha256?.account, 'octocat')
  assert.equal(sha256?.algorithm, 'SHA-256')
  assert.equal(sha256?.digits, 8)
  const sha256At59 = await generateTotp(sha256!, 59_000)
  assert.equal(sha256At59.code, '46119246')

  // RFC 6238 SHA-512 seed "1234567890" repeated to 64 bytes.
  const sha512 = await generateTotp(
    {
      secret:
        'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA',
      algorithm: 'SHA-512',
      digits: 8,
      period: 30,
    },
    59_000,
  )
  assert.equal(sha512.code, '90693936')

  assert.equal(parseTotp('not-base32!'), null)
  assert.equal(parseTotp('otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP'), null)
  assert.equal(parseTotp('otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&digits=7'), null)
  assert.equal(parseTotp('otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP&algorithm=MD5'), null)
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

  const card = newEntry('card', {
    title: 'Travel card',
    card: { number: '4111111111111111', holder: 'Ada Lovelace', expiry: '09/29' },
  })
  const identity = newEntry('identity', {
    title: 'Passport',
    identity: { fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '+44 20 7946 0958' },
  })
  assert.ok(matchesQuery(card, '4111 1111'), 'card number is searchable')
  assert.ok(matchesQuery(card, 'lovelace'), 'card holder is searchable')
  assert.ok(matchesQuery(identity, 'ada@example.com'), 'identity email is searchable')
  assert.ok(matchesQuery(identity, '7946'), 'identity phone is searchable')

  const newer = {
    ...github,
    title: 'A newer item',
    favorite: false,
    updatedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-01-15T00:00:00.000Z',
  }
  const older = {
    ...github,
    title: 'An older item',
    favorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  assert.equal(sortEntries([older, newer], 'updated')[0]?.title, 'A newer item')
  assert.equal(sortEntries([older, newer], 'created')[0]?.title, 'A newer item')
})

test('password age, 2FA state, and audit ignore survive edits', () => {
  const original = newEntry('login', { title: 'Mail', password: 'first-password' })
  assert.ok(original.passwordUpdatedAt, 'a new password gets an age timestamp')

  const stamped = {
    ...original,
    passwordUpdatedAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    twoFactor: 'off' as const,
  }
  let data = upsertEntry(emptyVault(), stamped)

  const renamed = upsertEntry(data, {
    ...stamped,
    title: 'Personal mail',
    updatedAt: '2025-01-01T00:00:00.000Z',
  })
  assert.equal(
    renamed.entries[0]?.passwordUpdatedAt,
    '2020-01-01T00:00:00.000Z',
    'renaming does not reset password age',
  )

  const changed = upsertEntry(renamed, {
    ...renamed.entries[0]!,
    password: 'second-password',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
  assert.equal(
    changed.entries[0]?.passwordUpdatedAt,
    '2026-01-01T00:00:00.000Z',
    'changing the password stamps it',
  )

  const ignored = upsertEntry(changed, {
    ...changed.entries[0]!,
    auditIgnored: true,
    updatedAt: '2026-02-01T00:00:00.000Z',
  })
  assert.equal(ignored.entries[0]?.auditIgnored, true)
  assert.equal(
    ignored.entries[0]?.passwordUpdatedAt,
    '2026-01-01T00:00:00.000Z',
    'audit ignore is not a password change',
  )

  const withoutStamp = { ...ignored.entries[0]! }
  delete withoutStamp.passwordUpdatedAt
  const preserved = upsertEntry(ignored, {
    ...withoutStamp,
    title: 'Personal mail again',
    updatedAt: '2026-03-01T00:00:00.000Z',
  })
  assert.equal(
    preserved.entries[0]?.passwordUpdatedAt,
    '2026-01-01T00:00:00.000Z',
    'an edit that omits the timestamp keeps the existing password age',
  )

  const parsed = entrySchema.parse({ ...ignored.entries[0], twoFactor: 'unavailable' })
  assert.equal(parsed.twoFactor, 'unavailable')
  assert.throws(() => entrySchema.parse({ ...ignored.entries[0], twoFactor: 'maybe' }))
})

test('restoring history keeps the password age unless the password itself changes', () => {
  const current = newEntry('login', {
    title: 'History age',
    password: 'current-password',
  })
  current.passwordUpdatedAt = '2025-06-01T00:00:00.000Z'
  current.updatedAt = '2026-01-01T00:00:00.000Z'
  const notesOnly = {
    ...current,
    notes: 'older note',
    updatedAt: '2025-05-01T00:00:00.000Z',
    passwordUpdatedAt: '2024-01-01T00:00:00.000Z',
  }
  const notesData = {
    ...emptyVault(),
    entries: [current],
    history: { [current.id]: [notesOnly] },
  }
  const notesRestored = restoreVersion(notesData, current.id, notesOnly.updatedAt)
  assert.equal(
    notesRestored.entries[0]?.passwordUpdatedAt,
    '2025-06-01T00:00:00.000Z',
    'restoring a note does not reset the password age',
  )

  const olderPassword = {
    ...current,
    password: 'older-password',
    updatedAt: '2025-04-01T00:00:00.000Z',
  }
  const passwordData = {
    ...emptyVault(),
    entries: [current],
    history: { [current.id]: [olderPassword] },
  }
  const passwordRestored = restoreVersion(passwordData, current.id, olderPassword.updatedAt)
  assert.equal(passwordRestored.entries[0]?.password, 'older-password')
  assert.notEqual(
    passwordRestored.entries[0]?.passwordUpdatedAt,
    '2025-06-01T00:00:00.000Z',
    'restoring an older password resets its age',
  )
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
  assert.equal(brandForUrl('https://chatgpt.com/'), 'openai')
  assert.equal(brandForUrl('https://chat.openai.com'), 'openai')
  assert.equal(brandForUrl('https://claude.ai/login'), 'claude')
  assert.equal(brandForUrl('https://huggingface.co'), 'huggingface')
  assert.equal(brandForUrl('https://grok.com'), 'grok')
  assert.equal(brandForUrl('https://gemini.google.com'), 'gemini')
  assert.equal(brandForUrl('https://www.perplexity.ai'), 'perplexity')
  assert.equal(brandForEntry(undefined, 'ChatGPT'), 'openai')
  assert.equal(brandForEntry(undefined, 'Hugging Face'), 'huggingface')
  assert.equal(brandForEntry(undefined, 'Claude'), 'claude')
})
