/**
 * Rook crypto core.
 *
 * Design (zero-knowledge):
 *   masterKey = Argon2id(masterPassword, salt)          // never leaves the device
 *   authKey   = HKDF-SHA256(masterKey, "keynest/auth/v1")  // proves identity to server
 *   vaultKey  = HKDF-SHA256(masterKey, "keynest/vault/v1") // encrypts the vault blob
 *
 * The server only ever receives SHA-256(authKey) and opaque ciphertext, so it can
 * never decrypt a vault and a database leak cannot be replayed as a login.
 *
 * The HKDF labels are wire-format domain separators from the pre-rename build.
 * They are intentionally unchanged: renaming them would derive different keys and
 * make every existing vault undecryptable. They are not visible branding.
 */
import { argon2id } from '@noble/hashes/argon2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/hashes/utils.js'

export const KEY_BYTES = 32
export const NONCE_BYTES = 24
export const SALT_BYTES = 16

export const AUTH_INFO = 'keynest/auth/v1'
export const VAULT_INFO = 'keynest/vault/v1'

export interface KdfConfig {
  algorithm: 'argon2id'
  /** iterations */
  t: number
  /** memory cost in KiB */
  m: number
  /** parallelism */
  p: number
  /** base64 salt */
  salt: string
}

/**
 * 64 MiB / t=3 is the OWASP 2024 floor for Argon2id and costs ~1s in the browser,
 * which is a deliberate unlock delay rather than a problem.
 */
export const DEFAULT_KDF_PARAMS = { t: 3, m: 65536, p: 1 } as const

export function toB64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromB64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomSalt(): Uint8Array {
  return randomBytes(SALT_BYTES)
}

export function newKdfConfig(): KdfConfig {
  return { algorithm: 'argon2id', ...DEFAULT_KDF_PARAMS, salt: toB64(randomSalt()) }
}

/** Argon2id is synchronous and CPU-bound; yield first so the UI can paint. */
export async function deriveMasterKey(password: string, kdf: KdfConfig): Promise<Uint8Array> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  const passwordBytes = new TextEncoder().encode(password.normalize('NFKC'))
  return argon2id(passwordBytes, fromB64(kdf.salt), {
    t: kdf.t,
    m: kdf.m,
    p: kdf.p,
    dkLen: KEY_BYTES,
  })
}

export function deriveAuthKey(masterKey: Uint8Array): Uint8Array {
  return hkdf(sha256, masterKey, undefined, new TextEncoder().encode(AUTH_INFO), KEY_BYTES)
}

export function deriveVaultKey(masterKey: Uint8Array): Uint8Array {
  return hkdf(sha256, masterKey, undefined, new TextEncoder().encode(VAULT_INFO), KEY_BYTES)
}

/** The only secret-derived value the server ever sees. */
export function authProof(authKey: Uint8Array): string {
  return toHex(sha256(authKey))
}

export interface SealedBlob {
  nonce: string
  ciphertext: string
}

export function encrypt(key: Uint8Array, plaintext: string, aad: string): SealedBlob {
  const nonce = randomBytes(NONCE_BYTES)
  const bytes = new TextEncoder().encode(plaintext)
  const ciphertext = xchacha20poly1305(key, nonce, new TextEncoder().encode(aad)).encrypt(bytes)
  return { nonce: toB64(nonce), ciphertext: toB64(ciphertext) }
}

/** Throws on wrong key or tampered ciphertext/AAD. */
export function decrypt(key: Uint8Array, blob: SealedBlob, aad: string): string {
  const plaintext = xchacha20poly1305(key, fromB64(blob.nonce), new TextEncoder().encode(aad)).decrypt(
    fromB64(blob.ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}
