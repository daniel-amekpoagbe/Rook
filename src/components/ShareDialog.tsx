import { useEffect, useState, type CSSProperties } from 'react'
import {
  createRecipientShareFn,
  listSentRecipientSharesFn,
  lookupRecipientFn,
  revokeRecipientShareFn,
} from '~/server/api'
import {
  formatShareRemaining,
  newShareKey,
  sealShare,
  SHARE_FORMAT_VERSION,
  type SharePayload,
} from '~/lib/share'
import {
  RECIPIENT_SHARE_TTL_MS,
  sealShareKeyForRecipient,
} from '~/lib/recipient-share'
import { friendlyError } from '~/lib/vault-context'
import type { Entry } from '~/lib/vault'
import { Icon, Modal, Spinner, cx } from './ui'
import { BrandIcon, brandCssVars, brandForEntry } from './BrandIcon'

interface SentShare {
  id: string
  recipientHandle: string
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
  const [recipientHandle, setRecipientHandle] = useState('')
  const [shares, setShares] = useState<SentShare[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    setRecipientHandle('')
    setShares([])
    setLoading(true)
    setError(null)
    setNotice(null)
    listSentRecipientSharesFn({ data: { entryId: entry.id } })
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

  async function share() {
    if (busy || !entry.password) return
    const recipient = recipientHandle.trim().toLowerCase()
    if (!recipient) {
      setError('Enter the handle of a Rook account.')
      return
    }
    if (!handle) {
      setError('Your session expired. Lock and unlock Rook, then try again.')
      return
    }
    if (recipient === handle.toLowerCase()) {
      setError(friendlyError(new Error('RECIPIENT_SELF')))
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)
    const id = crypto.randomUUID()
    const { key } = newShareKey()
    try {
      const resolved = await lookupRecipientFn({ data: { handle: recipient } })
      const expiresAt = new Date(Date.now() + RECIPIENT_SHARE_TTL_MS).toISOString()
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
      const envelope = await sealShareKeyForRecipient({
        shareKey: key,
        recipientPublicKey: resolved.publicKey,
        shareId: id,
        ownerHandle: handle,
        recipientHandle: resolved.handle,
      })
      const result = await createRecipientShareFn({
        data: {
          id,
          entryId: entry.id,
          recipientHandle: resolved.handle,
          recipientPublicKey: resolved.publicKey,
          ciphertext: sealed.ciphertext,
          nonce: sealed.nonce,
          ...envelope,
        },
      })
      setShares((previous) => [
        {
          id,
          recipientHandle: result.recipientHandle,
          expiresAt: result.expiresAt,
          createdAt: result.createdAt,
        },
        ...previous,
      ])
      setRecipientHandle('')
      setNotice(`Shared with ${result.recipientHandle}.`)
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      key.fill(0)
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await revokeRecipientShareFn({ data: { id } })
      setShares((previous) => previous.filter((item) => item.id !== id))
      setNotice('Access revoked.')
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setBusy(false)
    }
  }

  const activeShares = shares.filter((item) => item.expiresAt > now)
  const brand = brandForEntry(entry.url, entry.title)
  const initial = entry.title.trim().charAt(0).toUpperCase()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share password"
      description="Encrypted for one Rook account"
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

        <div>
          <label htmlFor="recipient-handle" className="label">
            Recipient handle
          </label>
          <div className="flex gap-2">
            <input
              id="recipient-handle"
              name="recipient-handle"
              className="field h-9 min-w-0 flex-1"
              placeholder="name@example.com"
              value={recipientHandle}
              onChange={(event) => {
                setRecipientHandle(event.target.value)
                setError(null)
                setNotice(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void share()
                }
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
            <button
              type="button"
              className="btn-primary h-9 shrink-0 px-3"
              onClick={() => void share()}
              disabled={busy || !recipientHandle.trim()}
            >
              {busy ? <Spinner size={14} /> : <Icon name="mail" size={14} />}
              {busy ? 'Sharing…' : 'Share'}
            </button>
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
            They need a Rook account and must unlock it once. The share key is wrapped to their
            public key, so only they can decrypt it.
          </p>
        </div>

        {notice && (
          <div className="flex items-center gap-2 rounded-lg border border-success/25 bg-success/5 px-3 py-2 text-[11.5px] text-ink">
            <Icon name="checkCircle" size={14} className="shrink-0 text-success" />
            <span>{notice}</span>
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[11px] font-medium text-muted">Shared with</h3>
            {loading && <Spinner size={12} className="text-faint" />}
          </div>
          <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-surface">
            {activeShares.length === 0 ? (
              <p className="px-3 py-3 text-[11.5px] text-faint">
                {loading ? 'Loading…' : 'Not shared with anyone yet.'}
              </p>
            ) : (
              activeShares.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 last:border-0"
                >
                  <span className="inline-flex min-w-0 items-center gap-2 text-[11.5px] text-muted">
                    <Icon name="user" size={13} className="shrink-0 text-faint" />
                    <span className="truncate">{item.recipientHandle}</span>
                    <span className="shrink-0 text-faint">
                      · expires in {formatShareRemaining(item.expiresAt, now)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] font-medium text-danger hover:underline disabled:opacity-45"
                    onClick={() => void revoke(item.id)}
                    disabled={busy}
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

        <p className="border-t border-line pt-3 text-center text-[10.5px] leading-relaxed text-faint">
          Only the recipient can decrypt this share. Revoking removes future access.
        </p>
      </div>
    </Modal>
  )
}
