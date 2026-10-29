import { useEffect, useMemo, useRef, useState } from 'react'
import {
  dismissReceivedRecipientShareFn,
  listReceivedRecipientSharesFn,
} from '~/server/api'
import {
  formatShareExpiry,
  formatShareRemaining,
  openShare,
  safeShareHref,
  type SharePayload,
} from '~/lib/share'
import { openShareKeyFromRecipient } from '~/lib/recipient-share'
import { friendlyError, useVault } from '~/lib/vault-context'
import { entryFingerprint, newEntry, upsertEntry, type Entry } from '~/lib/vault'
import { Icon, Modal, Spinner, cx, useCopyToClipboard } from './ui'
import { BrandIcon, brandForEntry } from './BrandIcon'

interface ReceivedShare {
  id: string
  entryId: string
  ownerHandle: string
  ciphertext: string
  nonce: string
  ephemeralPublicKey: string
  wrapNonce: string
  wrappedKey: string
  expiresAt: number
  createdAt: number
}

interface ReceivedItem {
  share: ReceivedShare
  payload: SharePayload | null
  expiresAt: number
  error: string | null
}

async function decryptReceivedShare(
  share: ReceivedShare,
  privateKey: CryptoKey,
  recipientHandle: string,
): Promise<ReceivedItem> {
  const key = await openShareKeyFromRecipient({
    envelope: share,
    privateKey,
    shareId: share.id,
    ownerHandle: share.ownerHandle,
    recipientHandle,
  })
  try {
    const payload = openShare(
      { ciphertext: share.ciphertext, nonce: share.nonce },
      key,
      share.id,
    )
    const expiresAt = Math.min(Date.parse(payload.expiresAt), share.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('SHARE_EXPIRED')
    }
    return { share, payload, expiresAt, error: null }
  } finally {
    key.fill(0)
  }
}

function SharedField({
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

  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div
          className={cx(
            'min-w-0 flex-1 break-all font-mono text-[12.5px] text-ink',
            masked && 'tracking-[0.16em]',
          )}
        >
          {masked ? '••••••••••••' : value}
        </div>
        <button
          type="button"
          className="icon-btn size-7 shrink-0"
          onClick={() => void copy(value, label)}
          aria-label={`Copy ${label} to clipboard`}
        >
          <Icon name={copied === label ? 'check' : 'copy'} size={13} />
        </button>
        {secret && (
          <button
            type="button"
            className="icon-btn size-7 shrink-0"
            onClick={() => setVisible((previous) => !previous)}
            aria-label={visible ? 'Hide password' : 'Reveal password'}
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function WebsiteLink({ url }: { url: string }) {
  const href = safeShareHref(url)
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
        website
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1 block break-all text-[12.5px] text-accent hover:underline"
        >
          {url}
        </a>
      ) : (
        <span className="mt-1 block break-all text-[12.5px] text-muted">{url}</span>
      )}
    </div>
  )
}

function sharedLoginEntry(payload: SharePayload, ownerHandle: string): Entry {
  const entry = newEntry('login', {
    title: payload.title,
    username: payload.username,
    password: payload.password,
    url: payload.url,
    notes: `Shared by ${ownerHandle}`,
    twoFactor: 'unavailable',
  })
  entry.tags = ['shared']
  return entry
}

function ShareDetail({
  item,
  onBack,
  onDismiss,
  onAdd,
  dismissing,
  alreadyInVault,
}: {
  item: ReceivedItem
  onBack: () => void
  onDismiss: () => void
  onAdd: () => void
  dismissing: boolean
  alreadyInVault: boolean
}) {
  const payload = item.payload
  if (!payload) {
    return (
      <div>
        <button type="button" className="btn-secondary h-8 px-2.5 text-[12px]" onClick={onBack}>
          <Icon name="arrowLeft" size={13} /> Back
        </button>
        <div className="mt-4 rounded-xl border border-danger/20 bg-danger-soft px-4 py-4">
          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-danger">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <span>{item.error ?? 'This share could not be opened.'}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary mt-4 h-8 px-2.5 text-[12px]"
          onClick={onDismiss}
          disabled={dismissing}
        >
          <Icon name="trash" size={13} /> Remove from inbox
        </button>
      </div>
    )
  }

  const brand = brandForEntry(payload.url, payload.title)
  const initial = payload.title.trim().charAt(0).toUpperCase()

  return (
    <div>
      <button type="button" className="btn-secondary h-8 px-2.5 text-[12px]" onClick={onBack}>
        <Icon name="arrowLeft" size={13} /> Back
      </button>

      <div className="mt-4 flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-muted">
          {brand ? <BrandIcon brand={brand} size={26} /> : initial || <Icon name="key" size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {payload.title}
          </h3>
          <p className="mt-0.5 truncate text-[11.5px] text-muted">
            From {item.share.ownerHandle}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] text-muted">
        Expires in {formatShareRemaining(item.expiresAt)} · {formatShareExpiry(item.expiresAt)}
      </div>

      <div className="mt-3 space-y-2">
        {payload.username && <SharedField label="username" value={payload.username} />}
        <SharedField label="password" value={payload.password} secret />
        {payload.url && <WebsiteLink url={payload.url} />}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-primary h-8 flex-1 px-2.5 text-[12px]"
            onClick={onAdd}
            disabled={alreadyInVault}
          >
            <Icon name={alreadyInVault ? 'check' : 'plus'} size={13} />
            {alreadyInVault ? 'Already in your vault' : 'Add to my vault'}
          </button>
          <button
            type="button"
            className="shrink-0 text-[11px] font-medium text-danger hover:underline disabled:opacity-45"
            onClick={onDismiss}
            disabled={dismissing}
          >
            Remove
          </button>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          Shares expire after three days. Add this login to keep it permanently.
        </p>
      </div>
    </div>
  )
}

export function ReceivedSharesDialog({
  open,
  onClose,
  onSeen,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  onSeen?: (ids: string[]) => void
  onAdded?: (entry: Entry) => void
}) {
  const { ensureIdentity, handle, data, mutate } = useVault()
  const [items, setItems] = useState<ReceivedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const onSeenRef = useRef(onSeen)
  useEffect(() => {
    onSeenRef.current = onSeen
  }, [onSeen])

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => {
    if (!open) {
      // Do not retain decrypted share payloads after the inbox closes.
      setItems([])
      setSelectedId(null)
      setError(null)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    setSelectedId(null)
    setItems([])

    void (async () => {
      try {
        const identity = await ensureIdentity()
        if (!handle) throw new Error('Not signed in')
        const result = await listReceivedRecipientSharesFn()
        const opened = await Promise.all(
          result.shares.map(async (share) => {
            try {
              return await decryptReceivedShare(share, identity.privateKey, handle)
            } catch (cause) {
              const expired = cause instanceof Error && cause.message === 'SHARE_EXPIRED'
              return {
                share,
                payload: null,
                expiresAt: expired ? 0 : share.expiresAt,
                error: expired
                  ? 'This share has expired.'
                  : 'This share could not be decrypted for your account. It may have been created for a different identity.',
              } satisfies ReceivedItem
            }
          }),
        )
        if (active) {
          setItems(opened)
          onSeenRef.current?.(opened.map((item) => item.share.id))
        }
      } catch (cause) {
        if (active) setError(friendlyError(cause))
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [open, ensureIdentity, handle, reload])

  async function dismiss(id: string) {
    if (dismissingId) return
    setDismissingId(id)
    setError(null)
    try {
      await dismissReceivedRecipientShareFn({ data: { id } })
      setItems((previous) => previous.filter((item) => item.share.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (cause) {
      setError(friendlyError(cause))
    } finally {
      setDismissingId(null)
    }
  }

  const selected = items.find((item) => item.share.id === selectedId) ?? null
  const activeItems = items.filter((item) => item.expiresAt > now)
  const sharedEntry = useMemo(
    () =>
      selected?.payload
        ? sharedLoginEntry(selected.payload, selected.share.ownerHandle)
        : null,
    [selected?.payload, selected?.share.ownerHandle],
  )
  const selectedAlreadyInVault = useMemo(
    () =>
      sharedEntry
        ? Boolean(
            data?.entries.some(
              (entry) => entryFingerprint(entry) === entryFingerprint(sharedEntry),
            ),
          )
        : false,
    [data?.entries, sharedEntry],
  )

  function addToVault(item: ReceivedItem) {
    if (!item.payload) return
    const entry = sharedLoginEntry(item.payload, item.share.ownerHandle)
    if (
      data?.entries.some(
        (existing) => entryFingerprint(existing) === entryFingerprint(entry),
      )
    ) {
      return
    }
    mutate((current) => upsertEntry(current, entry))
    onAdded?.(entry)
  }

  useEffect(() => {
    if (!selectedId) return
    const item = items.find((candidate) => candidate.share.id === selectedId)
    if (item && item.expiresAt <= now) setSelectedId(null)
  }, [items, now, selectedId])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Shared with me"
      description="Items other Rook accounts have shared with you"
      width="max-w-lg"
    >
      {selected ? (
        <ShareDetail
          item={selected}
          onBack={() => setSelectedId(null)}
          onDismiss={() => void dismiss(selected.share.id)}
          onAdd={() => addToVault(selected)}
          dismissing={dismissingId === selected.share.id}
          alreadyInVault={selectedAlreadyInVault}
        />
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-muted">
          <Spinner size={16} className="text-accent" />
          Opening shared items…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/20 bg-danger-soft px-4 py-4">
          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-danger">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="btn-secondary mt-3 h-8 px-2.5 text-[12px]"
            onClick={() => setReload((previous) => previous + 1)}
          >
            <Icon name="refresh" size={13} /> Try again
          </button>
        </div>
      ) : activeItems.length === 0 ? (
        <div className="py-10 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-line bg-surface-2 text-faint">
            <Icon name="mail" size={22} />
          </span>
          <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-ink">
            Nothing shared with you
          </h3>
          <p className="mx-auto mt-1.5 max-w-[36ch] text-[12px] leading-relaxed text-muted">
            When another Rook account shares a login with your handle, it appears here. Shared
            items are read-only and expire after three days.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {activeItems.map((item) => {
            const title = item.payload?.title ?? 'Unavailable share'
            return (
              <div
                key={item.share.id}
                className="flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-0"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                  onClick={() => setSelectedId(item.share.id)}
                  disabled={!item.payload}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-muted">
                    <Icon name={item.payload ? 'key' : 'alert'} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {title}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-faint">
                      {item.share.ownerHandle} · expires in{' '}
                      {formatShareRemaining(item.expiresAt, now)}
                    </span>
                  </span>
                  {item.payload && (
                    <Icon name="chevron" size={14} className="shrink-0 text-faint" />
                  )}
                </button>
                <button
                  type="button"
                  className="icon-btn size-8 shrink-0 hover:text-danger"
                  aria-label={`Remove ${title} from inbox`}
                  onClick={() => void dismiss(item.share.id)}
                  disabled={dismissingId === item.share.id}
                >
                  {dismissingId === item.share.id ? (
                    <Spinner size={13} />
                  ) : (
                    <Icon name="trash" size={14} />
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {!loading && !error && activeItems.length > 0 && (
        <p className="mt-3 text-center text-[10.5px] leading-relaxed text-faint">
          Shares are decrypted in this tab with your account identity key.
        </p>
      )}
    </Modal>
  )
}
