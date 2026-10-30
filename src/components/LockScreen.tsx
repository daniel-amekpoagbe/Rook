import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { friendlyError, useVault } from '~/lib/vault-context'
import { scorePassword } from '~/lib/strength'
import { Icon, Spinner, StrengthMeter, cx } from './ui'
import { RookMark } from './RookMark'

function PasswordField({
  id,
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete,
  onEnter,
  name,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  name: string
  autoFocus?: boolean
  autoComplete?: string
  onEnter?: () => void
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        className="field lock-field h-10 pr-11 font-mono text-[13px] tracking-[0.08em] placeholder:font-sans placeholder:tracking-normal"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) onEnter()
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-[#5c6370] transition-colors hover:bg-black/5 hover:text-[#17191e]"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={15} />
      </button>
    </div>
  )
}

function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cx(
          'flex items-center justify-center rounded-[10px] border border-white/50 bg-white/55 text-[#0a0b0e] backdrop-blur-md',
          size === 'lg' ? 'size-9' : 'size-8',
        )}
      >
        <RookMark className={size === 'lg' ? 'size-[21px]' : 'size-[18px]'} />
      </span>
      <span className={cx('font-semibold tracking-[-0.02em] text-ink', size === 'lg' ? 'text-[17px]' : 'text-[15px]')}>
        Rook
      </span>
    </div>
  )
}

export function LockScreen() {
  const {
    register,
    unlock,
    error,
    clearError,
    handle: knownHandle,
    pendingPasskey,
    completePasskeyUnlock,
    completeRecoveryUnlock,
    cancelPasskeyUnlock,
  } = useVault()
  const [mode, setMode] = useState<'unlock' | 'create'>('unlock')
  const [handle, setHandle] = useState(knownHandle ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (knownHandle) setHandle(knownHandle)
  }, [knownHandle])

  useEffect(() => {
    if (pendingPasskey) {
      setRecoveryMode(false)
      setRecoveryCode('')
    }
  }, [pendingPasskey?.challengeId])

  const strength = useMemo(() => scorePassword(password), [password])

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (busy) return
    setLocalError(null)
    clearError()

    const trimmedHandle = handle.trim()
    if (trimmedHandle.length < 3) {
      setLocalError('Choose a username with at least 3 characters.')
      return
    }
    if (!/^[a-zA-Z0-9._@-]+$/.test(trimmedHandle)) {
      setLocalError('Usernames can use letters, numbers, dots, dashes, underscores or an email address.')
      return
    }
    if (mode === 'create') {
      if (password.length < 10) {
        setLocalError('Master password must be at least 10 characters.')
        return
      }
      if (password.toLowerCase() === trimmedHandle.toLowerCase()) {
        setLocalError("Your master password can't be your username.")
        return
      }
      if (password !== confirm) {
        setLocalError('Passwords do not match.')
        return
      }
      if (strength.score < 2) {
        const reason = strength.warnings[0] ? ` (${strength.warnings[0].toLowerCase()})` : ''
        setLocalError(`That password is too weak to protect a vault${reason}.`)
        return
      }
    }
    if (!password) {
      setLocalError('Enter your master password.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'create') await register(handle.trim(), password)
      else await unlock(handle.trim(), password)
    } catch (caught) {
      setLocalError(friendlyError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function verifyWithPasskey() {
    if (passkeyBusy) return
    setLocalError(null)
    clearError()
    setPasskeyBusy(true)
    try {
      await completePasskeyUnlock()
    } catch (caught) {
      setLocalError(friendlyError(caught))
      setRecoveryMode(false)
      setRecoveryCode('')
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function submitRecovery(event: FormEvent) {
    event.preventDefault()
    if (passkeyBusy) return
    if (!recoveryCode.trim()) {
      setLocalError('Enter your recovery code.')
      return
    }
    setLocalError(null)
    clearError()
    setPasskeyBusy(true)
    try {
      await completeRecoveryUnlock(recoveryCode)
    } catch (caught) {
      setLocalError(friendlyError(caught))
      setRecoveryMode(false)
      setRecoveryCode('')
    } finally {
      setPasskeyBusy(false)
    }
  }

  function cancelPasskey() {
    cancelPasskeyUnlock()
    setRecoveryMode(false)
    setRecoveryCode('')
    setLocalError(null)
  }

  const shownError = localError ?? error

  return (
    <div className="lock-screen relative min-h-dvh overflow-x-hidden overflow-y-auto bg-canvas">
      <div className="lock-screen-photo" aria-hidden="true" />

      <div className="relative z-10 flex min-h-dvh items-center justify-center px-6 py-8">
        <main className="w-full max-w-[440px]">
          <div className="mb-8">
            <BrandMark size="lg" />
          </div>

          <div className="mb-8">
            <p className="text-[11px] font-medium tracking-[0.16em] text-accent uppercase">
              {mode === 'create' ? 'New vault' : 'Welcome back'}
            </p>
            <h1 className="mt-3 text-[40px] leading-[1.05] font-semibold tracking-[-0.045em] text-ink sm:text-[46px]">
              {mode === 'create' ? 'Create your vault' : 'Unlock Rook'}
            </h1>
            <p className="mt-3 max-w-[36ch] text-[14px] leading-relaxed text-muted">
              {mode === 'create'
                ? 'One strong password. There is no recovery path.'
                : pendingPasskey
                  ? 'Your master password checked out. Confirm this sign-in with your passkey.'
                  : 'Your key is derived here, then used to open the vault.'}
            </p>
          </div>

          {!pendingPasskey && (
            <div className="mb-8 flex gap-6" aria-label="Vault access">
              {(
                [
                  ['unlock', 'Unlock'],
                  ['create', 'Create vault'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMode(value)
                    setLocalError(null)
                    clearError()
                  }}
                  className={cx(
                    'border-b pb-1.5 text-[13px] font-medium transition-colors',
                    mode === value
                      ? 'border-ink text-ink'
                      : 'border-transparent text-muted hover:text-ink',
                  )}
                  aria-pressed={mode === value}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

            {pendingPasskey ? (
              <div className="rounded-xl border border-accent/25 bg-accent-soft/60 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-surface text-accent">
                    <Icon name="fingerprint" size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">Master password verified</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                      Confirm <span className="font-medium text-ink">{pendingPasskey.handle}</span> with your
                      passkey. The vault key is still derived in this tab.
                    </p>
                  </div>
                </div>

                {!recoveryMode ? (
                  <div className="mt-4 space-y-2">
                    <button
                      type="button"
                      className="btn-primary h-10 w-full text-[13px]"
                      onClick={verifyWithPasskey}
                      disabled={passkeyBusy}
                    >
                      {passkeyBusy ? (
                        <>
                          <Spinner size={15} />
                          Waiting for passkey…
                        </>
                      ) : (
                        <>
                          <Icon name="fingerprint" size={15} />
                          Use passkey
                        </>
                      )}
                    </button>
                    {pendingPasskey.recoveryChallengeId && (
                      <button
                        type="button"
                        className="btn-secondary h-10 w-full text-[13px]"
                        onClick={() => setRecoveryMode(true)}
                        disabled={passkeyBusy}
                      >
                        <Icon name="key" size={15} />
                        Use recovery code
                      </button>
                    )}
                  </div>
                ) : (
                  <form onSubmit={submitRecovery} className="mt-4 space-y-2">
                    <label htmlFor="recovery-code" className="label">
                      Recovery code
                    </label>
                    <input
                      id="recovery-code"
                      name="recovery-code"
                      className="field lock-field h-10 font-mono text-[12px] tracking-[0.06em]"
                      value={recoveryCode}
                      onChange={(event) => setRecoveryCode(event.target.value)}
                      placeholder="xxxxx-xxxxx-xxxxx-…"
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary h-9 flex-1 text-[12px]"
                        onClick={() => {
                          setRecoveryMode(false)
                          setRecoveryCode('')
                        }}
                        disabled={passkeyBusy}
                      >
                        Back
                      </button>
                      <button type="submit" className="btn-primary h-9 flex-1 text-[12px]" disabled={passkeyBusy}>
                        {passkeyBusy ? (
                          <>
                            <Spinner size={14} />
                            Verifying…
                          </>
                        ) : (
                          'Verify code'
                        )}
                      </button>
                    </div>
                  </form>
                )}

                <button
                  type="button"
                  className="mt-3 w-full text-center text-[11px] text-muted hover:text-ink"
                  onClick={cancelPasskey}
                  disabled={passkeyBusy}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label htmlFor="handle" className="label">
                    Username
                  </label>
                  <input
                    id="handle"
                    name="handle"
                    className="field lock-field h-11"
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    autoComplete="username"
                    spellCheck={false}
                    autoFocus={!handle}
                  />
                </div>

                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="master-password" className="label">
                      Master password
                    </label>
                    {mode === 'create' && <span className="text-[10.5px] text-faint">10+ characters</span>}
                  </div>
                  <PasswordField
                    id="master-password"
                    name="master-password"
                    value={password}
                    onChange={setPassword}
                    placeholder={mode === 'create' ? 'Choose a strong password' : 'Enter your master password'}
                    autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                  />
                  {mode === 'create' && password.length > 0 && (
                    <div className="mt-2">
                      <StrengthMeter strength={strength} />
                    </div>
                  )}
                </div>

                {mode === 'create' && (
                  <div>
                    <label htmlFor="confirm-password" className="label">
                      Confirm password
                    </label>
                    <PasswordField
                      id="confirm-password"
                      name="confirm-password"
                      value={confirm}
                      onChange={setConfirm}
                      placeholder="Repeat your master password"
                      autoComplete="new-password"
                      onEnter={() => submit()}
                    />
                  </div>
                )}

                <button type="submit" className="btn-primary h-11 w-full text-[13px]" disabled={busy}>
                  {busy ? (
                    <>
                      <Spinner size={15} />
                      {mode === 'create' ? 'Encrypting your vault…' : 'Deriving your key…'}
                    </>
                  ) : mode === 'create' ? (
                    <>
                      <Icon name="lock" size={15} />
                      Create encrypted vault
                    </>
                  ) : (
                    <>
                      <Icon name="unlock" size={15} />
                      Unlock vault
                    </>
                  )}
                </button>
              </form>
            )}

            {shownError && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-[12px] leading-relaxed text-danger"
              >
                <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                <span>{shownError}</span>
              </div>
            )}

            <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">
              {pendingPasskey
                ? 'The passkey confirms the server session. Your master password still decrypts the vault.'
                : mode === 'create'
                  ? 'Your master password never leaves this browser.'
                  : 'Only an authentication proof is sent. Your vault stays encrypted.'}
            </p>
        </main>
      </div>
    </div>
  )
}
