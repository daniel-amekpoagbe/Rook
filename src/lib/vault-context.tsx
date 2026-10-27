import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import {
  authProof,
  deriveAuthKey,
  deriveMasterKey,
  deriveVaultKey,
  newKdfConfig,
  type KdfConfig,
} from './crypto'
import {
  createIdentity,
  openIdentity,
  sealIdentityPrivateKey,
  type Identity,
} from './recipient-share'
import {
  deleteTrashedEntry,
  emptyVault,
  entryFingerprint,
  isSupportedVaultFormat,
  MAX_ENTRIES,
  MAX_HISTORY_VERSIONS,
  MAX_TOMBSTONES,
  MAX_TRASH_ITEMS,
  mergeVaultData,
  openVault,
  openVaultWithFallback,
  sealVault,
  touch,
  upsertEntry,
  VAULT_FORMAT_VERSION,
  type EncryptedVault,
  type Entry,
  type Tombstone,
  type VaultData,
} from './vault'
import {
  createIdentityFn,
  deleteRecipientSharesForEntryFn,
  finishPasskeyLoginFn,
  finishPasskeyRecoveryFn,
  getIdentityFn,
  kdfFn,
  loginFn,
  logoutFn,
  meFn,
  pullVaultFn,
  pushVaultFn,
  registerFn,
  rotateFn,
  verifyAuthFn,
} from '~/server/api'

type Status = 'booting' | 'locked' | 'unlocked'
type SyncState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'

export type ConflictChoice = 'mine' | 'server' | 'merge'

export interface VaultConflict {
  remoteVersion: number
  remoteUpdatedAt: number
  detectedAt: number
  remoteEntries: number
  remoteTrash: number
}

interface ConflictSnapshot {
  remote: VaultData
  remoteVersion: number
  remoteUpdatedAt: number
  detectedAt: number
}

const ERROR_MESSAGES: Record<string, string> = {
  HANDLE_TAKEN: 'That username is already taken.',
  INVALID_CREDENTIALS: 'Wrong master password.',
  RATE_LIMITED: 'Too many attempts. Try again in a few minutes.',
  UNAUTHENTICATED: 'Your session expired. Unlock again.',
  CONFLICT: 'This vault changed in another session. Resolve the conflict before saving.',
  VAULT_MISSING: 'No vault found for this account.',
  PASSKEY_CHALLENGE_EXPIRED: 'That passkey request expired. Unlock again.',
  PASSKEY_REGISTRATION_FAILED: 'The passkey could not be registered. Try again.',
  PASSKEY_LOGIN_FAILED: 'Passkey verification failed. Unlock again.',
  PASSKEY_NOT_FOUND: 'That passkey is not registered for this account.',
  PASSKEY_ALREADY_REGISTERED: 'That passkey is already registered.',
  INVALID_RECOVERY_CODE: 'That recovery code is not valid.',
  RECOVERY_UNAVAILABLE: 'No recovery code is available for this account.',
  WEBAUTHN_CONFIG: 'Passkeys are not configured correctly on the server.',
  ENTRY_NOT_FOUND: 'That item no longer exists.',
  RECIPIENT_NOT_FOUND: 'No Rook account uses that handle.',
  RECIPIENT_SELF: 'You already own this item.',
  RECIPIENT_NOT_READY:
    'That account is not ready to receive shares yet. Ask them to unlock Rook once, then try again.',
  RECIPIENT_KEY_CHANGED: 'That account’s sharing key changed. Try again.',
  SHARE_ALREADY_EXISTS: 'This item is already shared with that person.',
  SHARE_LIMIT: 'You have reached the limit of 50 active shares. Revoke an older share first.',
  SHARE_ENTRY_LIMIT: 'This item is shared with 20 people. Revoke one before adding another.',
  SHARE_NOT_FOUND: 'That share no longer exists.',
  SHARE_KEY_INVALID: 'The share key was invalid.',
  SHARE_DECRYPT_FAILED:
    'This share could not be decrypted for your account. It may have been created for a different identity.',
  IDENTITY_REQUIRED:
    'Your sharing identity must be unlocked before changing the master password.',
  IDENTITY_MISSING: 'Your sharing identity is missing. Lock and unlock Rook, then try again.',
  IDENTITY_CHANGED: 'Your sharing identity changed in another session. Unlock again and retry.',
  IDENTITY_UNAVAILABLE: 'Your sharing identity is unavailable. Try again in a moment.',
  IDENTITY_MISMATCH: 'Your sharing identity could not be verified.',
  SHARE_CLEANUP_FAILED:
    'The item was deleted, but its active shares could not be revoked. They expire within three days.',
}

export function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      return 'Passkey verification was canceled.'
    }
    if (error.name === 'SecurityError') {
      return 'Passkeys require HTTPS or localhost.'
    }
    if (error.name === 'InvalidStateError') {
      return 'That passkey is already registered.'
    }
    if (error.name === 'NotSupportedError') {
      return 'This browser or authenticator does not support passkeys.'
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  if (ERROR_MESSAGES[message]) return ERROR_MESSAGES[message]

  // Server-side validation errors arrive as a serialized list of issues.
  try {
    const parsed = JSON.parse(message) as unknown
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0] as { message?: string }
      if (first?.message) return first.message
    }
    const single = parsed as { message?: string }
    if (single?.message) return single.message
  } catch {
    // Not JSON: fall through.
  }

  if (message.includes('invalid_format') || message.includes('too_small')) {
    return 'Please check the form and try again.'
  }
  return message
}

function isConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message === 'CONFLICT' || message.includes('CONFLICT')
}

interface Secrets {
  masterKey: Uint8Array
  vaultKey: Uint8Array
}

interface SaveWaiter {
  resolve: () => void
  reject: (error: unknown) => void
}

interface PendingSecrets {
  masterKey: Uint8Array
  kdf: KdfConfig
  handle: string
}

export interface PendingPasskey {
  challengeId: string
  options: PublicKeyCredentialRequestOptionsJSON
  recoveryChallengeId: string | null
  handle: string
}

interface VaultContextValue {
  status: Status
  handle: string | null
  data: VaultData | null
  sync: SyncState
  error: string | null
  conflict: VaultConflict | null
  pendingPasskey: PendingPasskey | null
  resolveConflict: (choice: ConflictChoice) => Promise<void>
  lastSyncedAt: number | null
  autoLockMinutes: number
  setAutoLockMinutes: (minutes: number) => void
  register: (handle: string, password: string) => Promise<void>
  unlock: (handle: string, password: string) => Promise<void>
  completePasskeyUnlock: () => Promise<void>
  completeRecoveryUnlock: (code: string) => Promise<void>
  cancelPasskeyUnlock: () => void
  lock: () => void
  signOut: () => Promise<void>
  mutate: (change: (data: VaultData) => VaultData) => void
  ensureIdentity: () => Promise<Identity>
  deleteEntryPermanently: (entryId: string) => Promise<void>
  changeMasterPassword: (current: string, next: string) => Promise<void>
  exportBackup: () => EncryptedVault | null
  exportCsv: () => string | null
  importBackup: (json: string, password: string) => Promise<void>
  importEntries: (entries: Entry[]) => { added: number; skipped: number }
  clearError: () => void
}

const VaultContext = createContext<VaultContextValue | null>(null)

function wipe(secrets: Secrets | null) {
  if (!secrets) return
  secrets.masterKey.fill(0)
  secrets.vaultKey.fill(0)
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('booting')
  const [handle, setHandle] = useState<string | null>(null)
  const [data, setData] = useState<VaultData | null>(null)
  const [sync, setSync] = useState<SyncState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<VaultConflict | null>(null)
  const [pendingPasskey, setPendingPasskey] = useState<PendingPasskey | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [autoLockMinutes, setAutoLockMinutesState] = useState(5)

  const secretsRef = useRef<Secrets | null>(null)
  const dataRef = useRef<VaultData | null>(null)
  const kdfRef = useRef<KdfConfig | null>(null)
  const versionRef = useRef(0)
  const pendingRef = useRef<VaultData | null>(null)
  const conflictRef = useRef<ConflictSnapshot | null>(null)
  const pendingPasskeyRef = useRef<PendingPasskey | null>(null)
  const pendingSecretsRef = useRef<PendingSecrets | null>(null)
  const savingRef = useRef(false)
  const saveWaitersRef = useRef<SaveWaiter[]>([])
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleRef = useRef<string | null>(null)
  const identityRef = useRef<Identity | null>(null)
  const identityLoadRef = useRef<Promise<Identity> | null>(null)
  const identityGenerationRef = useRef(0)

  const settleSaveWaiters = useCallback((error?: unknown) => {
    const waiters = saveWaitersRef.current
    saveWaitersRef.current = []
    for (const waiter of waiters) {
      if (error) waiter.reject(error)
      else waiter.resolve()
    }
  }, [])

  const clearPendingPasskey = useCallback(() => {
    const pending = pendingSecretsRef.current
    if (pending) pending.masterKey.fill(0)
    pendingSecretsRef.current = null
    pendingPasskeyRef.current = null
    setPendingPasskey(null)
  }, [])

  /**
   * Load or create the account's P-256 sharing identity. The private key is
   * decrypted into memory only after the vault is unlocked and is dropped on
   * lock. The server sees a public key plus ciphertext under the vault key.
   */
  const loadIdentity = useCallback(
    async (userHandle: string, vaultKey: Uint8Array): Promise<Identity> => {
      const current = identityRef.current
      if (current) return current
      if (identityLoadRef.current) return identityLoadRef.current

      const generation = identityGenerationRef.current
      const promise = (async () => {
        const assertCurrent = () => {
          if (
            generation !== identityGenerationRef.current ||
            secretsRef.current?.vaultKey !== vaultKey
          ) {
            throw new Error('Vault is locked')
          }
        }

        let row = await getIdentityFn()
        assertCurrent()
        if (!row) {
          const secrets = secretsRef.current
          if (!secrets || secrets.vaultKey !== vaultKey) throw new Error('Vault is locked')
          const authKey = deriveAuthKey(secrets.masterKey)
          let authHash: string
          try {
            authHash = authProof(authKey)
          } finally {
            authKey.fill(0)
          }
          const generated = await createIdentity(userHandle, vaultKey)
          assertCurrent()
          const result = await createIdentityFn({
            data: {
              publicKey: generated.publicKey,
              ciphertext: generated.ciphertext,
              nonce: generated.nonce,
              authHash,
            },
          })
          assertCurrent()
          if (result.created) {
            const identity = {
              publicKey: generated.publicKey,
              privateKey: generated.privateKey,
            }
            identityRef.current = identity
            return identity
          }
          row = result.identity
        }

        if (!row) throw new Error('IDENTITY_UNAVAILABLE')
        const identity = await openIdentity(row, vaultKey, userHandle)
        assertCurrent()
        identityRef.current = identity
        return identity
      })()

      identityLoadRef.current = promise
      try {
        return await promise
      } finally {
        if (identityLoadRef.current === promise) identityLoadRef.current = null
      }
    },
    [],
  )

  const ensureIdentity = useCallback(async (): Promise<Identity> => {
    if (identityRef.current) return identityRef.current
    const secrets = secretsRef.current
    const currentHandle = handleRef.current
    if (!secrets || !currentHandle) throw new Error('Vault is locked')
    return loadIdentity(currentHandle, secrets.vaultKey)
  }, [loadIdentity])

  useEffect(() => {
    const stored = localStorage.getItem('rook.autoLockMinutes') ?? localStorage.getItem('keynest.autoLockMinutes')
    if (stored) {
      const minutes = Number(stored)
      if (Number.isFinite(minutes) && minutes >= 1) setAutoLockMinutesState(minutes)
    }
  }, [])

  const setAutoLockMinutes = useCallback((minutes: number) => {
    const clamped = Math.max(1, Math.min(120, Math.round(minutes)))
    setAutoLockMinutesState(clamped)
    localStorage.setItem('rook.autoLockMinutes', String(clamped))
  }, [])

  // Bootstrap the session once. This must never clobber a vault that was already
  // unlocked while the request was in flight (e.g. a fast register on a slow link).
  useEffect(() => {
    let cancelled = false
    const settle = (nextHandle: string | null) => {
      if (cancelled) return
      setHandle((prev) => {
        const next = prev ?? nextHandle
        handleRef.current = next
        return next
      })
      setStatus((prev) => (prev === 'booting' ? 'locked' : prev))
    }
    meFn()
      .then((result) => settle(result.handle))
      .catch(() => settle(null))
    return () => {
      cancelled = true
    }
  }, [])

  const lock = useCallback(() => {
    clearPendingPasskey()
    settleSaveWaiters(new Error('Vault is locked'))
    pendingRef.current = null
    conflictRef.current = null
    identityGenerationRef.current += 1
    identityRef.current = null
    identityLoadRef.current = null
    wipe(secretsRef.current)
    secretsRef.current = null
    dataRef.current = null
    kdfRef.current = null
    versionRef.current = 0
    setData(null)
    setConflict(null)
    setStatus('locked')
    setSync('idle')
  }, [clearPendingPasskey, settleSaveWaiters])

  // Idle auto-lock
  useEffect(() => {
    if (status !== 'unlocked') return
    const reset = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(lock, autoLockMinutes * 60 * 1000)
    }
    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'wheel']
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }))
    reset()
    return () => {
      events.forEach((event) => window.removeEventListener(event, reset))
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [status, autoLockMinutes, lock])

  const pullRemoteVault = useCallback(async (): Promise<ConflictSnapshot> => {
    const secrets = secretsRef.current
    const kdf = kdfRef.current
    if (!secrets || !kdf) throw new Error('Vault is locked')

    const remote = await pullVaultFn()
    if (!remote) throw new Error('VAULT_MISSING')

    return {
      remote: openVaultWithFallback(
        {
          version: VAULT_FORMAT_VERSION,
          kdf,
          ciphertext: remote.ciphertext,
          nonce: remote.nonce,
          updatedAt: new Date(remote.updatedAt).toISOString(),
        },
        secrets.vaultKey,
      ),
      remoteVersion: remote.version,
      remoteUpdatedAt: remote.updatedAt,
      detectedAt: Date.now(),
    }
  }, [])

  const enterConflict = useCallback((snapshot: ConflictSnapshot) => {
    conflictRef.current = snapshot
    setConflict({
      remoteVersion: snapshot.remoteVersion,
      remoteUpdatedAt: snapshot.remoteUpdatedAt,
      detectedAt: snapshot.detectedAt,
      remoteEntries: snapshot.remote.entries.length,
      remoteTrash: snapshot.remote.trash.length,
    })
    setSync('conflict')
    setError(null)
  }, [])

  /**
   * Saves are immediate, not debounced: an edit is already an explicit user action
   * (Save, delete, favorite), and a debounce window is a window for data loss.
   * Writes are serialized so overlapping mutations cannot race on the version.
   */
  const flushSaves = useCallback(async () => {
    if (savingRef.current) return
    if (conflictRef.current) {
      settleSaveWaiters(new Error('CONFLICT'))
      return
    }
    const secrets = secretsRef.current
    const kdf = kdfRef.current
    if (!secrets || !kdf) {
      settleSaveWaiters(new Error('Vault is locked'))
      return
    }

    savingRef.current = true
    try {
      while (pendingRef.current && !conflictRef.current) {
        const next = pendingRef.current
        pendingRef.current = null
        setSync('saving')
        try {
          const sealed = sealVault(next, secrets.vaultKey, kdf)
          const result = await pushVaultFn({
            data: {
              baseVersion: versionRef.current,
              ciphertext: sealed.ciphertext,
              nonce: sealed.nonce,
            },
          })
          versionRef.current = result.version
          setLastSyncedAt(result.updatedAt)
          setSync('saved')
        } catch (caught) {
          if (isConflictError(caught)) {
            // Keep the latest local snapshot. A mutation may have landed while
            // the rejected request was in flight, and that snapshot includes it.
            if (!pendingRef.current) pendingRef.current = next
            try {
              enterConflict(await pullRemoteVault())
            } catch (pullError) {
              setSync('error')
              setError(friendlyError(pullError))
            }
            settleSaveWaiters(new Error('CONFLICT'))
            return
          }

          pendingRef.current = null
          setSync('error')
          setError(friendlyError(caught))
          settleSaveWaiters(caught)
          return
        }
      }
      settleSaveWaiters()
    } finally {
      savingRef.current = false
    }
  }, [enterConflict, pullRemoteVault, settleSaveWaiters])

  const queueSave = useCallback(
    (next: VaultData) => {
      pendingRef.current = next
      if (conflictRef.current) return
      void flushSaves()
    },
    [flushSaves],
  )

  const mutate = useCallback(
    (change: (current: VaultData) => VaultData) => {
      const current = dataRef.current
      if (!current) return
      const next = change(current)
      dataRef.current = next
      setData(next)
      queueSave(next)
    },
    [queueSave],
  )

  /**
   * Permanent deletion needs the tombstone to reach the server before any
   * recipient shares for the item are revoked.
   */
  const mutateAndWait = useCallback(
    async (change: (current: VaultData) => VaultData) => {
      const current = dataRef.current
      if (!current) throw new Error('Vault is locked')
      if (conflictRef.current) throw new Error('CONFLICT')
      const next = change(current)
      dataRef.current = next
      setData(next)
      pendingRef.current = next
      const saved = new Promise<void>((resolve, reject) => {
        saveWaitersRef.current.push({ resolve, reject })
      })
      void flushSaves()
      await saved
    },
    [flushSaves],
  )

  const resolveConflict = useCallback(
    async (choice: ConflictChoice) => {
      const snapshot = conflictRef.current
      if (!snapshot) return

      if (choice === 'server') {
        dataRef.current = snapshot.remote
        pendingRef.current = null
        conflictRef.current = null
        versionRef.current = snapshot.remoteVersion
        setData(snapshot.remote)
        setConflict(null)
        setLastSyncedAt(snapshot.remoteUpdatedAt)
        setSync('saved')
        setError(null)
        return
      }

      const local = pendingRef.current ?? dataRef.current
      if (!local) return

      let next: VaultData
      try {
        next = choice === 'mine' ? local : mergeVaultData(local, snapshot.remote)
      } catch (caught) {
        setSync('conflict')
        setError(friendlyError(caught))
        return
      }

      const secrets = secretsRef.current
      const kdf = kdfRef.current
      if (!secrets || !kdf) return

      savingRef.current = true
      setSync('saving')
      setError(null)
      try {
        const sealed = sealVault(next, secrets.vaultKey, kdf)
        const result = await pushVaultFn({
          data: {
            baseVersion: snapshot.remoteVersion,
            ciphertext: sealed.ciphertext,
            nonce: sealed.nonce,
          },
        })

        dataRef.current = next
        pendingRef.current = null
        conflictRef.current = null
        versionRef.current = result.version
        setData(next)
        setConflict(null)
        setLastSyncedAt(result.updatedAt)
        setSync('saved')
      } catch (caught) {
        if (isConflictError(caught)) {
          try {
            enterConflict(await pullRemoteVault())
            setError('The vault changed again while resolving. Review the latest version and try again.')
          } catch (pullError) {
            setSync('error')
            setError(friendlyError(pullError))
          }
          return
        }

        setSync('conflict')
        setError(friendlyError(caught))
      } finally {
        savingRef.current = false
      }
    },
    [enterConflict, pullRemoteVault],
  )

  const deleteEntryPermanently = useCallback(
    async (entryId: string) => {
      const current = dataRef.current
      if (!current) throw new Error('Vault is locked')
      const trashed = current.trash.find((item) => item.id === entryId)
      if (!trashed) return

      await mutateAndWait((latest) => deleteTrashedEntry(latest, entryId))

      try {
        await deleteRecipientSharesForEntryFn({ data: { entryId } })
      } catch {
        // The item is already gone. Surface the residual share window instead
        // of pretending the deletion was fully clean.
        setError(ERROR_MESSAGES.SHARE_CLEANUP_FAILED ?? 'Active shares could not be revoked.')
      }
    },
    [mutateAndWait],
  )

  const finishUnlock = useCallback(
    async (masterKey: Uint8Array, kdf: KdfConfig, userHandle: string) => {
      const vaultKey = deriveVaultKey(masterKey)
      const normalizedHandle = userHandle.trim().toLowerCase()
      try {
        const remote = await pullVaultFn()
        if (!remote) throw new Error('VAULT_MISSING')

        const decrypted = openVaultWithFallback(
          {
            version: VAULT_FORMAT_VERSION,
            kdf,
            ciphertext: remote.ciphertext,
            nonce: remote.nonce,
            updatedAt: new Date(remote.updatedAt).toISOString(),
          },
          vaultKey,
        )

        identityGenerationRef.current += 1
        identityRef.current = null
        identityLoadRef.current = null
        wipe(secretsRef.current)
        secretsRef.current = { masterKey, vaultKey }
        kdfRef.current = kdf
        dataRef.current = decrypted
        pendingRef.current = null
        conflictRef.current = null
        versionRef.current = remote.version
        setData(decrypted)
        setConflict(null)
        handleRef.current = normalizedHandle
        setHandle(normalizedHandle)
        setStatus('unlocked')
        setSync('saved')
        setLastSyncedAt(remote.updatedAt)
        void loadIdentity(normalizedHandle, vaultKey).catch(() => {
          // Sharing is optional for unlocking. The next share action retries.
        })
      } catch (caught) {
        masterKey.fill(0)
        vaultKey.fill(0)
        throw caught
      }
    },
    [loadIdentity],
  )

  const register = useCallback(async (userHandle: string, password: string) => {
    setError(null)
    clearPendingPasskey()
    const kdf = newKdfConfig()
    const masterKey = await deriveMasterKey(password, kdf)
    const vaultKey = deriveVaultKey(masterKey)
    const authKey = deriveAuthKey(masterKey)
    const payload = emptyVault()
    const sealed = sealVault(payload, vaultKey, kdf)

    const result = await registerFn({
      data: {
        handle: userHandle,
        kdf,
        authHash: authProof(authKey),
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
      },
    })

    identityGenerationRef.current += 1
    identityRef.current = null
    identityLoadRef.current = null
    secretsRef.current = { masterKey, vaultKey }
    kdfRef.current = kdf
    versionRef.current = result.version
    dataRef.current = payload
    pendingRef.current = null
    conflictRef.current = null
    setData(payload)
    setConflict(null)
    handleRef.current = result.handle
    setHandle(result.handle)
    setStatus('unlocked')
    setSync('saved')
    setLastSyncedAt(Date.now())
    void loadIdentity(result.handle, vaultKey).catch(() => {
      // The account exists even if identity setup is delayed. Retry on demand.
    })
  }, [clearPendingPasskey, loadIdentity])

  const unlock = useCallback(
    async (userHandle: string, password: string) => {
      setError(null)
      clearPendingPasskey()
      const { kdf } = (await kdfFn({ data: { handle: userHandle } })) as { kdf: KdfConfig }
      const masterKey = await deriveMasterKey(password, kdf)

      try {
        const authKey = deriveAuthKey(masterKey)
        const result = await loginFn({
          data: { handle: userHandle, authHash: authProof(authKey) },
        })

        if ('passkeyRequired' in result && result.passkeyRequired) {
          const pending: PendingPasskey = {
            challengeId: result.challengeId,
            options: result.options as PublicKeyCredentialRequestOptionsJSON,
            recoveryChallengeId: result.recoveryChallengeId,
            handle: result.handle,
          }
          pendingSecretsRef.current = { masterKey, kdf, handle: result.handle }
          pendingPasskeyRef.current = pending
          setPendingPasskey(pending)
          return
        }

        await finishUnlock(masterKey, kdf, result.handle)
      } catch (caught) {
        masterKey.fill(0)
        throw caught
      }
    },
    [clearPendingPasskey, finishUnlock],
  )

  const completePasskeyUnlock = useCallback(async () => {
    const pending = pendingPasskeyRef.current
    const secrets = pendingSecretsRef.current
    if (!pending || !secrets) throw new Error('PASSKEY_CHALLENGE_EXPIRED')

    try {
      const response = await startAuthentication({ optionsJSON: pending.options })
      const result = await finishPasskeyLoginFn({
        data: { challengeId: pending.challengeId, response },
      })
      await finishUnlock(secrets.masterKey, secrets.kdf, result.handle)
      pendingSecretsRef.current = null
      pendingPasskeyRef.current = null
      setPendingPasskey(null)
    } catch (caught) {
      clearPendingPasskey()
      throw caught
    }
  }, [clearPendingPasskey, finishUnlock])

  const completeRecoveryUnlock = useCallback(
    async (code: string) => {
      const pending = pendingPasskeyRef.current
      const secrets = pendingSecretsRef.current
      if (!pending?.recoveryChallengeId || !secrets) {
        throw new Error('RECOVERY_UNAVAILABLE')
      }

      try {
        const result = await finishPasskeyRecoveryFn({
          data: { challengeId: pending.recoveryChallengeId, code },
        })
        await finishUnlock(secrets.masterKey, secrets.kdf, result.handle)
        pendingSecretsRef.current = null
        pendingPasskeyRef.current = null
        setPendingPasskey(null)
      } catch (caught) {
        clearPendingPasskey()
        throw caught
      }
    },
    [clearPendingPasskey, finishUnlock],
  )

  const cancelPasskeyUnlock = useCallback(() => {
    clearPendingPasskey()
  }, [clearPendingPasskey])

  const signOut = useCallback(async () => {
    lock()
    await logoutFn()
    handleRef.current = null
    setHandle(null)
  }, [lock])

  const changeMasterPassword = useCallback(async (current: string, next: string) => {
    const secrets = secretsRef.current
    const kdf = kdfRef.current
    if (!secrets || !kdf || !dataRef.current) throw new Error('Vault is locked')

    // Prove we still know the current password before re-keying. The same
    // proof is sent to rotateFn, which verifies it again before changing the
    // verifier so a stolen session cannot rotate the account.
    const checkKey = deriveAuthKey(await deriveMasterKey(current, kdf))
    let currentAuthHash: string
    try {
      currentAuthHash = authProof(checkKey)
    } finally {
      checkKey.fill(0)
    }
    if (!handle) throw new Error('Not signed in')
    await verifyAuthFn({ data: { handle, authHash: currentAuthHash } })

    // The identity private key is sealed under the vault key, so rotation must
    // re-wrap it in the same atomic server update or received shares break.
    const identity = await ensureIdentity()

    // Read the latest snapshot after the awaits so an edit that landed during
    // verification is included in the re-encrypted vault.
    const payload = dataRef.current
    if (!payload) throw new Error('Vault is locked')

    const nextKdf = newKdfConfig()
    const nextMaster = await deriveMasterKey(next, nextKdf)
    const nextAuth = deriveAuthKey(nextMaster)
    const nextVaultKey = deriveVaultKey(nextMaster)
    try {
      const sealed = sealVault(payload, nextVaultKey, nextKdf)
      const sealedIdentity = await sealIdentityPrivateKey(identity, nextVaultKey, handle)
      const result = await rotateFn({
        data: {
          currentAuthHash,
          kdf: nextKdf,
          authHash: authProof(nextAuth),
          ciphertext: sealed.ciphertext,
          nonce: sealed.nonce,
          identity: {
            publicKey: identity.publicKey,
            ciphertext: sealedIdentity.ciphertext,
            nonce: sealedIdentity.nonce,
          },
        },
      })

      wipe(secretsRef.current)
      secretsRef.current = { masterKey: nextMaster, vaultKey: nextVaultKey }
      kdfRef.current = nextKdf
      versionRef.current = result.version
      setSync('saved')
      setLastSyncedAt(result.updatedAt)
    } catch (caught) {
      nextMaster.fill(0)
      nextVaultKey.fill(0)
      throw caught
    } finally {
      nextAuth.fill(0)
    }
  }, [ensureIdentity, handle])

  const exportBackup = useCallback((): EncryptedVault | null => {
    const secrets = secretsRef.current
    const kdf = kdfRef.current
    const payload = dataRef.current
    if (!secrets || !kdf || !payload) return null
    return sealVault(payload, secrets.vaultKey, kdf)
  }, [])

  const exportCsv = useCallback((): string | null => {
    const payload = dataRef.current
    if (!payload) return null
    const escape = (value: string | undefined) => `"${(value ?? '').replace(/"/g, '""')}"`
    const header = 'type,title,username,password,url,totp,notes,tags'
    const rows = payload.entries.map((entry: Entry) =>
      [
        entry.type,
        entry.title,
        entry.username,
        entry.password,
        entry.url,
        entry.totp,
        entry.notes,
        entry.tags.join(' '),
      ]
        .map(escape)
        .join(','),
    )
    return [header, ...rows].join('\n')
  }, [])

  const importEntries = useCallback(
    (entries: Entry[]) => {
      const current = dataRef.current
      if (!current) throw new Error('Vault is locked')

      const room = MAX_ENTRIES - current.entries.length
      if (room <= 0) throw new Error('This vault is at the 10,000 item limit.')

      const seen = new Set([...current.entries, ...current.trash].map(entryFingerprint))
      const accepted: Entry[] = []
      let skipped = 0

      for (const entry of entries) {
        const fingerprint = entryFingerprint(entry)
        if (seen.has(fingerprint) || accepted.length >= room) {
          skipped += 1
          continue
        }
        seen.add(fingerprint)
        accepted.push(entry)
      }

      if (accepted.length > 0) {
        const acceptedIds = new Set(accepted.map((entry) => entry.id))
        const next: VaultData = {
          ...current,
          entries: [...current.entries, ...accepted],
          tombstones: current.tombstones.filter((item) => !acceptedIds.has(item.id)),
        }
        dataRef.current = next
        setData(next)
        queueSave(next)
      }

      return { added: accepted.length, skipped }
    },
    [queueSave],
  )

  const importBackup = useCallback(
    async (json: string, password: string) => {
      const parsed = JSON.parse(json) as EncryptedVault
      if (!parsed || !isSupportedVaultFormat(parsed.format) || !parsed.kdf) {
        throw new Error('Not a Rook backup file')
      }
      const masterKey = await deriveMasterKey(password, parsed.kdf)
      const imported = openVault(parsed, deriveVaultKey(masterKey))

      // Merge by id so importing a backup never silently deletes newer local items.
      const local = dataRef.current ?? emptyVault()
      const mergedEntries = new Map(local.entries.map((entry) => [entry.id, entry]))
      const mergedTrash = new Map(local.trash.map((entry) => [entry.id, entry]))

      for (const entry of imported.entries) {
        mergedEntries.set(entry.id, entry)
        mergedTrash.delete(entry.id)
      }
      for (const entry of imported.trash) {
        if (!mergedEntries.has(entry.id)) mergedTrash.set(entry.id, entry)
      }

      const mergedHistory = { ...local.history }
      for (const [id, versions] of Object.entries(imported.history)) {
        const byUpdatedAt = new Map<string, Entry>()
        for (const version of [
          ...(mergedHistory[id] ?? []),
          ...versions,
        ]) {
          byUpdatedAt.set(version.updatedAt, version)
        }
        mergedHistory[id] = [...byUpdatedAt.values()]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, MAX_HISTORY_VERSIONS)
      }

      const trash = [...mergedTrash.values()].slice(0, MAX_TRASH_ITEMS)
      const keptIds = new Set([...mergedEntries.keys(), ...trash.map((entry) => entry.id)])
      for (const id of Object.keys(mergedHistory)) {
        if (!keptIds.has(id)) delete mergedHistory[id]
      }

      // Importing a backup is an explicit restore. Drop tombstones for items
      // the backup supplies, but retain unrelated permanent-delete markers.
      const importedIds = new Set(
        [...imported.entries, ...imported.trash].map((entry) => entry.id),
      )
      const tombstoneById = new Map<string, Tombstone>()
      for (const tombstone of [...local.tombstones, ...imported.tombstones]) {
        const existing = tombstoneById.get(tombstone.id)
        if (!existing || tombstone.deletedAt.localeCompare(existing.deletedAt) > 0) {
          tombstoneById.set(tombstone.id, tombstone)
        }
      }
      for (const id of importedIds) tombstoneById.delete(id)
      for (const id of keptIds) tombstoneById.delete(id)
      const tombstones = [...tombstoneById.values()]
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
        .slice(0, MAX_TOMBSTONES)

      const next: VaultData = {
        ...local,
        entries: [...mergedEntries.values()],
        trash,
        history: mergedHistory,
        tombstones,
      }

      dataRef.current = next
      setData(next)
      queueSave(next)
    },
    [queueSave],
  )

  const value: VaultContextValue = {
    status,
    handle,
    data,
    sync,
    error,
    conflict,
    pendingPasskey,
    resolveConflict,
    lastSyncedAt,
    autoLockMinutes,
    setAutoLockMinutes,
    register,
    unlock,
    completePasskeyUnlock,
    completeRecoveryUnlock,
    cancelPasskeyUnlock,
    lock,
    signOut,
    mutate,
    ensureIdentity,
    deleteEntryPermanently,
    changeMasterPassword,
    exportBackup,
    exportCsv,
    importBackup,
    importEntries,
    clearError: () => setError(null),
  }

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultContextValue {
  const context = useContext(VaultContext)
  if (!context) throw new Error('useVault must be used inside VaultProvider')
  return context
}
