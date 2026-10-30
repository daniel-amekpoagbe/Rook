import { useEffect, useMemo, useState } from 'react'
import { scorePassword } from '~/lib/strength'
import {
  DEFAULT_GENERATOR_OPTIONS,
  generatePassword,
  generatorEntropyBits,
  type GeneratorOptions,
} from '~/lib/generator'
import type { Entry, EntryType } from '~/lib/vault'
import { parseTotp } from '~/lib/totp'
import { Icon, Modal, StrengthMeter, cx, useCopyToClipboard } from './ui'

export const TYPE_META: Record<EntryType, { label: string; icon: string }> = {
  login: { label: 'Login', icon: 'key' },
  note: { label: 'Secure note', icon: 'note' },
  card: { label: 'Card', icon: 'card' },
  identity: { label: 'Identity', icon: 'user' },
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="label">
      {children}
    </label>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[12.5px] font-semibold text-ink">{title}</h2>
        {description && <p className="text-[11px] text-faint">{description}</p>}
      </div>
      <div className="rounded-xl border border-line bg-surface p-4">{children}</div>
    </section>
  )
}

function PasswordInput({
  id,
  value,
  onChange,
  name,
  autoComplete = 'new-password',
  placeholder,
  revealLabel = 'password',
}: {
  id: string
  value: string
  onChange: (value: string) => void
  name: string
  autoComplete?: string
  placeholder?: string
  revealLabel?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        className="field pr-10 font-mono text-[12.5px] placeholder:font-sans placeholder:tracking-normal"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="none"
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        className="absolute top-1/2 right-0.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-faint hover:bg-surface-3 hover:text-ink"
        aria-label={visible ? `Hide ${revealLabel}` : `Show ${revealLabel}`}
        tabIndex={-1}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={14} />
      </button>
    </div>
  )
}

export function GeneratorModal({
  open,
  onClose,
  onUse,
}: {
  open: boolean
  onClose: () => void
  onUse?: (value: string) => void
}) {
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS)
  const [seed, setSeed] = useState(0)
  const { copied, copy } = useCopyToClipboard()

  const value = useMemo(() => {
    try {
      return generatePassword(options)
    } catch {
      return ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, seed])

  const bits = Math.round(generatorEntropyBits(options))
  const strength = scorePassword(value)

  const toggle = (key: keyof GeneratorOptions) =>
    setOptions((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      if (key !== 'length' && key !== 'avoidAmbiguous') {
        const any = next.lowercase || next.uppercase || next.digits || next.symbols
        if (!any) return prev
      }
      return next
    })

  return (
    <Modal open={open} onClose={onClose} title="Password generator" width="max-w-md">
      <div className="rounded-xl border border-line bg-surface-2 p-4">
        <div className="flex items-start gap-2">
          <code className="min-h-10 flex-1 font-mono text-[14px] leading-relaxed break-all text-ink">{value}</code>
          <button
            type="button"
            className="icon-btn shrink-0"
            onClick={() => setSeed((prev) => prev + 1)}
            aria-label="Generate another"
            title="Generate another"
          >
            <Icon name="refresh" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn shrink-0"
            onClick={() => copy(value)}
            aria-label="Copy password"
            title="Copy password"
          >
            <Icon name={copied ? 'check' : 'copy'} size={16} className={copied ? 'text-success' : undefined} />
          </button>
        </div>
        <div className="mt-3">
          <StrengthMeter strength={strength} bits={bits} />
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <Label htmlFor="generator-length">Length</Label>
          <span className="font-mono text-[12px] text-ink">{options.length}</span>
        </div>
        <input
          id="generator-length"
          type="range"
          min={8}
          max={64}
          value={options.length}
          onChange={(event) => setOptions((prev) => ({ ...prev, length: Number(event.target.value) }))}
          className="w-full accent-[var(--primary)]"
          aria-label="Password length"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {(
          [
            ['lowercase', 'a-z'],
            ['uppercase', 'A-Z'],
            ['digits', '0-9'],
            ['symbols', '!@#$'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={options[key]}
            className={cx(
              'flex h-9 items-center justify-between rounded-lg border px-3 text-[12.5px] transition-colors',
              options[key]
                ? 'border-accent/35 bg-accent-soft text-ink'
                : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            <span className="font-mono text-[12px]">{label}</span>
            <Icon name="check" size={13} className={options[key] ? 'text-accent' : 'opacity-0'} />
          </button>
        ))}
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-muted select-none">
        <input
          type="checkbox"
          checked={options.avoidAmbiguous}
          onChange={() => toggle('avoidAmbiguous')}
          className="size-3.5 accent-[var(--primary)]"
        />
        Avoid look-alikes
      </label>

      <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
        {onUse && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onUse(value)
              onClose()
            }}
          >
            Use this password
          </button>
        )}
        {!onUse && (
          <button type="button" className="btn-primary" onClick={() => copy(value)}>
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            {copied ? 'Copied' : 'Copy password'}
          </button>
        )}
      </div>
    </Modal>
  )
}

function emptyDraft(type: EntryType): Entry {
  const now = new Date().toISOString()
  return {
    id: '',
    type,
    title: '',
    tags: [],
    favorite: false,
    twoFactor: type === 'login' ? 'off' : undefined,
    createdAt: now,
    updatedAt: now,
  }
}

export function EntryForm({
  entry,
  onSave,
  onCancel,
  initialGeneratorOpen = false,
}: {
  entry: Entry
  onSave: (entry: Entry) => void
  onCancel: () => void
  initialGeneratorOpen?: boolean
}) {
  const [draft, setDraft] = useState<Entry>(entry)
  const [tagText, setTagText] = useState(entry.tags.join(', '))
  const [generatorOpen, setGeneratorOpen] = useState(initialGeneratorOpen)
  const [totpError, setTotpError] = useState<string | null>(null)
  const hasTotp = draft.type === 'login' && Boolean(draft.totp?.trim() && parseTotp(draft.totp))
  const twoFactorState = hasTotp ? 'on' : (draft.twoFactor ?? 'off')

  const set = <K extends keyof Entry>(key: K, value: Entry[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  const setCard = (key: 'number' | 'holder' | 'expiry' | 'cvv' | 'pin', value: string) =>
    setDraft((prev) => ({ ...prev, card: { ...prev.card, [key]: value } }))

  const setIdentity = (key: 'fullName' | 'email' | 'phone' | 'address', value: string) =>
    setDraft((prev) => ({ ...prev, identity: { ...prev.identity, [key]: value } }))

  const strength = scorePassword(draft.password ?? '')
  const meta = TYPE_META[draft.type]

  function submit() {
    const title = draft.title.trim()
    if (!title) return
    if (draft.type === 'login' && draft.totp?.trim() && !parseTotp(draft.totp)) {
      setTotpError('Enter a valid base32 secret or otpauth:// URI.')
      return
    }
    setTotpError(null)
    onSave({
      ...draft,
      title,
      twoFactor: hasTotp ? 'on' : draft.twoFactor,
      tags: tagText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 30),
      updatedAt: new Date().toISOString(),
    })
  }

  useEffect(() => {
    setGeneratorOpen(initialGeneratorOpen)
  }, [initialGeneratorOpen, entry.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" className="icon-btn md:hidden" onClick={onCancel} aria-label="Back to list">
            <Icon name="arrowLeft" size={17} />
          </button>
          <span className="chip">{meta.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary h-9 px-2.5 text-[12px] sm:h-8" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary h-9 px-3 text-[12px] sm:h-8"
            onClick={submit}
            disabled={!draft.title.trim()}
          >
            Save
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[680px] space-y-6 px-4 py-6 sm:px-6">
          <Section title="Item">
            <div className="space-y-3.5">
              <div>
                <Label htmlFor="entry-title">Title</Label>
                <input
                  id="entry-title"
                  name="title"
                  className="field h-10 text-[14px] font-medium"
                  value={draft.title}
                  onChange={(event) => set('title', event.target.value)}
                  placeholder={draft.type === 'login' ? 'e.g. GitHub' : 'Untitled'}
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="entry-tags">Tags</Label>
                <input
                  id="entry-tags"
                  className="field"
                  value={tagText}
                  onChange={(event) => setTagText(event.target.value)}
                  placeholder="e.g. work, personal"
                />
              </div>
            </div>
          </Section>

          {draft.type === 'login' && (
            <Section title="Login">
              <div className="space-y-3.5">
                <div>
                  <Label htmlFor="entry-username">Username or email</Label>
                  <input
                    id="entry-username"
                    name="username"
                    className="field"
                    value={draft.username ?? ''}
                    onChange={(event) => set('username', event.target.value)}
                    placeholder="name@example.com"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <Label htmlFor="entry-password">Password</Label>
                    <button
                      type="button"
                      className="mb-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:text-accent-hover"
                      onClick={() => setGeneratorOpen(true)}
                    >
                      <Icon name="shuffle" size={12} /> Generate
                    </button>
                  </div>
                  <PasswordInput
                    id="entry-password"
                    name="password"
                    value={draft.password ?? ''}
                    onChange={(value) => set('password', value)}
                  />
                  {draft.password ? (
                    <div className="mt-2">
                      <StrengthMeter strength={strength} />
                    </div>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="entry-url">Website</Label>
                  <input
                    id="entry-url"
                    name="url"
                    className="field"
                    value={draft.url ?? ''}
                    onChange={(event) => set('url', event.target.value)}
                    placeholder="https://example.com"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <Label htmlFor="entry-totp">Authenticator secret</Label>
                  <PasswordInput
                    id="entry-totp"
                    name="totp"
                    value={draft.totp ?? ''}
                    onChange={(value) => {
                      set('totp', value)
                      setTotpError(null)
                    }}
                    placeholder="e.g. JBSWY3DPEHPK3PXP"
                    autoComplete="off"
                    revealLabel="authenticator secret"
                  />
                  {totpError ? (
                    <p className="mt-1 text-[11px] text-danger">{totpError}</p>
                  ) : (
                    <p className="mt-1 text-[11px] text-faint">Base32 secret or an otpauth:// link.</p>
                  )}
                </div>

                <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[12px] font-medium text-ink">Two-factor authentication</p>
                    <div
                      role="group"
                      aria-label="Two-factor authentication"
                      className="flex shrink-0 rounded-md border border-line bg-surface p-0.5"
                    >
                      {(
                        [
                          ['on', 'On'],
                          ['off', 'Off'],
                          ['unavailable', 'Not offered'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={twoFactorState === value}
                          onClick={() => set('twoFactor', value)}
                          disabled={hasTotp && value !== 'on'}
                          className={cx(
                            'h-7 rounded px-2 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                            twoFactorState === value
                              ? 'bg-accent-soft text-accent'
                              : 'text-muted hover:text-ink',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {hasTotp && (
                    <p className="mt-2 text-[11px] text-faint">A secret is saved, so this stays on.</p>
                  )}
                  <label className="mt-2.5 flex cursor-pointer items-center gap-2 border-t border-line pt-2.5 text-[11.5px] text-muted">
                    <input
                      type="checkbox"
                      checked={draft.auditIgnored ?? false}
                      onChange={(event) => set('auditIgnored', event.target.checked)}
                      className="size-3.5 accent-[var(--primary)]"
                    />
                    Ignore this item in the security audit
                  </label>
                </div>
              </div>
            </Section>
          )}

          {draft.type === 'card' && (
            <Section title="Card">
              <div className="space-y-3.5">
                <div>
                  <Label htmlFor="card-number">Card number</Label>
                  <input
                    id="card-number"
                    name="card-number"
                    className="field font-mono text-[12.5px]"
                    value={draft.card?.number ?? ''}
                    onChange={(event) => setCard('number', event.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="card-holder">Cardholder</Label>
                    <input
                      id="card-holder"
                      name="card-holder"
                      className="field"
                      value={draft.card?.holder ?? ''}
                      onChange={(event) => setCard('holder', event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="card-expiry">Expiry</Label>
                    <input
                      id="card-expiry"
                      name="card-expiry"
                      className="field font-mono text-[12.5px]"
                      value={draft.card?.expiry ?? ''}
                      onChange={(event) => setCard('expiry', event.target.value)}
                      placeholder="09/29"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="card-cvv">CVV</Label>
                    <input
                      id="card-cvv"
                      name="card-cvv"
                      className="field font-mono text-[12.5px]"
                      value={draft.card?.cvv ?? ''}
                      onChange={(event) => setCard('cvv', event.target.value)}
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <Label htmlFor="card-pin">PIN</Label>
                    <input
                      id="card-pin"
                      name="card-pin"
                      className="field font-mono text-[12.5px]"
                      value={draft.card?.pin ?? ''}
                      onChange={(event) => setCard('pin', event.target.value)}
                    />
                  </div>
                </div>
              </div>
            </Section>
          )}

          {draft.type === 'identity' && (
            <Section title="Identity">
              <div className="space-y-3.5">
                <div>
                  <Label htmlFor="identity-name">Full name</Label>
                  <input
                    id="identity-name"
                    name="identity-name"
                    className="field"
                    value={draft.identity?.fullName ?? ''}
                    onChange={(event) => setIdentity('fullName', event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="identity-email">Email</Label>
                    <input
                      id="identity-email"
                      name="identity-email"
                      className="field"
                      value={draft.identity?.email ?? ''}
                      onChange={(event) => setIdentity('email', event.target.value)}
                      autoCapitalize="none"
                    />
                  </div>
                  <div>
                    <Label htmlFor="identity-phone">Phone</Label>
                    <input
                      id="identity-phone"
                      name="identity-phone"
                      className="field"
                      value={draft.identity?.phone ?? ''}
                      onChange={(event) => setIdentity('phone', event.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="identity-address">Address</Label>
                  <textarea
                    id="identity-address"
                    name="identity-address"
                    className="field h-auto min-h-20 resize-y py-2"
                    value={draft.identity?.address ?? ''}
                    onChange={(event) => setIdentity('address', event.target.value)}
                  />
                </div>
              </div>
            </Section>
          )}

          <Section title="Notes">
            <textarea
              id="entry-notes"
              name="notes"
              aria-label="Notes"
              className="field h-auto min-h-28 resize-y py-2 leading-relaxed"
              value={draft.notes ?? ''}
              onChange={(event) => set('notes', event.target.value)}
              placeholder="Optional"
            />
          </Section>

          <p className="text-center text-[11px] text-faint">
            <span className="kbd">⌘</span> <span className="kbd">↵</span> to save
          </p>
        </div>
      </div>

      <GeneratorModal
        open={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        onUse={(value) => set('password', value)}
      />
    </div>
  )
}

export function newDraft(type: EntryType): Entry {
  return emptyDraft(type)
}
