import { z } from 'zod'
import { randomBytes } from '@noble/hashes/utils.js'
import {
  decryptBytes,
  encryptBytes,
  fromB64,
  toB64,
  type SealedBlob,
} from './crypto'

/**
 * Attachment limits are enforced in the browser before upload and again on the
 * server. The server stores ciphertext only, so these are storage limits rather
 * than content checks.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_ENTRY = 20
export const MAX_ATTACHMENTS_PER_USER = 200
export const MAX_ATTACHMENT_TOTAL_BYTES = 100 * 1024 * 1024
export const ATTACHMENT_KEY_BYTES = 32

/**
 * Per-file keys are random and wrapped by the encrypted vault payload. That
 * keeps master-password rotation cheap: the vault is re-encrypted, the file
 * blobs are not.
 */
export const attachmentSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  size: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
  type: z.string().max(200).optional(),
  key: z.string().min(40).max(64),
  createdAt: z.string(),
})

export type Attachment = z.infer<typeof attachmentSchema>

export function attachmentAad(
  id: string,
  entryId: string,
  name: string,
  size: number,
  type?: string,
): string {
  return JSON.stringify({
    format: 'rook.attachment',
    version: 1,
    id,
    entryId,
    name,
    size,
    type: type ?? '',
  })
}

export function newAttachmentKey(): { key: Uint8Array; encoded: string } {
  const key = randomBytes(ATTACHMENT_KEY_BYTES)
  return { key, encoded: toB64(key) }
}

export function decodeAttachmentKey(encoded: string): Uint8Array {
  const key = fromB64(encoded)
  if (key.length !== ATTACHMENT_KEY_BYTES) throw new Error('ATTACHMENT_KEY_INVALID')
  return key
}

export function sealAttachment(
  key: Uint8Array,
  bytes: Uint8Array,
  aad: string,
): SealedBlob {
  return encryptBytes(key, bytes, aad)
}

export function openAttachment(
  key: Uint8Array,
  blob: SealedBlob,
  aad: string,
): Uint8Array {
  return decryptBytes(key, blob, aad)
}

export function safeAttachmentName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 200)
  return cleaned || 'Attachment'
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]!
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]!
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
}
