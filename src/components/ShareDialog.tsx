import { useEffect, useState, type CSSProperties } from 'react'
import { createShareFn, listSharesFn, revokeShareFn } from '~/server/api'
import {
  formatShareRemaining,
  newShareKey,
  sealShare,
  SHARE_FORMAT_VERSION,
  SHARE_TTL_MS,
  type SharePayload,
} from '~/lib/share'
import type { Entry } from '~/lib/vault'
import { Icon, Modal, Spinner, cx, useCopyToClipboard } from './ui'
import { BrandIcon, brandCssVars, brandForEntry } from './BrandIcon'

interface ShareSummary {
  id: string
  expiresAt: number
  createdAt: number
}

interface CreatedShare {
  id: string
  url: string
  expiresAt: number
}

function shareDialogError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('SHARE_LIMIT')) {
    return 'You have reached the limit of 50 active links. Revoke an older link before creating another.'
  }
  if (message.includes('UNAUTHENTICATED')) {
    return 'Your session expired. Lock and unlock Rook, then try again.'
  }
  return 'Could not update sharing. Check your connection and try again.'
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
  const [shares, setShares] = useState<ShareSummary[]>([])
  const [created, setCreated] = useState<CreatedShare | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
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
    setLoading(true)
    setError(null)
    listSharesFn({ data: { entryId: entry.id } })
      .then((result) => {
        if (active) setShares(result.shares)
      })
      .catch((cause) => {
        if (active) setError(shareDialogError(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, entry.id])

  async function createLink() {
    if (!entry.password || busy) return
    setBusy(true)
    setError(null)
    try {
      const id = crypto.randomUUID()
      const { key, encoded } = newShareKey()
      const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString()
      const payload: SharePayload = {
        version: SHARE_FORMAT_VERSION,
        title: entry.title,
        password: entry.password,
        ...(entry.username ? { username: entry.username } : {}),
        ...(entry.url ? { url: entry.url } : {}),
        ...(handle ? { from: handle } : {}),
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
      const linkExpiry = Math.min(Date.parse(expiresAt), result.expiresAt)
      setCreated({
        id,
        url: `${window.location.origin}/share/${id}#${encoded}`,
        expiresAt: linkExpiry,
      })
      setShares((prev) => [
        { id, expiresAt: result.expiresAt, createdAt: result.createdAt },
        ...prev,
      ])
    } catch (cause) {
      setError(shareDialogError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await revokeShareFn({ data: { id } })
      setShares((prev) => prev.filter((share) => share.id !== id))
      if (created?.id === id) setCreated(null)
    } catch (cause) {
      setError(shareDialogError(cause))
    } finally {
      setBusy(false)
    }
  }

  const activeShares = shares.filter((share) => share.expiresAt > now)
  const visibleCreated = created && created.expiresAt > now ? created : null
  const otherShares = visibleCreated
    ? activeShares.filter((share) => share.id !== visibleCreated.id)
    : activeShares
  const brand = brandForEntry(entry.url, entry.title)
  const initial = entry.title.trim().charAt(0).toUpperCase()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share password"
      description="A private link that expires in 3 days"
      width="max-w-md"
    >
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

        {entry.attachments.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed text-muted">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-warn" />
            <span>Attachments are not included in shared links. Only the password is shared.</span>
          </div>
        )}

        {visibleCreated ? (
          <div className="rounded-xl border border-success/25 bg-success/5 p-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <Icon name="checkCircle" size={15} className="text-success" />
              Link ready
            </div>
            <div className="mt-2.5 flex gap-1.5">
              <input
                readOnly
                value={visibleCreated.url}
                aria-label="Share link"
                className="field h-9 min-w-0 flex-1 font-mono text-[11px]"
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="btn-primary h-9 px-3"
                onClick={() => copy(visibleCreated.url, 'link')}
              >
                <Icon name={copied === 'link' ? 'check' : 'copy'} size={14} />
                {copied === 'link' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[10.5px] text-faint">
                Expires in {formatShareRemaining(visibleCreated.expiresAt, now)}
              </p>
              <button
                type="button"
                className="text-[11px] font-medium text-danger hover:underline"
                onClick={() => void revoke(visibleCreated.id)}
                disabled={busy}
              >
                Revoke link
              </button>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
              Copy it now. Rook does not store the key, so this link cannot be shown again.
            </p>
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => void createLink()}
              disabled={busy}
            >
              {busy ? <Spinner size={14} /> : <Icon name="link" size={14} />}
              {busy ? 'Creating link…' : 'Create link'}
            </button>
            <p className="mt-2 text-center text-[10.5px] leading-relaxed text-faint">
              The decryption key stays in the link. Rook cannot read it.
            </p>
          </div>
        )}

        {(loading || otherShares.length > 0) && (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[11px] font-medium text-muted">Active links</h3>
              {loading && <Spinner size={12} className="text-faint" />}
            </div>
            <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-surface">
              {otherShares.length === 0 ? (
                <p className="px-3 py-3 text-[11.5px] text-faint">Loading…</p>
              ) : (
                otherShares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 last:border-0"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2 text-[11.5px] text-muted">
                      <Icon name="link" size={13} className="shrink-0 text-faint" />
                      <span className="truncate">
                        Expires in {formatShareRemaining(share.expiresAt, now)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-danger hover:underline disabled:opacity-45"
                      onClick={() => void revoke(share.id)}
                      disabled={busy}
                    >
                      Revoke
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="border-t border-line pt-3 text-center text-[10.5px] leading-relaxed text-faint">
          Anyone with the link can open this password.
        </p>
      </div>
    </Modal>
  )
}
