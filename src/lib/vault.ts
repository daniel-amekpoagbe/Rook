import { z } from 'zod'
import { decrypt, encrypt, type KdfConfig, type SealedBlob } from './crypto'

export const VAULT_FORMAT = 'rook.vault'
/** Pre-rename backups remain readable; new saves use `rook.vault`. */
export const LEGACY_VAULT_FORMAT = 'keynest.vault'
export const VAULT_FORMAT_VERSION = 1
export const VAULT_DATA_VERSION = 3
export const MAX_HISTORY_VERSIONS = 20
export const MAX_TRASH_ITEMS = 1000

export type VaultFormat = typeof VAULT_FORMAT | typeof LEGACY_VAULT_FORMAT

export function isSupportedVaultFormat(format: string): format is VaultFormat {
  return format === VAULT_FORMAT || format === LEGACY_VAULT_FORMAT
}

export type EntryType = 'login' | 'note' | 'card' | 'identity'

export const entrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['login', 'note', 'card', 'identity']),
  title: z.string().min(1).max(200),
  username: z.string().max(300).optional(),
  password: z.string().max(2000).optional(),
  url: z.string().max(2000).optional(),
  notes: z.string().max(20000).optional(),
  totp: z.string().max(200).optional(),
  card: z
    .object({
      number: z.string().max(40).optional(),
      holder: z.string().max(200).optional(),
      expiry: z.string().max(20).optional(),
      cvv: z.string().max(10).optional(),
      pin: z.string().max(20).optional(),
    })
    .optional(),
  identity: z
    .object({
      fullName: z.string().max(200).optional(),
      email: z.string().max(300).optional(),
      phone: z.string().max(50).optional(),
      address: z.string().max(1000).optional(),
    })
    .optional(),
  tags: z.array(z.string().max(50)).max(30).default([]),
  favorite: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set only while an item is in the trash. */
  deletedAt: z.string().optional(),
})

export type Entry = z.infer<typeof entrySchema>

/** Version 2 is the pre-history schema; it is migrated on read. */
export const legacyVaultDataSchema = z.object({
  version: z.literal(2),
  entries: z.array(entrySchema).max(10000),
})

export const vaultDataSchema = z.object({
  version: z.literal(VAULT_DATA_VERSION),
  entries: z.array(entrySchema).max(10000),
  trash: z.array(entrySchema).max(MAX_TRASH_ITEMS).default([]),
  history: z.record(z.string(), z.array(entrySchema).max(MAX_HISTORY_VERSIONS)).default({}),
})

export type VaultData = z.infer<typeof vaultDataSchema>
export type VaultHistory = VaultData['history']

export interface EncryptedVault extends SealedBlob {
  format: VaultFormat
  version: typeof VAULT_FORMAT_VERSION
  kdf: KdfConfig
  updatedAt: string
}

/**
 * The header is bound into the AEAD as associated data, so an attacker cannot
 * downgrade the KDF parameters or swap the salt without breaking decryption.
 */
export function headerAad(kdf: KdfConfig, format: VaultFormat = VAULT_FORMAT): string {
  return JSON.stringify({
    format,
    version: VAULT_FORMAT_VERSION,
    kdf: {
      algorithm: kdf.algorithm,
      t: kdf.t,
      m: kdf.m,
      p: kdf.p,
      salt: kdf.salt,
    },
  })
}

export function emptyVault(): VaultData {
  return { version: VAULT_DATA_VERSION, entries: [], trash: [], history: {} }
}

/**
 * Vaults written before item history are still valid. Add the new collections
 * on read so the next save upgrades the payload without a separate migration.
 */
export function parseVaultData(value: unknown): VaultData {
  const current = vaultDataSchema.safeParse(value)
  if (current.success) return current.data

  const legacy = legacyVaultDataSchema.safeParse(value)
  if (legacy.success) {
    return {
      version: VAULT_DATA_VERSION,
      entries: legacy.data.entries,
      trash: [],
      history: {},
    }
  }

  // Re-run the current schema so the caller gets the useful validation error.
  return vaultDataSchema.parse(value)
}

export function sealVault(data: VaultData, vaultKey: Uint8Array, kdf: KdfConfig): EncryptedVault {
  const plaintext = JSON.stringify(data)
  const sealed = encrypt(vaultKey, plaintext, headerAad(kdf, VAULT_FORMAT))
  return {
    format: VAULT_FORMAT,
    version: VAULT_FORMAT_VERSION,
    kdf,
    updatedAt: new Date().toISOString(),
    ...sealed,
  }
}

/** Throws if the key is wrong or the blob/header was tampered with. */
export function openVault(blob: EncryptedVault, vaultKey: Uint8Array): VaultData {
  if (!isSupportedVaultFormat(blob.format) || blob.version !== VAULT_FORMAT_VERSION) {
    throw new Error('Unsupported vault format')
  }
  const plaintext = decrypt(vaultKey, blob, headerAad(blob.kdf, blob.format))
  return parseVaultData(JSON.parse(plaintext))
}

/**
 * The server stores ciphertext, not the local format label, so a pre-rename
 * vault can still be opened by trying the current label and then the legacy one.
 * The next save rewraps it with the current label.
 */
export function openVaultWithFallback(
  blob: Omit<EncryptedVault, 'format'>,
  vaultKey: Uint8Array,
): VaultData {
  let firstError: unknown
  for (const format of [VAULT_FORMAT, LEGACY_VAULT_FORMAT] as const) {
    try {
      return openVault({ ...blob, format }, vaultKey)
    } catch (error) {
      firstError ??= error
    }
  }
  throw firstError
}

export function newEntry(
  type: EntryType,
  fields: Partial<
    Omit<Entry, 'id' | 'type' | 'createdAt' | 'updatedAt' | 'tags' | 'favorite' | 'deletedAt'>
  > = {},
): Entry {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    type,
    title: fields.title?.trim() || 'Untitled',
    username: fields.username,
    password: fields.password,
    url: fields.url,
    notes: fields.notes,
    totp: fields.totp,
    card: fields.card,
    identity: fields.identity,
    tags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function touch(entry: Entry): Entry {
  return { ...entry, updatedAt: new Date().toISOString() }
}

/**
 * A stable identity for duplicate detection when importing. Imported managers
 * use their own IDs, so the same login must be recognised by its content.
 */
export function entryFingerprint(entry: Entry): string {
  const base = [entry.type, entry.title.trim().toLowerCase()]
  if (entry.type === 'login') {
    return [
      ...base,
      entry.username?.trim().toLowerCase() ?? '',
      entry.url?.trim().toLowerCase() ?? '',
    ].join('\u0000')
  }
  if (entry.type === 'note') {
    return [...base, entry.notes?.trim().toLowerCase() ?? ''].join('\u0000')
  }
  if (entry.type === 'card') {
    return [
      ...base,
      entry.card?.number?.trim() ?? '',
      entry.card?.holder?.trim().toLowerCase() ?? '',
      entry.card?.expiry?.trim() ?? '',
    ].join('\u0000')
  }
  return [
    ...base,
    entry.identity?.fullName?.trim().toLowerCase() ?? '',
    entry.identity?.email?.trim().toLowerCase() ?? '',
    entry.identity?.phone?.trim() ?? '',
  ].join('\u0000')
}

/** Remove trash-only metadata before an item returns to the active vault. */
function activeCopy(entry: Entry): Entry {
  const { deletedAt: _deletedAt, ...active } = entry
  return active
}

/** Favorite changes and timestamps are metadata, not history-worthy content. */
function entryContentKey(entry: Entry): string {
  return JSON.stringify({
    type: entry.type,
    title: entry.title,
    username: entry.username ?? '',
    password: entry.password ?? '',
    url: entry.url ?? '',
    notes: entry.notes ?? '',
    totp: entry.totp ?? '',
    card: entry.card ?? null,
    identity: entry.identity ?? null,
    tags: entry.tags,
  })
}

/** Newest first, capped so the encrypted vault cannot grow without bound. */
export function recordHistory(history: VaultHistory, entry: Entry): VaultHistory {
  const versions = history[entry.id] ?? []
  if (versions.some((version) => entryContentKey(version) === entryContentKey(entry))) {
    return history
  }
  return {
    ...history,
    [entry.id]: [activeCopy(entry), ...versions].slice(0, MAX_HISTORY_VERSIONS),
  }
}

export function upsertEntry(data: VaultData, entry: Entry, record = true): VaultData {
  const existing = data.entries.find((item) => item.id === entry.id)
  if (!existing) {
    return { ...data, entries: [activeCopy(entry), ...data.entries] }
  }

  const contentChanged = entryContentKey(existing) !== entryContentKey(entry)
  return {
    ...data,
    entries: data.entries.map((item) => (item.id === entry.id ? activeCopy(entry) : item)),
    history: record && contentChanged ? recordHistory(data.history, existing) : data.history,
  }
}

export function trashEntry(data: VaultData, id: string): VaultData {
  const entry = data.entries.find((item) => item.id === id)
  if (!entry) return data

  const trashed: Entry = { ...activeCopy(entry), deletedAt: new Date().toISOString() }
  const nextTrash = [trashed, ...data.trash.filter((item) => item.id !== id)]
  const dropped = nextTrash.slice(MAX_TRASH_ITEMS)
  if (dropped.length === 0) {
    return {
      ...data,
      entries: data.entries.filter((item) => item.id !== id),
      trash: nextTrash,
    }
  }

  const history = { ...data.history }
  for (const item of dropped) delete history[item.id]
  return {
    ...data,
    entries: data.entries.filter((item) => item.id !== id),
    trash: nextTrash.slice(0, MAX_TRASH_ITEMS),
    history,
  }
}

export function restoreEntry(data: VaultData, id: string): VaultData {
  const trashed = data.trash.find((item) => item.id === id)
  if (!trashed) return data

  return {
    ...data,
    entries: [touch(activeCopy(trashed)), ...data.entries.filter((item) => item.id !== id)],
    trash: data.trash.filter((item) => item.id !== id),
  }
}

export function deleteTrashedEntry(data: VaultData, id: string): VaultData {
  const history = { ...data.history }
  delete history[id]
  return {
    ...data,
    trash: data.trash.filter((item) => item.id !== id),
    history,
  }
}

export function restoreVersion(
  data: VaultData,
  entryId: string,
  versionUpdatedAt: string,
): VaultData {
  const current = data.entries.find((item) => item.id === entryId)
  const version = data.history[entryId]?.find((item) => item.updatedAt === versionUpdatedAt)
  if (!current || !version) return data

  return {
    ...data,
    entries: data.entries.map((item) =>
      item.id === entryId ? touch(activeCopy(version)) : item,
    ),
    history: recordHistory(data.history, current),
  }
}

export function sortTrash(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) =>
    (b.deletedAt ?? b.updatedAt).localeCompare(a.deletedAt ?? a.updatedAt),
  )
}

export function matchesQuery(entry: Entry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [entry.title, entry.username, entry.url, entry.notes, ...entry.tags]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((term) => haystack.includes(term))
}

export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  })
}

export function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
