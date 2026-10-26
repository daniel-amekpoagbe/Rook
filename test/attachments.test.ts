import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_ATTACHMENT_BYTES,
  attachmentAad,
  attachmentSchema,
  decodeAttachmentKey,
  formatFileSize,
  newAttachmentKey,
  openAttachment,
  safeAttachmentName,
  sealAttachment,
} from '../src/lib/attachments'
import {
  VAULT_DATA_VERSION,
  emptyVault,
  mergeVaultData,
  newEntry,
  parseVaultData,
  restoreVersion,
  touch,
  upsertEntry,
} from '../src/lib/vault'

function sampleAttachment() {
  const { encoded } = newAttachmentKey()
  return {
    id: 'a8d1f4f4-6a72-4c2f-bb95-7c8d6f3b7f01',
    name: 'notes.txt',
    size: 16,
    type: 'text/plain',
    key: encoded,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

test('attachment bytes round-trip and reject a wrong key or AAD', () => {
  const { key, encoded } = newAttachmentKey()
  const bytes = new TextEncoder().encode('encrypted attachment')
  const aad = attachmentAad('file-id', 'entry-id', 'notes.txt', bytes.length, 'text/plain')
  const sealed = sealAttachment(key, bytes, aad)

  assert.deepEqual(openAttachment(key, sealed, aad), bytes)
  assert.throws(() => openAttachment(new Uint8Array(32).fill(9), sealed, aad))
  assert.throws(() => openAttachment(key, sealed, `${aad}:other`))
  assert.equal(decodeAttachmentKey(encoded).length, 32)
  assert.throws(() => decodeAttachmentKey('not-a-key'))
})

test('attachment metadata enforces the storage limits', () => {
  const attachment = sampleAttachment()
  assert.equal(attachmentSchema.parse(attachment).name, 'notes.txt')
  assert.throws(() =>
    attachmentSchema.parse({ ...attachment, size: MAX_ATTACHMENT_BYTES + 1 }),
  )
  assert.throws(() => attachmentSchema.parse({ ...attachment, name: '' }))
})

test('file names and sizes are made safe for the UI', () => {
  assert.equal(safeAttachmentName('../../etc/passwd'), '.._.._etc_passwd')
  assert.equal(safeAttachmentName('  report\u0000.pdf  '), 'report.pdf')
  assert.equal(safeAttachmentName(''), 'Attachment')
  assert.equal(formatFileSize(512), '512 B')
  assert.equal(formatFileSize(1024), '1.0 KB')
  assert.equal(formatFileSize(10 * 1024 * 1024), '10 MB')
})

test('version 4 vaults gain an empty attachment list on read', () => {
  const entry = newEntry('login', { title: 'Existing login', password: 'secret' })
  const { attachments: _attachments, ...v4Entry } = entry
  const parsed = parseVaultData({
    version: 4,
    entries: [v4Entry],
    trash: [],
    history: {},
    tombstones: [],
  })

  assert.equal(parsed.version, VAULT_DATA_VERSION)
  assert.deepEqual(parsed.entries[0]?.attachments, [])
  assert.equal(parsed.entries[0]?.password, 'secret')
})

test('attachment changes do not create history, and restoring a version keeps current files', () => {
  const attachment = sampleAttachment()
  const original = newEntry('note', { title: 'Journal', notes: 'v1' })
  let data = upsertEntry(emptyVault(), original)

  data = upsertEntry(data, touch({ ...original, attachments: [attachment] }))
  assert.equal(data.history[original.id], undefined, 'adding a file is not a content version')

  data = upsertEntry(data, touch({ ...data.entries[0]!, notes: 'v2' }))
  const previous = data.history[original.id]?.[0]
  assert.ok(previous)
  assert.deepEqual(previous.attachments, [], 'history never stores file references')

  data = restoreVersion(data, original.id, previous.updatedAt)
  assert.equal(data.entries[0]?.notes, 'v1')
  assert.deepEqual(data.entries[0]?.attachments, [attachment])
})

test('conflict history never carries attachment references', () => {
  const attachment = sampleAttachment()
  const base = {
    ...newEntry('login', { title: 'Same item', password: 'base' }),
    id: 'same',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const local = {
    ...base,
    password: 'local-edit',
    attachments: [attachment],
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
  const remote = {
    ...base,
    password: 'remote-edit',
    attachments: [{ ...attachment, id: 'other-file' }],
    updatedAt: '2026-01-01T12:00:00.000Z',
  }

  const merged = mergeVaultData(
    { version: VAULT_DATA_VERSION, entries: [local], trash: [], history: {}, tombstones: [] },
    { version: VAULT_DATA_VERSION, entries: [remote], trash: [], history: {}, tombstones: [] },
  )

  assert.equal(merged.entries[0]?.password, 'local-edit')
  assert.deepEqual(merged.entries[0]?.attachments, [attachment])
  assert.deepEqual(merged.history.same?.[0]?.attachments, [])
})
