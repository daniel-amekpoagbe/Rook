import { useEffect, useState, type ReactNode } from 'react'
import { getShareFn } from '~/server/api'
import {
  decodeShareKey,
  formatShareExpiry,
  openShare,
  safeShareHref,
  type SharePayload,
} from '~/lib/share'
import { Icon, Spinner, cx, useCopyToClipboard } from './ui'
import { RookMark } from './RookMark'
import { BrandIcon, brandForEntry } from './BrandIcon'

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

function ShareHeader() {
  return (
    <header className="share-header">
      <div className="share-header-content">
        <a href="/" className="share-brand" aria-label="Rook home">
          <span className="share-brand-mark">
            <RookMark className="size-[17px]" />
          </span>
          <span>Rook</span>
        </a>
        <h1 className="share-header-message">Someone shared an item with you.</h1>
      </div>
    </header>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="share-shell" data-theme="dark">
      <ShareHeader />
      <main className="share-main">
        <div className="share-content">{children}</div>
      </main>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="share-error rise">
      <span className="share-error-icon">
        <Icon name="alert" size={20} />
      </span>
      <h2 className="share-error-title">Link unavailable</h2>
      <p className="share-error-message">{message}</p>
      <a href="/" className="share-button share-button-secondary mt-5">
        Open Rook
      </a>
    </div>
  )
}

function ShareField({
  label,
  value,
  secret = false,
}: {
  label: string
  value: string
  secret?: boolean
}) {
  const [visible, setVisible] = useState(!secret)
  const { copied, copy } = useCopyToClipboard()
  const masked = secret && !visible
  const chevronOpen = secret ? visible : !visible
  const toggleLabel = secret
    ? visible
      ? 'Hide password'
      : 'Reveal password'
    : visible
      ? `Hide ${label}`
      : `Show ${label}`

  return (
    <div className="share-field">
      <div className="share-field-main">
        <div className="share-field-label">{label}</div>
        <div className={cx('share-field-value', masked && 'share-field-secret')}>
          {masked ? '••••••••••••' : value}
        </div>
      </div>
      <div className="share-field-actions">
        <button
          type="button"
          className="share-copy-button"
          onClick={() => copy(value)}
          aria-label={`Copy ${label} to clipboard`}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className="share-chevron-button"
          onClick={() => setVisible((previous) => !previous)}
          aria-label={toggleLabel}
        >
          <Icon name="chevronDown" size={15} className={chevronOpen ? 'rotate-180' : undefined} />
        </button>
      </div>
    </div>
  )
}

function WebsiteLink({ url }: { url: string }) {
  const href = safeShareHref(url)
  return (
    <div className="share-website">
      <div className="share-field-label">website</div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className="share-website-link">
          {url}
        </a>
      ) : (
        <span className="share-website-link">{url}</span>
      )}
    </div>
  )
}

function ReadyCard({ payload, expiresAt }: { payload: SharePayload; expiresAt: number }) {
  const brand = brandForEntry(payload.url, payload.title)
  const initial = payload.title.trim().charAt(0).toUpperCase()

  return (
    <div className="share-ready rise">
      <div className="share-expiry">Read only · available until {formatShareExpiry(expiresAt)}</div>
      <div className="share-card-body">
        <div className="share-intro">
          <span className="share-entry-icon" aria-hidden="true">
            {brand ? <BrandIcon brand={brand} size={36} /> : initial || <Icon name="key" size={24} />}
          </span>
          <h2 className="share-entry-title">{payload.title}</h2>
        </div>

        <div className="share-fields">
          {payload.username && <ShareField label="username" value={payload.username} />}
          <ShareField label="password" value={payload.password} secret />
        </div>

        {payload.url && <WebsiteLink url={payload.url} />}
      </div>
    </div>
  )
}

function PromoCard() {
  return (
    <div className="share-promo">
      <div className="share-promo-copy">
        <p className="share-promo-title">Passwords, shared securely.</p>
        <p className="share-promo-body">
          Rook is a zero-knowledge password manager. Your master password never leaves your device.
        </p>
      </div>
      <a href="/" className="share-promo-button">
        Open Rook
      </a>
    </div>
  )
}

export function ShareView({ shareId }: { shareId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

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
      }
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [state])

  if (state.status === 'loading') {
    return (
      <Shell>
        <div className="share-loading">
          <Spinner size={20} className="text-[#8db6ff]" />
          <p>Opening shared item…</p>
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
      <ReadyCard payload={state.payload} expiresAt={state.expiresAt} />
      <PromoCard />
    </Shell>
  )
}
