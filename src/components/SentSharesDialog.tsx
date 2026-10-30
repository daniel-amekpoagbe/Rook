import { useEffect, useMemo, useState } from 'react'
import {
  listAllSentRecipientSharesFn,
  listSentSharesFn,
  revokeRecipientShareFn,
  revokeShareFn,
} from '~/server/api'
import { formatShareRemaining } from '~/lib/share'
import { friendlyError } from '~/lib/vault-context'
import type { Entry } from '~/lib/vault'
import { Icon, Modal, Spinner, cx } from './ui'
import { BrandIcon, brandCssVars, brandForEntry } from './BrandIcon'

interface SentShare {
  id: string
  entryId: string
  label: string
  expiresAt: number
  createdAt: number
  kind: 'link' | 'person'
}

function ShareEntryIcon({ entry }: { entry: Entry | undefined }) {
  if (!entry) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-faint">
        <Icon name="trash" size={14} />
      </span>
    )
  }
  const brand = entry.type === 'login' ? brandForEntry(entry.url, entry.title) : null
  return (
    <span
      className={cx('avatar shrink-0', brand && 'avatar-brand')}
      style={{ ...(brand ? brandCssVars(brand) : { '--hue': 214 }), width: 32, height: 32, fontSize: 12 }}
      aria-hidden="true"
    >
      {brand ? <BrandIcon brand={brand} size={20} /> : entry.title.charAt(0).toUpperCase()}
    </span>
  )
}

export function SentSharesDialog({
  open,
  onClose,
  entries,
  onOpenEntry,
}: {
  open: boolean
  onClose: () => void
  entries: Entry[]
  onOpenEntry: (entry: Entry) => void
}) {
  const [shares, setShares] = useState<SentShare[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([listSentSharesFn(), listAllSentRecipientSharesFn()])
      .then(([links, people]) => {
        if (cancelled) return
        setShares([
          ...links.shares.map((share) => ({
            id: share.id,
            entryId: share.entryId,
            label: 'Read-only link',
            expiresAt: share.expiresAt,
            createdAt: share.createdAt,
            kind: 'link' as const,
          })),
          ...people.shares.map((share) => ({
            id: share.id,
            entryId: share.entryId,
            label: share.recipientHandle,
            expiresAt: share.expiresAt,
            createdAt: share.createdAt,
            kind: 'person' as const,
          })),
        ])
      })
      .catch((caught) => {
        if (!cancelled) setError(friendlyError(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, reload])

  const groups = useMemo(() => {
    const byEntry = new Map<string, SentShare[]>()
    for (const share of shares) {
      const list = byEntry.get(share.entryId) ?? []
      list.push(share)
      byEntry.set(share.entryId, list)
    }
    return [...byEntry.entries()]
  }, [shares])

  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])

  async function revoke(id: string) {
    setRevoking(id)
    setError(null)
    try {
      const share = shares.find((item) => item.id === id)
      if (share?.kind === 'link') await revokeShareFn({ data: { id } })
      else await revokeRecipientShareFn({ data: { id } })
      setShares((prev) => prev.filter((share) => share.id !== id))
    } catch (caught) {
      setError(friendlyError(caught))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Shared by me"
      description={
        loading
          ? 'Loading active shares…'
          : `${shares.length} active ${shares.length === 1 ? 'share' : 'shares'}`
      }
      width="max-w-lg"
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted">
          <Spinner size={18} />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2.5 text-[12px] leading-relaxed text-danger">
          <div className="flex items-start gap-2">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
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
      ) : shares.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-line bg-surface-2 px-4 py-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface text-faint shadow-rest">
            <Icon name="share" size={18} />
          </span>
          <p className="mt-3 text-[13px] font-medium">Nothing shared yet</p>
          <p className="mt-1 max-w-[30ch] text-[11.5px] leading-relaxed text-muted">
            Share a login from its detail view. Active shares appear here until they expire or you revoke them.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(([entryId, entryShares]) => {
            const entry = entryById.get(entryId)
            return (
              <div key={entryId} className="overflow-hidden rounded-xl border border-line">
                <div className="flex items-center gap-2.5 border-b border-line bg-surface-2 px-3 py-2.5">
                  <ShareEntryIcon entry={entry} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">
                      {entry?.title ?? 'Item no longer in this vault'}
                    </p>
                    <p className="text-[10.5px] text-faint">
                      {entryShares.length} {entryShares.length === 1 ? 'share' : 'shares'}
                    </p>
                  </div>
                  {entry && (
                    <button
                      type="button"
                      className="btn-quiet h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => onOpenEntry(entry)}
                    >
                      Open
                      <Icon name="arrowUpRight" size={12} />
                    </button>
                  )}
                </div>
                <div>
                  {entryShares.map((share) => (
                    <div
                      key={share.id}
                      className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] text-ink">{share.label}</p>
                        <p className="text-[10.5px] text-faint">
                          Expires {formatShareRemaining(share.expiresAt).toLowerCase()}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-quiet h-7 shrink-0 px-2 text-[11px] text-danger"
                        onClick={() => void revoke(share.id)}
                        disabled={revoking === share.id}
                      >
                        {revoking === share.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
