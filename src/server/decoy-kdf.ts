import { createHmac } from 'node:crypto'
import { DEFAULT_KDF_PARAMS, type KdfConfig } from '~/lib/crypto'

/**
 * Stable Argon2 parameters for a username that is not registered.
 * The salt is an HMAC, so a caller cannot tell it apart from a random salt
 * unless they already know this server's pepper.
 */
export function decoyKdf(handle: string, pepper: string): KdfConfig {
  const salt = createHmac('sha256', pepper)
    .update(`rook/kdf-decoy/v1\0${handle}`)
    .digest()
    .subarray(0, 16)
    .toString('base64')
  return { algorithm: 'argon2id', ...DEFAULT_KDF_PARAMS, salt }
}
