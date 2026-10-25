import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { friendlyError, useVault } from '~/lib/vault-context'
import { scorePassword } from '~/lib/strength'
import { Icon, Spinner, StrengthMeter, ThemeToggle, cx } from './ui'
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
        className="field h-10 pr-11 font-mono text-[13px] tracking-[0.08em] placeholder:font-sans placeholder:tracking-normal"
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
        className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-ink"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={15} />
      </button>
    </div>
  )
}

function TrustPoint({
  icon,
  title,
  children,
}: {
  icon: string
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-accent shadow-rest">
        <Icon name={icon} size={15} />
      </span>
      <div>
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  )
}

function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cx(
          'flex items-center justify-center rounded-[10px] border border-line bg-white text-[#0a0b0e] shadow-rest',
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
  const { register, unlock, error, clearError, handle: knownHandle } = useVault()
  const [mode, setMode] = useState<'unlock' | 'create'>('unlock')
  const [handle, setHandle] = useState(knownHandle ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    if (knownHandle) setHandle(knownHandle)
  }, [knownHandle])

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

  const shownError = localError ?? error

  return (
    <div className="lock-screen relative min-h-dvh overflow-hidden bg-canvas">
      <ThemeToggle className="absolute top-5 right-5 z-20 border-line bg-surface text-muted shadow-rest hover:bg-surface-2 hover:text-ink" />

      <div className="mx-auto grid min-h-dvh max-w-[1500px] lg:grid-cols-[minmax(0,1fr)_350px]">
        <main className="lock-login flex flex-col justify-center px-5 py-12 sm:px-8 lg:px-14 xl:px-20">
          <div className="mx-auto w-full max-w-[400px]">
            <div className="mb-9 lg:hidden">
              <BrandMark size="lg" />
              <p className="mt-3 max-w-[28ch] text-[13px] leading-relaxed text-muted">
                Your encrypted vault, available only to you.
              </p>
            </div>

            <div className="mb-8">
              <div className="mb-4 flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-accent uppercase">
                <span className="h-px w-6 bg-accent" />
                {mode === 'create' ? 'Start private' : 'Welcome back'}
              </div>
              <h2 className="text-[28px] leading-tight font-semibold tracking-[-0.04em] text-ink">
                {mode === 'create' ? 'Create your vault' : 'Unlock Rook'}
              </h2>
              <p className="mt-2 max-w-[36ch] text-[13px] leading-relaxed text-muted">
                {mode === 'create'
                  ? 'One strong password. No recovery path. That is the point.'
                  : 'Your key is derived locally, then used to decrypt this vault.'}
              </p>
            </div>

            <div className="mb-5 flex items-center justify-between border-b border-line">
              {(
                [
                  ['unlock', 'Unlock vault'],
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
                    'relative -mb-px px-1 pb-3 text-[12.5px] font-medium transition-colors',
                    mode === value ? 'text-ink' : 'text-muted hover:text-ink',
                    mode === value && 'after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-accent',
                  )}
                  aria-pressed={mode === value}
                >
                  {label}
                </button>
              ))}
              <span className="pb-3 text-[11px] text-faint">
                <Icon name="shield" size={13} className="inline-block align-[-2px]" /> zero-knowledge
              </span>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="handle" className="label">
                  Username
                </label>
                <input
                  id="handle"
                  name="handle"
                  className="field h-11"
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

              {shownError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-[12px] leading-relaxed text-danger"
                >
                  <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                  <span>{shownError}</span>
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

            <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">
              {mode === 'create'
                ? 'Your master password never leaves this browser.'
                : 'Only an authentication proof is sent. Your vault stays encrypted.'}
            </p>

            <details className="group mt-8 border-t border-line pt-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-medium text-muted marker:hidden hover:text-ink">
                <span className="flex items-center gap-2">
                  <Icon name="shield" size={14} className="text-accent" />
                  How your vault is protected
                </span>
                <Icon name="chevronDown" size={14} className="transition-transform group-open:rotate-180" />
              </summary>
              <ul className="mt-3 space-y-2.5 text-[11.5px] leading-relaxed text-muted">
                <li>
                  <span className="font-mono text-[11px] text-ink">Argon2id</span> turns your password into a 256-bit key
                  using 64 MiB of memory and 3 passes.
                </li>
                <li>
                  <span className="font-mono text-[11px] text-ink">HKDF-SHA256</span> separates the authentication key from
                  the vault key.
                </li>
                <li>
                  <span className="font-mono text-[11px] text-ink">XChaCha20-Poly1305</span> encrypts the complete vault
                  before sync.
                </li>
              </ul>
            </details>
          </div>
        </main>

        <aside className="lock-guide hidden flex-col justify-center px-9 py-12 lg:flex">
          <span className="text-[10px] font-medium tracking-[0.12em] text-muted uppercase">Guide</span>
          <h2 className="mt-3 text-[22px] leading-tight font-medium tracking-[-0.025em] text-ink">
            How secure is my password?
          </h2>
          <div className="lock-guide-art mt-6 flex h-[150px] items-center justify-center rounded-sm border border-line">
            <div className="flex size-24 items-center justify-center rounded-full border border-accent/25 bg-white/70 text-[#19233a] shadow-rest">
              <RookMark className="size-14" />
            </div>
          </div>
          <p className="mt-6 text-[13px] leading-relaxed text-muted">
            A strong master password is the only thing standing between your vault and an attacker. Rook makes guessing
            expensive with Argon2id, but only you can choose a password worth protecting.
          </p>
          <details className="group mt-5 border-t border-line pt-4">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-medium text-accent marker:hidden hover:text-accent-hover">
              Read the security guide
              <Icon name="arrowUpRight" size={14} />
            </summary>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Use a long, unique phrase or a generated password. Never reuse your Rook password anywhere else.
            </p>
          </details>
        </aside>
      </div>
    </div>
  )
}
