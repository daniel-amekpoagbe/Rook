import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createShareFn, listEntrySharesFn, revokeShareFn } from '~/server/api'
import {
  formatShareRemaining,
  newShareKey,
  sealShare,
  SHARE_FORMAT_VERSION,
  SHARE_TTL_MS,
  type SharePayload,
} from '~/lib/share'
import { friendlyError } from '~/lib/vault-context'
import type { Entry } from '~/lib/vault'
import { Icon, Modal, Spinner, cx, useCopyToClipboard } from './ui'
import { BrandIcon, brandCssVars, brandForEntry } from './BrandIcon'

interface LinkShare {
  id: string
  expiresAt: number
  createdAt: number
}

export function ShareDialog({
  open,
  onClose,
  entry,
  handle,
}: {
  open: boolean
  onClose: () => void
  entry: Entry
  handle: string | null
}) {
  const [shares, setShares] = useState<LinkShare[]>([])
  const [link, setLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<'create' | 'revoke' | null>(null)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const { copied, copy } = useCopyToClipboard()

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    setShares([])
    setLink(null)
    setLoading(true)
    setError(null)
    listEntrySharesFn({ data: { entryId: entry.id } })
      .then((result) => {
        if (active) setShares(result.shares)
      })
      .catch((cause) => {
        if (active) setError(friendlyError(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, entry.id])

  async function createLink() {
    if (busyRef.current || !entry.password) return
    if (!handle) {
      setError('Your session expired. Lock and unlock Rook, then try again.')
      return
    }
    busyRef.current = true
    setPending('create')
    setError(null)
    const id = crypto.randomUUID()
    const { key, encoded } = newShareKey()
    try {
      const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString()
      const payload: SharePayload = {
        version: SHARE_FORMAT_VERSION,
        title: entry.title,
        password: entry.password,
        ...(entry.username ? { username: entry.username } : {}),
        ...(entry.url ? { url: entry.url } : {}),
        from: handle,
        expiresAt,
      }
      const sealed = sealShare(payload, key, id)
      const result = await createShareFn({
        data: {
          id,
          entryId: entry.id,
          ciphertext: sealed.ciphertext,
          nonce: sealed.nonce,
        },
      })
      setShares((previous) => [
        { id, expiresAt: result.expiresAt, createdAt: result.createdAt },
        ...previous,
      ])
      setLink(`${window.location.origin}/share/${id}#${encoded}`)
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      key.fill(0)
      busyRef.current = false
      setPending(null)
    }
  }

  async function revoke(id: string) {
    if (busyRef.current) return
    busyRef.current = true
    setPending('revoke')
    setError(null)
    try {
      await revokeShareFn({ data: { id } })
      setShares((previous) => previous.filter((item) => item.id !== id))
      setLink((current) => (current?.includes(`/share/${id}#`) ? null : current))
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      busyRef.current = false
      setPending(null)
    }
  }

  const activeShares = shares.filter((item) => item.expiresAt > now)
  const brand = brandForEntry(entry.url, entry.title)
  const initial = entry.title.trim().charAt(0).toUpperCase()

  return (
    <Modal open={open} onClose={onClose} title="Share" description="Read-only link" width="max-w-md">
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <span
            className={cx('avatar shrink-0', brand && 'avatar-brand')}
            style={{
              ...(brand ? brandCssVars(brand) : { '--hue': 214 }),
              width: 40,
              height: 40,
              fontSize: 14,
            } as CSSProperties}
            aria-hidden="true"
          >
            {brand ? <BrandIcon brand={brand} size={24} /> : initial || <Icon name="key" size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{entry.title}</p>
            <p className="truncate text-[11.5px] text-muted">{entry.username || 'Login'}</p>
          </div>
          <span className="chip">3 days</span>
        </div>

        <p className="text-[12px] leading-relaxed text-muted">
          Anyone with the link can view this login. They cannot change it.
        </p>

        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => void createLink()}
          disabled={pending !== null}
        >
          {pending === 'create' ? <Spinner size={14} /> : <Icon name="link" size={14} />}
          {pending === 'create' ? 'Creating…' : 'Create link'}
        </button>

        {link && (
          <div className="flex gap-2">
            <input
              readOnly
              className="field h-9 min-w-0 flex-1 font-mono text-[11.5px]"
              value={link}
              aria-label="Share link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="btn-secondary h-9 shrink-0 px-3" onClick={() => void copy(link)}>
              <Icon name={copied === link ? 'check' : 'copy'} size={14} />
              {copied === link ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] font-medium text-muted">Active links</h3>
            {loading && <Spinner size={12} className="text-faint" />}
          </div>
          <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-surface">
            {activeShares.length === 0 ? (
              <p className="px-3 py-3 text-[11.5px] text-faint">
                {loading ? 'Loading…' : 'No active links.'}
              </p>
            ) : (
              activeShares.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 last:border-0"
                >
                  <span className="inline-flex min-w-0 items-center gap-2 text-[11.5px] text-muted">
                    <Icon name="link" size={13} className="shrink-0 text-faint" />
                    <span className="truncate">Read-only link</span>
                    <span className="shrink-0 text-faint">
                      · {formatShareRemaining(item.expiresAt, now)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] font-medium text-danger hover:underline disabled:opacity-45"
                    onClick={() => void revoke(item.id)}
                    disabled={pending !== null}
                  >
                    Revoke
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
