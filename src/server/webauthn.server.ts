/**
 * WebAuthn server-side ceremonies. Passkeys authenticate the server session;
 * they never see or derive the vault key.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { getRequestHeaders } from '@tanstack/react-start/server'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import {
  createPasskey,
  createWebAuthnChallenge,
  countPasskeys,
  deleteExpiredWebAuthnChallenges,
  deletePasskeyForUser,
  deletePasskeyRecovery,
  deleteWebAuthnChallengesForUser,
  findUserById,
  getPasskeyByCredentialId,
  getPasskeyRecovery,
  isRateLimited,
  listPasskeys as listPasskeyRows,
  recordFailure,
  clearFailures,
  takeWebAuthnChallenge,
  updatePasskeyAfterUse,
  upsertPasskeyRecovery,
  type PasskeyRow,
  type UserRow,
} from './db.server'
import { constantTimeEqual, sha256Hex } from './session.server'
import { formatRecoveryCode, normalizeRecoveryCode, type PasskeySummary } from '~/lib/passkeys'
import { resolveRelyingParty } from '~/lib/webauthn-origin'

const RP_NAME = 'Rook'
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const REGISTRATION_KIND = 'passkey-registration'
const AUTHENTICATION_KIND = 'passkey-authentication'
const RECOVERY_KIND = 'passkey-recovery'

const VALID_TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
])

function relyingParty(): { origin: string; rpID: string } {
  const headers = getRequestHeaders()
  return resolveRelyingParty({
    originOverride: process.env.ROOK_WEBAUTHN_ORIGIN,
    rpIdOverride: process.env.ROOK_WEBAUTHN_RP_ID,
    forwardedHost: headers.get('x-forwarded-host'),
    forwardedProto: headers.get('x-forwarded-proto'),
    host: headers.get('host'),
  })
}

function parseTransports(raw: string): AuthenticatorTransportFuture[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is AuthenticatorTransportFuture =>
        typeof item === 'string' && VALID_TRANSPORTS.has(item as AuthenticatorTransportFuture),
    )
  } catch {
    return []
  }
}

function toSummary(row: PasskeyRow): PasskeySummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
  }
}

function generateRecoveryCode(): string {
  return formatRecoveryCode(randomBytes(20).toString('hex'))
}

export async function beginPasskeyRegistration(user: UserRow): Promise<{
  challengeId: string
  options: PublicKeyCredentialCreationOptionsJSON
}> {
  const now = Date.now()
  await deleteExpiredWebAuthnChallenges(now)
  await deleteWebAuthnChallengesForUser(user.id, REGISTRATION_KIND)

  const existing = await listPasskeyRows(user.id)
  const { rpID } = relyingParty()
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.handle,
    userDisplayName: user.handle,
    attestationType: 'none',
    excludeCredentials: existing.map((passkey) => ({
      id: passkey.credential_id,
      transports: parseTransports(passkey.transports),
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60_000,
  })

  const challengeId = randomUUID()
  await createWebAuthnChallenge({
    id: challengeId,
    user_id: user.id,
    kind: REGISTRATION_KIND,
    challenge: options.challenge,
    expires_at: now + CHALLENGE_TTL_MS,
  })
  return { challengeId, options }
}

export async function finishPasskeyRegistration(
  user: UserRow,
  challengeId: string,
  response: unknown,
): Promise<{ passkey: PasskeySummary; recoveryCode: string | null }> {
  const challenge = await takeWebAuthnChallenge(challengeId, REGISTRATION_KIND)
  if (!challenge || challenge.user_id !== user.id) {
    throw new Error('PASSKEY_CHALLENGE_EXPIRED')
  }

  const { origin, rpID } = relyingParty()
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
  } catch {
    throw new Error('PASSKEY_REGISTRATION_FAILED')
  }
  if (!verification.verified) throw new Error('PASSKEY_REGISTRATION_FAILED')

  const info = verification.registrationInfo
  const credential = info.credential
  if (await getPasskeyByCredentialId(credential.id)) {
    throw new Error('PASSKEY_ALREADY_REGISTERED')
  }

  const existingNames = new Set((await listPasskeyRows(user.id)).map((passkey) => passkey.name))
  let ordinal = 1
  while (existingNames.has(`Passkey ${ordinal}`)) ordinal += 1

  const now = Date.now()
  const row: PasskeyRow = {
    id: randomUUID(),
    user_id: user.id,
    credential_id: credential.id,
    public_key: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: JSON.stringify(credential.transports ?? []),
    device_type: info.credentialDeviceType,
    backed_up: info.credentialBackedUp ? 1 : 0,
    aaguid: info.aaguid,
    name: `Passkey ${ordinal}`,
    created_at: now,
    last_used_at: null,
  }
  await createPasskey(row)

  let recoveryCode: string | null = null
  if (!(await getPasskeyRecovery(user.id))) {
    recoveryCode = generateRecoveryCode()
    await upsertPasskeyRecovery(user.id, sha256Hex(normalizeRecoveryCode(recoveryCode)), now)
  }

  return { passkey: toSummary(row), recoveryCode }
}

export async function beginPasskeyLogin(user: UserRow): Promise<{
  challengeId: string
  options: PublicKeyCredentialRequestOptionsJSON
  recoveryChallengeId: string | null
}> {
  const now = Date.now()
  await deleteExpiredWebAuthnChallenges(now)
  await deleteWebAuthnChallengesForUser(user.id, AUTHENTICATION_KIND)
  await deleteWebAuthnChallengesForUser(user.id, RECOVERY_KIND)

  const passkeys = await listPasskeyRows(user.id)
  if (passkeys.length === 0) throw new Error('PASSKEY_NOT_FOUND')

  const { rpID } = relyingParty()
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: parseTransports(passkey.transports),
    })),
    userVerification: 'preferred',
    timeout: 60_000,
  })

  const challengeId = randomUUID()
  await createWebAuthnChallenge({
    id: challengeId,
    user_id: user.id,
    kind: AUTHENTICATION_KIND,
    challenge: options.challenge,
    expires_at: now + CHALLENGE_TTL_MS,
  })

  let recoveryChallengeId: string | null = null
  if (await getPasskeyRecovery(user.id)) {
    recoveryChallengeId = randomUUID()
    await createWebAuthnChallenge({
      id: recoveryChallengeId,
      user_id: user.id,
      kind: RECOVERY_KIND,
      challenge: randomUUID(),
      expires_at: now + CHALLENGE_TTL_MS,
    })
  }

  return { challengeId, options, recoveryChallengeId }
}

export async function finishPasskeyLogin(
  challengeId: string,
  response: unknown,
): Promise<{ user: UserRow }> {
  const challenge = await takeWebAuthnChallenge(challengeId, AUTHENTICATION_KIND)
  if (!challenge) throw new Error('PASSKEY_CHALLENGE_EXPIRED')

  const user = await findUserById(challenge.user_id)
  if (!user) throw new Error('INVALID_CREDENTIALS')

  const credentialId =
    response && typeof response === 'object' && typeof (response as { id?: unknown }).id === 'string'
      ? (response as { id: string }).id
      : null
  const passkey = credentialId ? await getPasskeyByCredentialId(credentialId) : undefined
  if (!passkey || passkey.user_id !== user.id) {
    await deleteWebAuthnChallengesForUser(user.id)
    throw new Error('PASSKEY_NOT_FOUND')
  }

  const { origin, rpID } = relyingParty()
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, 'base64url'),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports),
      },
      requireUserVerification: false,
    })
  } catch {
    await deleteWebAuthnChallengesForUser(user.id)
    throw new Error('PASSKEY_LOGIN_FAILED')
  }
  if (!verification.verified) {
    await deleteWebAuthnChallengesForUser(user.id)
    throw new Error('PASSKEY_LOGIN_FAILED')
  }

  await updatePasskeyAfterUse(
    passkey.id,
    verification.authenticationInfo.newCounter,
    Date.now(),
    verification.authenticationInfo.credentialDeviceType,
    verification.authenticationInfo.credentialBackedUp,
  )
  await deleteWebAuthnChallengesForUser(user.id, RECOVERY_KIND)
  return { user }
}

export async function finishPasskeyRecovery(
  challengeId: string,
  code: string,
): Promise<{ user: UserRow }> {
  const challenge = await takeWebAuthnChallenge(challengeId, RECOVERY_KIND)
  if (!challenge) throw new Error('PASSKEY_CHALLENGE_EXPIRED')

  const user = await findUserById(challenge.user_id)
  if (!user) throw new Error('INVALID_CREDENTIALS')

  const recovery = await getPasskeyRecovery(user.id)
  if (!recovery) throw new Error('RECOVERY_UNAVAILABLE')

  const now = Date.now()
  const bucket = `passkey-recovery:${user.handle}`
  if (await isRateLimited(bucket, now)) throw new Error('RATE_LIMITED')

  const suppliedHash = sha256Hex(normalizeRecoveryCode(code))
  if (!constantTimeEqual(recovery.code_hash, suppliedHash)) {
    await recordFailure(bucket, now, 15 * 60 * 1000)
    await deleteWebAuthnChallengesForUser(user.id)
    throw new Error('INVALID_RECOVERY_CODE')
  }

  await clearFailures(bucket)
  await deleteWebAuthnChallengesForUser(user.id, AUTHENTICATION_KIND)
  return { user }
}

export async function listPasskeys(user: UserRow): Promise<{
  passkeys: PasskeySummary[]
  recoveryAvailable: boolean
}> {
  return {
    passkeys: (await listPasskeyRows(user.id)).map(toSummary),
    recoveryAvailable: Boolean(await getPasskeyRecovery(user.id)),
  }
}

export async function removePasskey(
  user: UserRow,
  passkeyId: string,
): Promise<{ remaining: number }> {
  if (!(await deletePasskeyForUser(passkeyId, user.id))) {
    throw new Error('PASSKEY_NOT_FOUND')
  }
  const remaining = await countPasskeys(user.id)
  if (remaining === 0) await deletePasskeyRecovery(user.id)
  return { remaining }
}
