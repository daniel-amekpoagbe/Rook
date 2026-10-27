import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encrypt, newKdfConfig } from '../src/lib/crypto'
import {
  MAX_HISTORY_VERSIONS,
  VAULT_DATA_VERSION,
  deleteTrashedEntry,
  emptyVault,
  headerAad,
  newEntry,
  openVault,
  restoreEntry,
  restoreVersion,
  sortTrash,
  touch,
  trashEntry,
  upsertEntry,
} from '../src/lib/vault'

const TEST_KDF = { ...newKdfConfig(), t: 1, m: 8192 }

test('version 2 vaults migrate to the current schema on read', () => {
  const key = new Uint8Array(32).fill(11)
  const legacyEntry = newEntry('login', {
    title: 'Legacy login',
    username: 'old@example.com',
    password: 'legacy-secret',
  })
  const legacyData = { version: 2, entries: [legacyEntry] }
  const sealed = {
    format: 'rook.vault' as const,
    version: 1 as const,
    kdf: TEST_KDF,
    updatedAt: new Date().toISOString(),
    ...encrypt(key, JSON.stringify(legacyData), headerAad(TEST_KDF, 'rook.vault')),
  }

  const opened = openVault(sealed, key)
  assert.equal(opened.version, VAULT_DATA_VERSION)
  assert.deepEqual(opened.trash, [])
  assert.deepEqual(opened.history, {})
  assert.deepEqual(opened.tombstones, [])
  assert.equal(opened.entries[0]?.title, 'Legacy login')
  assert.equal(opened.entries[0]?.password, 'legacy-secret')
})

test('version 3 vaults gain permanent-delete tombstones on read', () => {
  const key = new Uint8Array(32).fill(12)
  const entry = newEntry('login', { title: 'Existing login', password: 'secret' })
  const v3Data = { version: 3, entries: [entry], trash: [], history: {} }
  const sealed = {
    format: 'rook.vault' as const,
    version: 1 as const,
    kdf: TEST_KDF,
    updatedAt: new Date().toISOString(),
    ...encrypt(key, JSON.stringify(v3Data), headerAad(TEST_KDF, 'rook.vault')),
  }

  const opened = openVault(sealed, key)
  assert.equal(opened.version, VAULT_DATA_VERSION)
  assert.deepEqual(opened.tombstones, [])
  assert.equal(opened.entries[0]?.title, 'Existing login')
})

test('version 5 vaults drop legacy attachment metadata on read', () => {
  const key = new Uint8Array(32).fill(13)
  const attachment = {
    id: 'file-1',
    name: 'recovery-codes.txt',
    size: 42,
    type: 'text/plain',
    key: 'unused',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
  const entry = {
    ...newEntry('login', { title: 'Attachment-era login', password: 'secret' }),
    attachments: [attachment],
  }
  const oldVersion = { ...entry, password: 'older-secret' }
  const trashed = {
    ...newEntry('note', { title: 'Trashed note' }),
    deletedAt: '2026-01-02T00:00:00.000Z',
    attachments: [attachment],
  }
  const v5Data = {
    version: 5,
    entries: [entry],
    trash: [trashed],
    history: { [entry.id]: [oldVersion] },
    tombstones: [],
  }
  const sealed = {
    format: 'rook.vault' as const,
    version: 1 as const,
    kdf: TEST_KDF,
    updatedAt: new Date().toISOString(),
    ...encrypt(key, JSON.stringify(v5Data), headerAad(TEST_KDF, 'rook.vault')),
  }

  const opened = openVault(sealed, key)
  assert.equal(opened.version, VAULT_DATA_VERSION)
  assert.equal(opened.entries[0]?.title, 'Attachment-era login')
  assert.equal(opened.trash[0]?.title, 'Trashed note')
  assert.equal(opened.history[entry.id]?.[0]?.password, 'older-secret')
  assert.equal('attachments' in opened.entries[0]!, false)
  assert.equal('attachments' in opened.trash[0]!, false)
  assert.equal('attachments' in opened.history[entry.id]![0]!, false)
})

test('editing records the previous version, while favorite changes do not', () => {
  const original = newEntry('login', {
    title: 'GitHub',
    username: 'daniel',
    password: 'old-password',
  })
  let data = upsertEntry(emptyVault(), original)
  assert.equal(data.history[original.id], undefined, 'a new item has no history')

  const edited = touch({ ...original, password: 'new-password' })
  data = upsertEntry(data, edited)
  assert.equal(data.history[original.id]?.length, 1)
  assert.equal(data.history[original.id]?.[0]?.password, 'old-password')
  assert.equal(data.entries[0]?.password, 'new-password')

  const favorited = touch({ ...edited, favorite: true })
  data = upsertEntry(data, favorited)
  assert.equal(data.history[original.id]?.length, 1, 'favorite-only changes are not content versions')
  assert.equal(data.entries[0]?.favorite, true)
})

test('history keeps the newest versions and drops the oldest beyond the cap', () => {
  const original = newEntry('note', { title: 'Journal', notes: 'v0' })
  let data = upsertEntry(emptyVault(), original)

  for (let version = 1; version <= MAX_HISTORY_VERSIONS + 5; version += 1) {
    data = upsertEntry(data, touch({ ...original, notes: `v${version}` }))
  }

  assert.equal(data.history[original.id]?.length, MAX_HISTORY_VERSIONS)
  assert.equal(data.history[original.id]?.[0]?.notes, `v${MAX_HISTORY_VERSIONS + 4}`)
  assert.equal(data.entries[0]?.notes, `v${MAX_HISTORY_VERSIONS + 5}`)
})

test('deleting moves an item to trash and restoring clears trash metadata', () => {
  const entry = newEntry('login', { title: 'Bank', password: 'secret' })
  let data = upsertEntry(emptyVault(), entry)

  data = trashEntry(data, entry.id)
  assert.equal(data.entries.length, 0)
  assert.equal(data.trash.length, 1)
  assert.ok(data.trash[0]?.deletedAt)

  data = restoreEntry(data, entry.id)
  assert.equal(data.trash.length, 0)
  assert.equal(data.entries.length, 1)
  assert.equal(data.entries[0]?.deletedAt, undefined)
  assert.equal(data.entries[0]?.password, 'secret')
})

test('permanently deleting a trashed item removes its version history', () => {
  const original = newEntry('login', { title: 'Bank', password: 'old' })
  let data = upsertEntry(emptyVault(), original)
  data = upsertEntry(data, touch({ ...original, password: 'new' }))
  data = trashEntry(data, original.id)

  assert.ok(data.history[original.id]?.length)
  data = deleteTrashedEntry(data, original.id)
  assert.equal(data.trash.length, 0)
  assert.equal(data.history[original.id], undefined)
  assert.equal(data.tombstones[0]?.id, original.id)
  assert.ok(data.tombstones[0]?.deletedAt)
})

test('re-adding an item clears its permanent-delete tombstone', () => {
  const id = 'restored'
  const tombstone = { id, deletedAt: '2026-01-03T00:00:00.000Z' }
  const restored = {
    ...newEntry('login', { title: 'Restored', password: 'secret' }),
    id,
    updatedAt: '2026-01-04T00:00:00.000Z',
  }
  const data = upsertEntry({ ...emptyVault(), tombstones: [tombstone] }, restored)

  assert.equal(data.entries[0]?.id, id)
  assert.deepEqual(data.tombstones, [])
})

test('restoring a version swaps content and keeps the replaced version recoverable', () => {
  const original = newEntry('login', {
    title: 'GitHub',
    username: 'daniel',
    password: 'old-password',
  })
  let data = upsertEntry(emptyVault(), original)
  const edited = touch({ ...original, password: 'new-password' })
  data = upsertEntry(data, edited)

  const previous = data.history[original.id]?.[0]
  assert.ok(previous)
  data = restoreVersion(data, original.id, previous.updatedAt)

  assert.equal(data.entries[0]?.password, 'old-password')
  assert.ok(
    data.history[original.id]?.some((version) => version.password === 'new-password'),
    'the replaced version is added to history',
  )
})

test('trash is sorted by deletion time, newest first', () => {
  const older = { ...newEntry('note', { title: 'Older' }), deletedAt: '2026-01-01T00:00:00.000Z' }
  const newer = { ...newEntry('note', { title: 'Newer' }), deletedAt: '2026-02-01T00:00:00.000Z' }

  assert.deepEqual(
    sortTrash([older, newer]).map((entry) => entry.title),
    ['Newer', 'Older'],
  )
})
