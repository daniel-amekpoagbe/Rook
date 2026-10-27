import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseImportText } from '../src/lib/import'
import { entryFingerprint, newEntry } from '../src/lib/vault'

test('imports a Chrome CSV, including quoted commas and newlines', () => {
  const csv = [
    'name,url,username,password,note',
    '"GitHub, Inc.",https://github.com,octocat,"pa,ss","line one',
    'line two"',
  ].join('\n')

  const result = parseImportText(csv)
  assert.equal(result.source, 'chrome')
  assert.equal(result.entries.length, 1)
  assert.equal(result.entries[0]?.type, 'login')
  assert.equal(result.entries[0]?.title, 'GitHub, Inc.')
  assert.equal(result.entries[0]?.username, 'octocat')
  assert.equal(result.entries[0]?.password, 'pa,ss')
  assert.equal(result.entries[0]?.notes, 'line one\nline two')
})

test('imports a 1Password CSV with TOTP, tags, and favorite state', () => {
  const csv = [
    'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes',
    'GitHub,https://github.com,octocat,secret,otpauth://totp/GitHub?secret=JBSWY3DPEHPK3PXP&issuer=GitHub,true,false,"work,dev",Dev account',
  ].join('\n')

  const result = parseImportText(csv)
  assert.equal(result.source, '1password')
  assert.equal(result.entries.length, 1)
  const entry = result.entries[0]
  assert.equal(entry?.type, 'login')
  assert.equal(entry?.totp, 'JBSWY3DPEHPK3PXP')
  assert.deepEqual(entry?.tags, ['work', 'dev'])
  assert.equal(entry?.favorite, true)
  assert.equal(entry?.notes, 'Dev account')
})

test('import preserves non-default authenticator URI settings', () => {
  const csv = [
    'Title,Url,Username,Password,OTPAuth',
    'GitHub,https://github.com,octocat,secret,otpauth://totp/GitHub:octocat?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&issuer=GitHub&algorithm=SHA256&digits=8',
  ].join('\n')

  const result = parseImportText(csv)
  const entry = result.entries[0]
  assert.equal(
    entry?.totp,
    'otpauth://totp/octocat?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&algorithm=SHA-256&digits=8',
  )
})

test('imports Bitwarden JSON logins, notes, cards, and identities', () => {
  const json = JSON.stringify({
    encrypted: false,
    folders: [{ id: 'folder-work', name: 'Work' }],
    items: [
      {
        type: 1,
        name: 'GitHub',
        favorite: true,
        folderId: 'folder-work',
        notes: 'Dev',
        login: {
          username: 'octocat',
          password: 'secret',
          totp: 'JBSWY3DPEHPK3PXP',
          uris: [{ uri: 'https://github.com' }, { uri: 'https://gist.github.com' }],
        },
      },
      { type: 2, name: 'Recovery codes', notes: 'one two three' },
      {
        type: 3,
        name: 'Visa',
        card: {
          cardholderName: 'Daniel A',
          number: '4111111111111111',
          expMonth: '12',
          expYear: '2030',
          code: '123',
        },
      },
      {
        type: 4,
        name: 'Me',
        identity: {
          firstName: 'Daniel',
          lastName: 'A',
          email: 'daniel@example.com',
          address1: '1 Main',
          city: 'Accra',
          country: 'Ghana',
        },
      },
    ],
  })

  const result = parseImportText(json)
  assert.equal(result.source, 'bitwarden')
  assert.equal(result.entries.length, 4)

  const login = result.entries[0]
  assert.equal(login?.type, 'login')
  assert.deepEqual(login?.tags, ['Work'])
  assert.equal(login?.favorite, true)
  assert.match(login?.notes ?? '', /Other URLs:\nhttps:\/\/gist\.github\.com/)

  const note = result.entries[1]
  assert.equal(note?.type, 'note')
  assert.equal(note?.title, 'Recovery codes')

  const card = result.entries[2]
  assert.equal(card?.type, 'card')
  assert.equal(card?.card?.expiry, '12/30')
  assert.equal(card?.card?.cvv, '123')

  const identity = result.entries[3]
  assert.equal(identity?.type, 'identity')
  assert.equal(identity?.identity?.fullName, 'Daniel A')
  assert.match(identity?.identity?.address ?? '', /Accra/)
})

test('imports a Bitwarden CSV', () => {
  const csv = [
    'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
    'Work,1,login,GitHub,Dev,,,https://github.com,octocat,secret,JBSWY3DPEHPK3PXP',
  ].join('\n')

  const result = parseImportText(csv)
  assert.equal(result.source, 'bitwarden')
  assert.equal(result.entries.length, 1)
  const entry = result.entries[0]
  assert.equal(entry?.title, 'GitHub')
  assert.deepEqual(entry?.tags, ['Work'])
  assert.equal(entry?.totp, 'JBSWY3DPEHPK3PXP')
})

test('imports a Rook CSV, including notes and space-separated tags', () => {
  const csv = [
    'type,title,username,password,url,totp,notes,tags',
    'login,GitHub,octocat,secret,https://github.com,,,work dev',
    'note,Recovery,,,,,codes,',
  ].join('\n')

  const result = parseImportText(csv)
  assert.equal(result.source, 'rook')
  assert.equal(result.entries.length, 2)
  assert.deepEqual(result.entries[0]?.tags, ['work', 'dev'])
  assert.equal(result.entries[1]?.type, 'note')
  assert.equal(result.entries[1]?.notes, 'codes')
})

test('rejects encrypted Rook backups and encrypted Bitwarden exports clearly', () => {
  assert.throws(
    () =>
      parseImportText(
        JSON.stringify({
          format: 'rook.vault',
          version: 1,
          kdf: {},
          ciphertext: 'ciphertext',
          nonce: 'nonce',
          updatedAt: new Date().toISOString(),
        }),
      ),
    /encrypted Rook backup/,
  )

  assert.throws(
    () => parseImportText(JSON.stringify({ encrypted: true, items: [] })),
    /Bitwarden export is encrypted/,
  )
})

test('duplicate fingerprints ignore case and surrounding whitespace', () => {
  const a = newEntry('login', {
    title: 'GitHub',
    username: 'Octocat',
    url: 'https://github.com',
  })
  const b = newEntry('login', {
    title: ' github ',
    username: ' octocat ',
    url: 'https://github.com ',
  })
  const c = newEntry('login', {
    title: 'GitHub',
    username: 'someone-else',
    url: 'https://github.com',
  })

  assert.equal(entryFingerprint(a), entryFingerprint(b))
  assert.notEqual(entryFingerprint(a), entryFingerprint(c))

  const noteA = newEntry('note', { title: 'Recovery', notes: 'codes' })
  const noteB = newEntry('note', { title: 'Recovery', notes: 'different codes' })
  assert.notEqual(entryFingerprint(noteA), entryFingerprint(noteB))

  const cardA = newEntry('card', { title: 'Visa', card: { number: '4111' } })
  const cardB = newEntry('card', { title: 'Visa', card: { number: '4222' } })
  assert.notEqual(entryFingerprint(cardA), entryFingerprint(cardB))
})
