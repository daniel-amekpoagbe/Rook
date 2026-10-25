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
  authProof,
  deriveAuthKey,
  deriveMasterKey,
  deriveVaultKey,
  newKdfConfig,
  type KdfConfig,
} from './crypto'
import {
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
  VAULT_FORMAT_VERSION,
  type EncryptedVault,
  type Entry,
  type Tombstone,
  type VaultData,
} from './vault'
import {
  kdfFn,
  loginFn,
  logoutFn,
  meFn,
  pullVaultFn,
  pushVaultFn,
  registerFn,
  rotateFn,
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
}

export function friendlyError(error: unknown): string {
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

interface VaultContextValue {
  status: Status
  handle: string | null
  data: VaultData | null
  sync: SyncState
  error: string | null
  conflict: VaultConflict | null
  resolveConflict: (choice: ConflictChoice) => Promise<void>
  lastSyncedAt: number | null
  autoLockMinutes: number
  setAutoLockMinutes: (minutes: number) => void
  register: (handle: string, password: string) => Promise<void>
  unlock: (handle: string, password: string) => Promise<void>
  lock: () => void
  signOut: () => Promise<void>
  mutate: (change: (data: VaultData) => VaultData) => void
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
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [autoLockMinutes, setAutoLockMinutesState] = useState(5)

  const secretsRef = useRef<Secrets | null>(null)
  const dataRef = useRef<VaultData | null>(null)
  const kdfRef = useRef<KdfConfig | null>(null)
  const versionRef = useRef(0)
  const pendingRef = useRef<VaultData | null>(null)
  const conflictRef = useRef<ConflictSnapshot | null>(null)
  const savingRef = useRef(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      setHandle((prev) => prev ?? nextHandle)
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
    pendingRef.current = null
    conflictRef.current = null
    wipe(secretsRef.current)
    secretsRef.current = null
    dataRef.current = null
    kdfRef.current = null
    versionRef.current = 0
    setData(null)
    setConflict(null)
    setStatus('locked')
    setSync('idle')
  }, [])

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
    if (savingRef.current || conflictRef.current) return
    const secrets = secretsRef.current
    const kdf = kdfRef.current
    if (!secrets || !kdf) return

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
            return
          }

          pendingRef.current = null
          setSync('error')
          setError(friendlyError(caught))
          return
        }
      }
    } finally {
      savingRef.current = false
    }
  }, [enterConflict, pullRemoteVault])

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

  const register = useCallback(async (userHandle: string, password: string) => {
    setError(null)
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

    secretsRef.current = { masterKey, vaultKey }
    kdfRef.current = kdf
    versionRef.current = result.version
    dataRef.current = payload
    pendingRef.current = null
    conflictRef.current = null
    setData(payload)
    setConflict(null)
    setHandle(result.handle)
    setStatus('unlocked')
    setSync('saved')
    setLastSyncedAt(Date.now())
  }, [])

  const unlock = useCallback(async (userHandle: string, password: string) => {
    setError(null)
    const { kdf } = (await kdfFn({ data: { handle: userHandle } })) as { kdf: KdfConfig }
    const masterKey = await deriveMasterKey(password, kdf)
    const authKey = deriveAuthKey(masterKey)
    await loginFn({ data: { handle: userHandle, authHash: authProof(authKey) } })

    const remote = await pullVaultFn()
    if (!remote) throw new Error('VAULT_MISSING')

    const vaultKey = deriveVaultKey(masterKey)
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

    secretsRef.current = { masterKey, vaultKey }
    kdfRef.current = kdf
    dataRef.current = decrypted
    pendingRef.current = null
    conflictRef.current = null
    versionRef.current = remote.version
    setData(decrypted)
    setConflict(null)
    setHandle(userHandle.trim().toLowerCase())
    setStatus('unlocked')
    setSync('saved')
    setLastSyncedAt(remote.updatedAt)
  }, [])

  const signOut = useCallback(async () => {
    lock()
    await logoutFn()
    setHandle(null)
  }, [lock])

  const changeMasterPassword = useCallback(async (current: string, next: string) => {
    const secrets = secretsRef.current
    const kdf = kdfRef.current
    const payload = dataRef.current
    if (!secrets || !kdf || !payload) throw new Error('Vault is locked')

    // Prove we still know the current password before re-keying.
    const checkKey = deriveAuthKey(await deriveMasterKey(current, kdf))
    if (!handle) throw new Error('Not signed in')
    await loginFn({ data: { handle, authHash: authProof(checkKey) } })

    const nextKdf = newKdfConfig()
    const nextMaster = await deriveMasterKey(next, nextKdf)
    const nextAuth = deriveAuthKey(nextMaster)
    const nextVaultKey = deriveVaultKey(nextMaster)
    const sealed = sealVault(payload, nextVaultKey, nextKdf)

    const result = await rotateFn({
      data: {
        kdf: nextKdf,
        authHash: authProof(nextAuth),
        ciphertext: sealed.ciphertext,
        nonce: sealed.nonce,
      },
    })

    wipe(secretsRef.current)
    secretsRef.current = { masterKey: nextMaster, vaultKey: nextVaultKey }
    kdfRef.current = nextKdf
    versionRef.current = result.version
    setSync('saved')
    setLastSyncedAt(result.updatedAt)
  }, [handle])

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
        for (const version of [...(mergedHistory[id] ?? []), ...versions]) {
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
    resolveConflict,
    lastSyncedAt,
    autoLockMinutes,
    setAutoLockMinutes,
    register,
    unlock,
    lock,
    signOut,
    mutate,
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
