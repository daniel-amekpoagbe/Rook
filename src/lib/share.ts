import { z } from 'zod'
import { randomBytes } from '@noble/hashes/utils.js'
import { decrypt, encrypt, fromB64, toB64, type SealedBlob } from './crypto'

/** Shared links live for exactly three days. */
export const SHARE_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const SHARE_FORMAT_VERSION = 1
export const SHARE_KEY_BYTES = 32

/**
 * The URL fragment carries the only key that can open a share. It is never
 * sent to the server, so a database leak exposes ciphertext without a way to
 * decrypt it.
 */
export const sharePayloadSchema = z.object({
  version: z.literal(SHARE_FORMAT_VERSION),
  title: z.string().min(1).max(200),
  username: z.string().max(300).optional(),
  password: z.string().min(1).max(2000),
  url: z.string().max(2000).optional(),
  from: z.string().max(64).optional(),
  expiresAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid share expiry'),
})

export type SharePayload = z.infer<typeof sharePayloadSchema>

export function shareAad(id: string): string {
  return `rook.share.v1:${id}`
}

export function formatShareRemaining(expiresAt: number, now = Date.now()): string {
  const seconds = Math.max(1, Math.ceil((expiresAt - now) / 1000))
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${seconds}s`
}

function toBase64Url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return fromB64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
}

export function newShareKey(): { key: Uint8Array; encoded: string } {
  const key = randomBytes(SHARE_KEY_BYTES)
  return { key, encoded: toBase64Url(key) }
}

export function decodeShareKey(encoded: string): Uint8Array {
  const key = fromBase64Url(encoded)
  if (key.length !== SHARE_KEY_BYTES) throw new Error('Invalid share key')
  return key
}

export function sealShare(payload: SharePayload, key: Uint8Array, id: string): SealedBlob {
  const valid = sharePayloadSchema.parse(payload)
  return encrypt(key, JSON.stringify(valid), shareAad(id))
}

export function openShare(blob: SealedBlob, key: Uint8Array, id: string): SharePayload {
  const plaintext = decrypt(key, blob, shareAad(id))
  return sharePayloadSchema.parse(JSON.parse(plaintext))
}
