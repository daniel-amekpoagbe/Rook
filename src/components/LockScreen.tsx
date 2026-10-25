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
        tabIndex={-1}
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
    <div className="relative grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      <ThemeToggle className="absolute top-4 right-4 z-20 bg-surface/80 backdrop-blur-sm lg:right-5" />

      <aside className="relative hidden flex-col justify-between border-r border-line bg-surface-2 px-12 py-10 lg:flex xl:px-16">
        <BrandMark size="lg" />

        <div className="max-w-[440px]">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-medium text-muted shadow-rest">
            <span className="size-1.5 rounded-full bg-success" />
            Zero-knowledge by construction
          </p>
          <h1 className="text-[32px] leading-[1.15] font-semibold tracking-[-0.03em] text-ink">
            Your keys,
            <br />
            kept quiet.
          </h1>
          <p className="mt-3 max-w-[38ch] text-[14px] leading-relaxed text-muted">
            Every item is encrypted in this browser before it is stored. The server holds ciphertext it cannot read.
          </p>

          <ul className="mt-8 space-y-5">
            <TrustPoint icon="fingerprint" title="Derived on this device">
              Argon2id turns your master password into a 256-bit key that never leaves the tab.
            </TrustPoint>
            <TrustPoint icon="key" title="Split, then sealed">
              HKDF separates the auth key from the vault key. The server sees neither.
            </TrustPoint>
            <TrustPoint icon="shield" title="No recovery, by design">
              Nobody, including the server, can reopen the vault without your password.
            </TrustPoint>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="lock" size={12} /> Argon2id · 64 MiB
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="key" size={12} /> HKDF-SHA256
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="shield" size={12} /> XChaCha20-Poly1305
          </span>
        </div>
      </aside>

      <main className="flex flex-col justify-center px-5 py-12 sm:px-8 lg:py-10">
        <div className="mx-auto w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <BrandMark size="lg" />
            <p className="mt-2 text-[13px] text-muted">Your vault is encrypted on this device.</p>
          </div>

          <div className="rounded-xl border border-line bg-surface p-5 shadow-rest sm:p-6">
            <div className="mb-5">
              <h2 className="text-[17px] font-semibold tracking-[-0.015em]">
                {mode === 'create' ? 'Create your vault' : 'Welcome back'}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-muted">
                {mode === 'create'
                  ? 'One password to remember. No recovery if it is lost.'
                  : 'Unlock to decrypt your vault in this tab.'}
              </p>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-3 p-1">
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
                    'h-8 rounded-md text-[12.5px] font-medium transition-all duration-150',
                    mode === value
                      ? 'bg-surface text-ink shadow-rest'
                      : 'text-muted hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label htmlFor="handle" className="label">
                  Username
                </label>
                <input
                  id="handle"
                  name="handle"
                  className="field h-10"
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
                <label htmlFor="master-password" className="label">
                  Master password
                </label>
                <PasswordField
                  id="master-password"
                  name="master-password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Your master password"
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
                  className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] leading-relaxed text-danger"
                >
                  <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
                  <span>{shownError}</span>
                </div>
              )}

              <button type="submit" className="btn-primary h-10 w-full" disabled={busy}>
                {busy ? (
                  <>
                    <Spinner size={15} />
                    Deriving key…
                  </>
                ) : mode === 'create' ? (
                  'Create encrypted vault'
                ) : (
                  'Unlock'
                )}
              </button>
            </form>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">
              {mode === 'create'
                ? 'Your master password never leaves this browser.'
                : 'Your key is derived locally. Only a proof is sent.'}
            </p>
          </div>

          <details className="group mt-4 rounded-xl border border-line bg-surface px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[12px] font-medium text-muted marker:hidden hover:text-ink">
              <span className="flex items-center gap-2">
                <Icon name="shield" size={14} className="text-accent" />
                How this vault is protected
              </span>
              <Icon name="chevronDown" size={14} className="transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-3 space-y-2 border-t border-line pt-3 text-[11.5px] leading-relaxed text-muted">
              <li>
                <span className="font-mono text-[11px] text-ink">Argon2id</span> stretches your master password into a
                256-bit key (64 MiB, 3 passes) so guessing is expensive.
              </li>
              <li>
                <span className="font-mono text-[11px] text-ink">HKDF-SHA256</span> splits it into an auth key and a vault
                key, so the server never sees either one.
              </li>
              <li>
                <span className="font-mono text-[11px] text-ink">XChaCha20-Poly1305</span> encrypts the whole vault with a
                fresh 24-byte nonce on every save.
              </li>
              <li>The server stores only ciphertext and a hash of a hash. A database leak reveals nothing.</li>
            </ul>
          </details>
        </div>
      </main>
    </div>
  )
}
