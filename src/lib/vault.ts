import { z } from 'zod'
import { decrypt, encrypt, type KdfConfig, type SealedBlob } from './crypto'

export const VAULT_FORMAT = 'rook.vault'
/** Pre-rename backups remain readable; new saves use `rook.vault`. */
export const LEGACY_VAULT_FORMAT = 'keynest.vault'
export const VAULT_FORMAT_VERSION = 1
export const VAULT_DATA_VERSION = 2

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
})

export type Entry = z.infer<typeof entrySchema>

export const vaultDataSchema = z.object({
  version: z.literal(VAULT_DATA_VERSION),
  entries: z.array(entrySchema).max(10000),
})

export type VaultData = z.infer<typeof vaultDataSchema>

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
  return { version: VAULT_DATA_VERSION, entries: [] }
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
  return vaultDataSchema.parse(JSON.parse(plaintext))
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
  fields: Partial<Omit<Entry, 'id' | 'type' | 'createdAt' | 'updatedAt' | 'tags' | 'favorite'>> = {},
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
