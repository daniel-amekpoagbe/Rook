import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  emptyVault,
  mergeVaultData,
  newEntry,
  VAULT_DATA_VERSION,
  type Entry,
  type VaultData,
} from '../src/lib/vault'

function vault(
  entries: Entry[] = [],
  trash: Entry[] = [],
  history: VaultData['history'] = {},
): VaultData {
  return { version: VAULT_DATA_VERSION, entries, trash, history }
}

function login(id: string, updatedAt: string, password: string): Entry {
  return {
    ...newEntry('login', { title: id, password }),
    id,
    updatedAt,
  }
}

function trashed(entry: Entry, deletedAt: string): Entry {
  return { ...entry, deletedAt }
}

test('merging keeps additions from both vaults', () => {
  const local = login('local', '2026-01-01T00:00:00.000Z', 'local')
  const remote = login('remote', '2026-01-01T00:00:00.000Z', 'remote')

  const merged = mergeVaultData(vault([local]), vault([remote]))

  assert.deepEqual(
    merged.entries.map((entry) => entry.id).sort(),
    ['local', 'remote'],
  )
})

test('the newest edit wins and the losing version stays in history', () => {
  const base = login('same', '2026-01-01T00:00:00.000Z', 'base')
  const local = { ...base, password: 'local-edit', updatedAt: '2026-01-02T00:00:00.000Z' }
  const remote = { ...base, password: 'remote-edit', updatedAt: '2026-01-01T12:00:00.000Z' }

  const merged = mergeVaultData(vault([local]), vault([remote]))

  assert.equal(merged.entries[0]?.password, 'local-edit')
  assert.ok(
    merged.history.same?.some((version) => version.password === 'remote-edit'),
    'the remote edit should remain recoverable',
  )
})

test('a deletion newer than an edit wins', () => {
  const edited = login('item', '2026-01-02T00:00:00.000Z', 'edited')
  const deleted = trashed(login('item', '2026-01-01T00:00:00.000Z', 'deleted'), '2026-01-03T00:00:00.000Z')

  const merged = mergeVaultData(vault([], [deleted]), vault([edited]))

  assert.equal(merged.entries.length, 0)
  assert.equal(merged.trash[0]?.id, 'item')
})

test('an edit after a deletion restores the item', () => {
  const restored = login('item', '2026-01-04T00:00:00.000Z', 'restored')
  const deleted = trashed(login('item', '2026-01-01T00:00:00.000Z', 'deleted'), '2026-01-03T00:00:00.000Z')

  const merged = mergeVaultData(vault([restored]), vault([], [deleted]))

  assert.equal(merged.entries[0]?.password, 'restored')
  assert.equal(merged.trash.length, 0)
})

test('history is unioned by timestamp, newest first', () => {
  const current = login('item', '2026-01-05T00:00:00.000Z', 'current')
  const first = login('item', '2026-01-01T00:00:00.000Z', 'first')
  const second = login('item', '2026-01-02T00:00:00.000Z', 'second')

  const merged = mergeVaultData(
    vault([current], [], { item: [first] }),
    vault([current], [], { item: [second, first] }),
  )

  assert.deepEqual(
    merged.history.item?.map((version) => version.updatedAt),
    ['2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
  )
})

test('identical edits do not create duplicate history', () => {
  const local = login('same', '2026-01-02T00:00:00.000Z', 'same-password')
  const remote = login('same', '2026-01-01T00:00:00.000Z', 'same-password')

  const merged = mergeVaultData(vault([local]), vault([remote]))

  assert.equal(merged.entries[0]?.password, 'same-password')
  assert.deepEqual(merged.history, {})
})

test('merging an empty side preserves the other vault', () => {
  const item = login('item', '2026-01-01T00:00:00.000Z', 'secret')
  const deleted = trashed(login('gone', '2026-01-01T00:00:00.000Z', 'old'), '2026-01-02T00:00:00.000Z')
  const source = vault([item], [deleted], { item: [login('item', '2025-12-31T00:00:00.000Z', 'older')] })

  const merged = mergeVaultData(emptyVault(), source)

  assert.deepEqual(merged, source)
})
