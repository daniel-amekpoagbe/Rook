import { useEffect, useState, type ReactNode } from 'react'
import { getShareFn } from '~/server/api'
import { decodeShareKey, formatShareRemaining, openShare, type SharePayload } from '~/lib/share'
import { Icon, Spinner, ThemeToggle, useCopyToClipboard } from './ui'
import { RookMark } from './RookMark'

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
    <header className="flex h-16 items-center justify-between px-5">
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
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-[440px]">{children}</div>
      </main>
      <footer className="px-5 pb-5 text-center text-[10.5px] text-faint">
        End-to-end encrypted · Rook never sees this password
      </footer>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-6 text-center shadow-rest">
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
}: {
  label: string
  value: string
  href?: string
}) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-muted">{label}</div>
        <div className="mt-0.5 break-all font-mono text-[12.5px] text-ink">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 hover:text-accent"
            >
              {value}
              <Icon name="arrowUpRight" size={11} className="text-faint" />
            </a>
          ) : (
            value
          )}
        </div>
      </div>
      <button
        type="button"
        className="icon-btn size-7 shrink-0"
        onClick={() => copy(value)}
        aria-label={`Copy ${label}`}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} className={copied ? 'text-success' : undefined} />
      </button>
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
  const [revealed, setRevealed] = useState(false)
  const { copied, copy } = useCopyToClipboard()
  const websiteHref = payload.url ? shareHref(payload.url) : undefined

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-rest sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft text-accent">
          <Icon name="link" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">Shared password</p>
          <h1 className="mt-0.5 truncate text-[20px] font-semibold tracking-[-0.02em]">{payload.title}</h1>
          <p className="mt-0.5 text-[12px] text-muted">
            Shared by {payload.from || 'a Rook user'}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-line bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11.5px] font-medium text-muted">Password</span>
          <span className="inline-flex items-center gap-1 text-[10.5px] text-faint">
            <Icon name="clock" size={11} />
            Expires in {formatShareRemaining(expiresAt, now)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <code
            className={`min-w-0 flex-1 break-all font-mono text-[15px] tracking-wide text-ink ${
              revealed ? '' : 'select-none tracking-[0.18em]'
            }`}
          >
            {revealed ? payload.password : '••••••••••••'}
          </code>
          <button
            type="button"
            className="icon-btn size-7 shrink-0"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? 'Hide password' : 'Reveal password'}
          >
            <Icon name={revealed ? 'eyeOff' : 'eye'} size={14} />
          </button>
          <button
            type="button"
            className="icon-btn size-7 shrink-0"
            onClick={() => copy(payload.password)}
            aria-label="Copy password"
          >
            <Icon
              name={copied ? 'check' : 'copy'}
              size={14}
              className={copied ? 'text-success' : undefined}
            />
          </button>
        </div>
      </div>

      {(payload.username || payload.url) && (
        <div className="mt-3 rounded-lg border border-line bg-surface px-3">
          {payload.username && <ShareField label="Username" value={payload.username} />}
          {payload.url && (
            <ShareField label="Website" value={payload.url} href={websiteHref} />
          )}
        </div>
      )}

      <button
        type="button"
        className="btn-primary mt-4 w-full"
        onClick={() => copy(payload.password)}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        {copied ? 'Copied to clipboard' : 'Copy password'}
      </button>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
        <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-warn" />
        <span>
          Anyone with this link can view the password until it expires. Do not forward it or post it
          publicly.
        </span>
      </div>

      <p className="mt-3 text-center text-[10.5px] text-faint">
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
        <div className="flex flex-col items-center rounded-xl border border-line bg-surface px-6 py-12 text-center shadow-rest">
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
