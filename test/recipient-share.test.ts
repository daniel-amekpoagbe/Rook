import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomBytes } from '@noble/hashes/utils.js'
import {
  createIdentity,
  openIdentity,
  openShareKeyFromRecipient,
  recipientShareAad,
  sealIdentityPrivateKey,
  sealShareKeyForRecipient,
} from '../src/lib/recipient-share'
import {
  newShareKey,
  openShare,
  sealShare,
  SHARE_FORMAT_VERSION,
  SHARE_TTL_MS,
  type SharePayload,
} from '../src/lib/share'

const HANDLE = 'alice@example.com'
const OWNER = 'owner@example.com'

function key(): Uint8Array {
  return randomBytes(32)
}

test('an identity private key round-trips under the vault key', async () => {
  const vaultKey = key()
  const identity = await createIdentity(HANDLE, vaultKey)
  const row = {
    publicKey: identity.publicKey,
    ciphertext: identity.ciphertext,
    nonce: identity.nonce,
  }

  const opened = await openIdentity(row, vaultKey, HANDLE)
  assert.equal(opened.publicKey, identity.publicKey)

  await assert.rejects(() => openIdentity(row, key(), HANDLE))
  await assert.rejects(() => openIdentity(row, vaultKey, 'bob@example.com'))
})

test('a swapped identity row is rejected before it can break sharing', async () => {
  const vaultKey = key()
  const alice = await createIdentity(HANDLE, vaultKey)
  const bob = await createIdentity('bob@example.com', vaultKey)

  await assert.rejects(
    () =>
      openIdentity(
        {
          publicKey: bob.publicKey,
          ciphertext: alice.ciphertext,
          nonce: alice.nonce,
        },
        vaultKey,
        HANDLE,
      ),
    /IDENTITY_MISMATCH/,
  )
})

test('master-password rotation can re-wrap the same identity', async () => {
  const oldVaultKey = key()
  const nextVaultKey = key()
  const identity = await createIdentity(HANDLE, oldVaultKey)
  const sealed = await sealIdentityPrivateKey(identity, nextVaultKey, HANDLE)
  const reopened = await openIdentity(
    { publicKey: identity.publicKey, ...sealed },
    nextVaultKey,
    HANDLE,
  )

  assert.equal(reopened.publicKey, identity.publicKey)
})

test('a share key is wrapped for exactly one recipient and one share', async () => {
  const vaultKey = key()
  const alice = await createIdentity(HANDLE, vaultKey)
  const bob = await createIdentity('bob@example.com', vaultKey)
  const { key: shareKey } = newShareKey()
  const shareId = crypto.randomUUID()
  const envelope = await sealShareKeyForRecipient({
    shareKey,
    recipientPublicKey: alice.publicKey,
    shareId,
    ownerHandle: OWNER,
    recipientHandle: HANDLE,
  })

  const opened = await openShareKeyFromRecipient({
    envelope,
    privateKey: alice.privateKey,
    shareId,
    ownerHandle: OWNER,
    recipientHandle: HANDLE,
  })
  assert.deepEqual(opened, shareKey)

  await assert.rejects(() =>
    openShareKeyFromRecipient({
      envelope,
      privateKey: bob.privateKey,
      shareId,
      ownerHandle: OWNER,
      recipientHandle: HANDLE,
    }),
  )
})

test('the envelope AAD binds the share id and both handles', async () => {
  const vaultKey = key()
  const alice = await createIdentity(HANDLE, vaultKey)
  const { key: shareKey } = newShareKey()
  const shareId = crypto.randomUUID()
  const envelope = await sealShareKeyForRecipient({
    shareKey,
    recipientPublicKey: alice.publicKey,
    shareId,
    ownerHandle: OWNER,
    recipientHandle: HANDLE,
  })

  await assert.rejects(() =>
    openShareKeyFromRecipient({
      envelope,
      privateKey: alice.privateKey,
      shareId: crypto.randomUUID(),
      ownerHandle: OWNER,
      recipientHandle: HANDLE,
    }),
  )
  await assert.rejects(() =>
    openShareKeyFromRecipient({
      envelope,
      privateKey: alice.privateKey,
      shareId,
      ownerHandle: 'other@example.com',
      recipientHandle: HANDLE,
    }),
  )
  await assert.rejects(() =>
    openShareKeyFromRecipient({
      envelope,
      privateKey: alice.privateKey,
      shareId,
      ownerHandle: OWNER,
      recipientHandle: 'bob@example.com',
    }),
  )
})

test('tampered wrapped keys fail authentication', async () => {
  const vaultKey = key()
  const alice = await createIdentity(HANDLE, vaultKey)
  const { key: shareKey } = newShareKey()
  const shareId = crypto.randomUUID()
  const envelope = await sealShareKeyForRecipient({
    shareKey,
    recipientPublicKey: alice.publicKey,
    shareId,
    ownerHandle: OWNER,
    recipientHandle: HANDLE,
  })
  const tampered = {
    ...envelope,
    wrappedKey: `${envelope.wrappedKey.slice(0, -4)}AAAA`,
  }

  await assert.rejects(() =>
    openShareKeyFromRecipient({
      envelope: tampered,
      privateKey: alice.privateKey,
      shareId,
      ownerHandle: OWNER,
      recipientHandle: HANDLE,
    }),
  )
})

test('the recipient can open the payload with the unwrapped share key', async () => {
  const vaultKey = key()
  const alice = await createIdentity(HANDLE, vaultKey)
  const { key: shareKey } = newShareKey()
  const shareId = crypto.randomUUID()
  const payload: SharePayload = {
    version: SHARE_FORMAT_VERSION,
    title: 'GitHub',
    username: 'daniel',
    password: 'correct horse battery staple',
    url: 'https://github.com',
    from: OWNER,
    expiresAt: new Date(Date.now() + SHARE_TTL_MS).toISOString(),
  }
  const sealed = sealShare(payload, shareKey, shareId)
  const envelope = await sealShareKeyForRecipient({
    shareKey,
    recipientPublicKey: alice.publicKey,
    shareId,
    ownerHandle: OWNER,
    recipientHandle: HANDLE,
  })
  const openedKey = await openShareKeyFromRecipient({
    envelope,
    privateKey: alice.privateKey,
    shareId,
    ownerHandle: OWNER,
    recipientHandle: HANDLE,
  })
  try {
    assert.deepEqual(openShare(sealed, openedKey, shareId), payload)
  } finally {
    openedKey.fill(0)
  }
})

test('recipient share AAD is stable and includes both account handles', () => {
  const aad = recipientShareAad({
    shareId: 'share-id',
    ownerHandle: OWNER,
    recipientHandle: HANDLE,
  })
  assert.match(aad, /rook\.recipient-share/)
  assert.match(aad, /owner@example\.com/)
  assert.match(aad, /alice@example\.com/)
})
