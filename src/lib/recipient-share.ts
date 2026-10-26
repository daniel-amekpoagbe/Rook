import { decryptBytes, encryptBytes, fromB64, toB64, type SealedBlob } from './crypto'
import { SHARE_KEY_BYTES, SHARE_TTL_MS } from './share'

/**
 * Recipient-bound shares use two layers:
 *
 *   payload  = XChaCha20-Poly1305(random share key, share id as AAD)
 *   envelope = ECDH(P-256) + HKDF-SHA256 + XChaCha20-Poly1305(share key)
 *
 * The envelope is bound to the share id and both account handles. The server
 * stores ciphertext and the recipient's public envelope, but never the share
 * key or the recipient's private key.
 */
export const RECIPIENT_SHARE_TTL_MS = SHARE_TTL_MS
export const RECIPIENT_SHARE_FORMAT_VERSION = 1
export const IDENTITY_FORMAT_VERSION = 1
export const IDENTITY_CURVE = 'P-256'

const HKDF_SALT = new TextEncoder().encode('rook.recipient-share.v1')

export interface RecipientEnvelope {
  ephemeralPublicKey: string
  wrapNonce: string
  wrappedKey: string
}

export interface IdentityRecord {
  publicKey: string
  ciphertext: string
  nonce: string
  createdAt: number
  updatedAt: number
}

export interface Identity {
  publicKey: string
  privateKey: CryptoKey
}

export interface CreatedIdentity extends Identity {
  ciphertext: string
  nonce: string
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value)
}

export function identityAad(handle: string): string {
  return JSON.stringify({
    format: 'rook.identity',
    version: IDENTITY_FORMAT_VERSION,
    handle,
  })
}

export function recipientShareAad(input: {
  shareId: string
  ownerHandle: string
  recipientHandle: string
}): string {
  return JSON.stringify({
    format: 'rook.recipient-share',
    version: RECIPIENT_SHARE_FORMAT_VERSION,
    shareId: input.shareId,
    owner: input.ownerHandle,
    recipient: input.recipientHandle,
  })
}

function newIdentityKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: IDENTITY_CURVE },
    true,
    ['deriveBits'],
  ) as Promise<CryptoKeyPair>
}

async function importPublicKey(publicKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    Uint8Array.from(fromB64(publicKey)),
    { name: 'ECDH', namedCurve: IDENTITY_CURVE },
    true,
    [],
  )
}

async function importPrivateKey(privateKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(privateKey),
    { name: 'ECDH', namedCurve: IDENTITY_CURVE },
    true,
    ['deriveBits'],
  )
}

async function deriveWrappingKey(secret: ArrayBuffer, context: string): Promise<Uint8Array> {
  const hkdfKey = await crypto.subtle.importKey('raw', secret, 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: bytes(context),
    },
    hkdfKey,
    256,
  )
  return new Uint8Array(bits)
}

/**
 * Generate an account identity and seal its private key with the vault key.
 * The public half is safe to publish; the private half is only ever stored as
 * AEAD ciphertext under a key derived from the master password.
 */
export async function createIdentity(
  handle: string,
  vaultKey: Uint8Array,
): Promise<CreatedIdentity> {
  const pair = await newIdentityKeyPair()
  const publicKey = toB64(
    new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)),
  )
  const privateKey = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', pair.privateKey),
  )
  try {
    const sealed = encryptBytes(vaultKey, privateKey, identityAad(handle))
    return {
      publicKey,
      privateKey: pair.privateKey,
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
    }
  } finally {
    privateKey.fill(0)
  }
}

/**
 * Decrypt and import the identity private key. The public key is checked
 * against the private key so a swapped row cannot silently produce a broken
 * sharing identity.
 */
export async function openIdentity(
  row: Pick<IdentityRecord, 'publicKey' | 'ciphertext' | 'nonce'>,
  vaultKey: Uint8Array,
  handle: string,
): Promise<Identity> {
  const privateKeyBytes = decryptBytes(
    vaultKey,
    { ciphertext: row.ciphertext, nonce: row.nonce },
    identityAad(handle),
  )
  try {
    const privateKey = await importPrivateKey(privateKeyBytes)
    const publicKey = await importPublicKey(row.publicKey)
    const [privateJwk, publicJwk] = await Promise.all([
      crypto.subtle.exportKey('jwk', privateKey),
      crypto.subtle.exportKey('jwk', publicKey),
    ])
    if (privateJwk.x !== publicJwk.x || privateJwk.y !== publicJwk.y) {
      throw new Error('IDENTITY_MISMATCH')
    }
    return { publicKey: row.publicKey, privateKey }
  } finally {
    privateKeyBytes.fill(0)
  }
}

/** Re-seal the identity private key when the master password rotates. */
export async function sealIdentityPrivateKey(
  identity: Identity,
  vaultKey: Uint8Array,
  handle: string,
): Promise<SealedBlob> {
  const privateKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', identity.privateKey),
  )
  try {
    return encryptBytes(vaultKey, privateKeyBytes, identityAad(handle))
  } finally {
    privateKeyBytes.fill(0)
  }
}

/**
 * Wrap a random share key to one recipient's P-256 public key. A fresh
 * ephemeral key pair is used for every share, so the envelope cannot be
 * replayed for a different recipient or share id.
 */
export async function sealShareKeyForRecipient(input: {
  shareKey: Uint8Array
  recipientPublicKey: string
  shareId: string
  ownerHandle: string
  recipientHandle: string
}): Promise<RecipientEnvelope> {
  if (input.shareKey.length !== SHARE_KEY_BYTES) throw new Error('SHARE_KEY_INVALID')
  const recipientKey = await importPublicKey(input.recipientPublicKey)
  const ephemeral = await newIdentityKeyPair()
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientKey },
    ephemeral.privateKey,
    256,
  )
  try {
    const context = recipientShareAad(input)
    const wrappingKey = await deriveWrappingKey(secret, context)
    try {
      const sealed = encryptBytes(wrappingKey, input.shareKey, context)
      const ephemeralPublicKey = toB64(
        new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey)),
      )
      return {
        ephemeralPublicKey,
        wrapNonce: sealed.nonce,
        wrappedKey: sealed.ciphertext,
      }
    } finally {
      wrappingKey.fill(0)
    }
  } finally {
    new Uint8Array(secret).fill(0)
  }
}

/** Open the share key with the recipient's private identity key. */
export async function openShareKeyFromRecipient(input: {
  envelope: RecipientEnvelope
  privateKey: CryptoKey
  shareId: string
  ownerHandle: string
  recipientHandle: string
}): Promise<Uint8Array> {
  const ephemeralKey = await importPublicKey(input.envelope.ephemeralPublicKey)
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralKey },
    input.privateKey,
    256,
  )
  try {
    const context = recipientShareAad(input)
    const wrappingKey = await deriveWrappingKey(secret, context)
    try {
      const shareKey = decryptBytes(
        wrappingKey,
        { ciphertext: input.envelope.wrappedKey, nonce: input.envelope.wrapNonce },
        context,
      )
      if (shareKey.length !== SHARE_KEY_BYTES) {
        shareKey.fill(0)
        throw new Error('SHARE_KEY_INVALID')
      }
      return shareKey
    } finally {
      wrappingKey.fill(0)
    }
  } finally {
    new Uint8Array(secret).fill(0)
  }
}
