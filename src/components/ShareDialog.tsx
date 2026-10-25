import { useEffect, useState } from 'react'
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
import { Icon, Modal, Spinner, useCopyToClipboard } from './ui'

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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share password"
      description="A private link that expires in 3 days"
      width="max-w-md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
          <Icon name="lock" size={14} className="mt-0.5 shrink-0 text-faint" />
          <span>
            The password is encrypted in this tab. The decryption key travels only in the link
            fragment, so Rook's server cannot read it.
          </span>
        </div>

        {visibleCreated ? (
          <div className="rounded-lg border border-success/25 bg-success/5 p-3">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <Icon name="checkCircle" size={15} className="text-success" />
              Link ready
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Copy it now. Rook does not store the key, so this link cannot be shown again after you
              close this dialog.
            </p>
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
            <p className="mt-2 text-[10.5px] text-faint">
              Expires in {formatShareRemaining(visibleCreated.expiresAt, now)} ·{' '}
              {new Date(visibleCreated.expiresAt).toLocaleString()}
            </p>
            <button
              type="button"
              className="btn-danger mt-2 h-7 px-2 text-[11px]"
              onClick={() => void revoke(visibleCreated.id)}
              disabled={busy}
            >
              Revoke this link
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => void createLink()}
            disabled={busy}
          >
            {busy ? <Spinner size={14} /> : <Icon name="link" size={14} />}
            {busy ? 'Creating link…' : 'Create 3-day link'}
          </button>
        )}

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[11.5px] font-medium text-muted">Active links</h3>
            {loading && <Spinner size={12} className="text-faint" />}
          </div>
          <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-surface">
            {otherShares.length === 0 && !loading ? (
              <p className="px-3 py-3 text-[11.5px] text-faint">No other active links for this item.</p>
            ) : (
              otherShares.map((share) => (
                <div
                  key={share.id}
                  className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="link" size={13} className="shrink-0 text-faint" />
                    <span className="truncate text-[11.5px] text-muted">
                      Expires in {formatShareRemaining(share.expiresAt, now)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-danger h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => void revoke(share.id)}
                    disabled={busy}
                  >
                    Revoke
                  </button>
                </div>
              ))
            )}
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
            Existing link keys are not stored, so only the link created in this dialog can be copied
            again.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="border-t border-line pt-3 text-[10.5px] leading-relaxed text-faint">
          Anyone with the link can view this password until it expires. Share it only with someone
          you trust. Deleting the item does not revoke active links; revoke them here first.
        </div>
      </div>
    </Modal>
  )
}
