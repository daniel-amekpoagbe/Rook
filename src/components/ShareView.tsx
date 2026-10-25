import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { getShareFn } from '~/server/api'
import { decodeShareKey, formatShareRemaining, openShare, type SharePayload } from '~/lib/share'
import { Icon, Spinner, ThemeToggle, cx, useCopyToClipboard } from './ui'
import { RookMark } from './RookMark'
import { BrandIcon, brandCssVars, brandForEntry } from './BrandIcon'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; payload: SharePayload; expiresAt: number }
  | { status: 'error'; message: string }

function shareErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('SHARE_UNAVAILABLE')) {
    return 'This link is invalid or has expired. Shared passwords stay available for three days.'
  }
  if (message.includes('SHARE_EXPIRED')) {
    return 'This link has expired. Shared passwords stay available for three days.'
  }
  if (message.includes('Invalid share key') || message.includes('INCOMPLETE')) {
    return 'This link is incomplete or damaged. Ask the sender to copy the full link again.'
  }
  return 'This link could not be opened. It may have expired or been tampered with.'
}

function shareHref(url: string): string | undefined {
  const candidate = url.includes('://') ? url : `https://${url}`
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString()
  } catch {
    // Fall through: render the URL as plain text instead of an active link.
  }
  return undefined
}

function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
      <a href="/" className="flex items-center gap-2.5" aria-label="Rook home">
        <span className="flex size-8 items-center justify-center rounded-[10px] border border-line bg-white text-[#0a0b0e] shadow-rest">
          <RookMark className="size-[18px]" />
        </span>
        <span className="text-[14px] font-semibold tracking-[-0.02em]">Rook</span>
      </a>
      <ThemeToggle />
    </header>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <Header />
      <main className="flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-[640px]">{children}</div>
      </main>
      <footer className="px-5 pb-5 text-center text-[10.5px] text-faint">
        End-to-end encrypted · Rook never sees this password
      </footer>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rise rounded-xl border border-line bg-surface p-6 text-center shadow-rest">
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl border border-danger/20 bg-danger-soft text-danger">
        <Icon name="alert" size={20} />
      </span>
      <h1 className="mt-4 text-[18px] font-semibold tracking-[-0.015em]">Link unavailable</h1>
      <p className="mx-auto mt-1.5 max-w-[34ch] text-[12.5px] leading-relaxed text-muted">{message}</p>
      <a href="/" className="btn-secondary mt-5">
        Open Rook
      </a>
    </div>
  )
}

function ShareField({
  label,
  value,
  href,
  secret = false,
}: {
  label: string
  value: string
  href?: string
  secret?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const { copied, copy } = useCopyToClipboard()

  return (
    <div className="group flex items-start justify-between gap-4 border-b border-line px-4 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-muted">{label}</div>
        <div
          className={cx(
            'mt-1 break-all text-[14px] text-ink',
            secret && 'font-mono tracking-wide',
            secret && !revealed && 'select-none tracking-[0.22em]',
          )}
        >
          {secret && !revealed ? (
            '••••••••••••'
          ) : href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 break-all hover:text-accent"
            >
              {value}
              <Icon name="arrowUpRight" size={12} className="shrink-0 text-faint" />
            </a>
          ) : (
            value
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pt-1">
        {secret && (
          <button
            type="button"
            className="icon-btn size-7"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? 'Hide password' : 'Reveal password'}
          >
            <Icon name={revealed ? 'eyeOff' : 'eye'} size={14} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn size-7"
          onClick={() => copy(value)}
          aria-label={`Copy ${label} to clipboard`}
        >
          <Icon
            name={copied ? 'check' : 'copy'}
            size={14}
            className={copied ? 'text-success' : undefined}
          />
        </button>
      </div>
    </div>
  )
}

function ReadyCard({
  payload,
  expiresAt,
  now,
}: {
  payload: SharePayload
  expiresAt: number
  now: number
}) {
  const { copied, copy } = useCopyToClipboard()
  const websiteHref = payload.url ? shareHref(payload.url) : undefined
  const brand = brandForEntry(payload.url, payload.title)
  const initial = payload.title.trim().charAt(0).toUpperCase()
  const remaining = formatShareRemaining(expiresAt, now)

  return (
    <div className="rise">
      <div className="flex items-start gap-4">
        <span
          className={cx('avatar shrink-0', brand && 'avatar-brand')}
          style={{
            ...(brand ? brandCssVars(brand) : { '--hue': 214 }),
            width: 56,
            height: 56,
            fontSize: 20,
          } as CSSProperties}
          aria-hidden="true"
        >
          {brand ? <BrandIcon brand={brand} size={34} /> : initial || <Icon name="key" size={24} />}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip normal-case tracking-normal">Shared password</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[10.5px] text-muted">
              <Icon name="clock" size={11} className="text-faint" />
              Expires in {remaining}
            </span>
          </div>
          <h1 className="mt-2 text-[26px] leading-[1.15] font-semibold tracking-[-0.03em] break-words sm:text-[28px]">
            {payload.title}
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">Shared by {payload.from || 'a Rook user'}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary h-9 px-3.5 text-[12.5px]"
          onClick={() => copy(payload.password)}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? 'Copied' : 'Copy password'}
        </button>
        {websiteHref && (
          <a
            className="btn-secondary h-9 px-3.5 text-[12.5px]"
            href={websiteHref}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Icon name="globe" size={14} />
            Open website
            <Icon name="arrowUpRight" size={12} className="text-faint" />
          </a>
        )}
        {payload.username && (
          <button
            type="button"
            className="btn-secondary h-9 px-3.5 text-[12.5px]"
            onClick={() => copy(payload.username!)}
          >
            <Icon name="copy" size={14} />
            Copy username
          </button>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface shadow-rest">
        {payload.username && <ShareField label="Username" value={payload.username} />}
        <ShareField label="Password" value={payload.password} secret />
        {payload.url && <ShareField label="Website" value={payload.url} href={websiteHref} />}
      </div>

      <div className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-faint">
        <Icon name="shield" size={13} className="mt-0.5 shrink-0 text-success" />
        <span>
          This link expires in {remaining}. Anyone with the link can open these credentials, so share
          it only with the intended recipient.
        </span>
      </div>
      <p className="mt-2 text-[10.5px] text-faint">
        Expires {new Date(expiresAt).toLocaleString()}
      </p>
    </div>
  )
}

export function ShareView({ shareId }: { shareId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    let generation = 0

    async function load() {
      const current = ++generation
      try {
        const fragment = window.location.hash.replace(/^#/, '').trim()
        if (!fragment) throw new Error('INCOMPLETE')
        const key = decodeShareKey(fragment)
        const share = await getShareFn({ data: { id: shareId } })
        const payload = openShare(share, key, shareId)
        const expiresAt = Math.min(Date.parse(payload.expiresAt), share.expiresAt)
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          throw new Error('SHARE_EXPIRED')
        }
        if (active && current === generation) {
          setNow(Date.now())
          setState({ status: 'ready', payload, expiresAt })
        }
      } catch (error) {
        if (active && current === generation) {
          setState({ status: 'error', message: shareErrorMessage(error) })
        }
      }
    }

    void load()
    const onHashChange = () => {
      setState({ status: 'loading' })
      void load()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => {
      active = false
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [shareId])

  useEffect(() => {
    if (state.status !== 'ready') return
    const tick = () => {
      if (Date.now() >= state.expiresAt) {
        setState({
          status: 'error',
          message: 'This link has expired. Shared passwords stay available for three days.',
        })
        return
      }
      setNow(Date.now())
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [state])

  if (state.status === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center py-16 text-center">
          <Spinner size={20} className="text-accent" />
          <p className="mt-3 text-[12.5px] text-muted">Opening shared password…</p>
        </div>
      </Shell>
    )
  }

  if (state.status === 'error') {
    return (
      <Shell>
        <ErrorCard message={state.message} />
      </Shell>
    )
  }

  return (
    <Shell>
      <ReadyCard payload={state.payload} expiresAt={state.expiresAt} now={now} />
    </Shell>
  )
}
