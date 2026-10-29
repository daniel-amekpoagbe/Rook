import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useVault, type ConflictChoice } from '~/lib/vault-context'
import { parseTotp } from '~/lib/totp'
import { listReceivedRecipientSharesFn } from '~/server/api'
import {
  hostOf,
  matchesQuery,
  newEntry,
  restoreEntry,
  restoreVersion,
  sortEntries,
  sortTrash,
  touch,
  trashEntry,
  upsertEntry,
  type Entry,
  type EntrySort,
  type EntryType,
} from '~/lib/vault'
import { AuditModal } from './AuditPanel'
import { AuthenticatorModal } from './AuthenticatorModal'
import { EntryForm, GeneratorModal, TYPE_META, newDraft } from './EntryEditor'
import { ReceivedSharesDialog } from './ReceivedSharesDialog'
import { SentSharesDialog } from './SentSharesDialog'
import { SettingsModal } from './SettingsPanel'
import { ShareDialog } from './ShareDialog'
import { TotpBlock } from './TotpCode'
import { Icon, Modal, ThemeToggle, cx, timeAgo, useCopyToClipboard } from './ui'
import { RookMark } from './RookMark'
import { BrandIcon, brandCssVars, brandForEntry } from './BrandIcon'

const AVATAR_HUES = [214, 262, 168, 32, 342, 190, 12, 285]

function avatarHue(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 1000
  return AVATAR_HUES[hash % AVATAR_HUES.length]!
}

function EntryAvatar({ entry, size = 36 }: { entry: Entry; size?: number }) {
  const brand = entry.type === 'login' ? brandForEntry(entry.url, entry.title) : null
  const seed = hostOf(entry.url) ?? entry.title
  const hue = avatarHue(seed)
  const initial = entry.title.trim().charAt(0).toUpperCase()
  const iconSize = size >= 48 ? 30 : size >= 40 ? 26 : 22
  return (
    <span
      className={cx('avatar shrink-0', brand && 'avatar-brand')}
      style={{
        ...(brand ? brandCssVars(brand) : { '--hue': hue }),
        width: size,
        height: size,
        fontSize: size >= 44 ? 16 : 13,
      } as CSSProperties}
      aria-hidden="true"
    >
      {brand ? (
        <BrandIcon brand={brand} size={iconSize} />
      ) : (
        initial || <Icon name={TYPE_META[entry.type].icon} size={size >= 44 ? 19 : 16} />
      )}
    </span>
  )
}

function entrySubtitle(entry: Entry): { text: string; mono: boolean } {
  const host = hostOf(entry.url)
  if (host) return { text: host, mono: true }
  if (entry.type === 'login') return { text: entry.username ?? 'Login', mono: false }
  if (entry.type === 'card') return { text: entry.card?.holder ?? 'Card', mono: false }
  if (entry.type === 'identity') return { text: entry.identity?.fullName ?? entry.identity?.email ?? 'Identity', mono: false }
  return { text: entry.tags[0] ?? 'Secure note', mono: false }
}

function FieldRow({
  label,
  value,
  mono,
  secret,
  href,
}: {
  label: string
  value: string
  mono?: boolean
  secret?: boolean
  href?: string
}) {
  const [revealed, setRevealed] = useState(false)
  const { copied, copy } = useCopyToClipboard()

  return (
    <div className="group flex items-start justify-between gap-4 border-b border-line px-4 py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-medium text-muted">{label}</div>
        <div
          className={cx(
            'mt-0.5 break-all text-[13.5px] text-ink',
            mono && 'font-mono text-[12.5px] tracking-wide',
            secret && !revealed && 'tracking-[0.22em] select-none',
          )}
        >
          {secret && !revealed ? '••••••••••••' : href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-ink hover:text-accent"
            >
              {value}
              <Icon name="arrowUpRight" size={12} className="text-faint" />
            </a>
          ) : (
            value
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pt-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {secret && (
          <button
            type="button"
            className="icon-btn size-7"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          >
            <Icon name={revealed ? 'eyeOff' : 'eye'} size={14} />
          </button>
        )}
        <button
          type="button"
          className="icon-btn size-7"
          onClick={() => copy(value)}
          aria-label={`Copy ${label}`}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} className={copied ? 'text-success' : undefined} />
        </button>
      </div>
    </div>
  )
}

function EntryDetail({
  entry,
  history,
  onEdit,
  onDelete,
  onToggleFavorite,
  onBack,
  onRestoreVersion,
  onShare,
  trashed = false,
  onRestore,
  onDeleteForever,
}: {
  entry: Entry
  history: Entry[]
  onEdit: () => void
  onDelete: () => void
  onToggleFavorite: () => void
  onBack: () => void
  onRestoreVersion: (updatedAt: string) => void
  onShare?: () => void
  trashed?: boolean
  onRestore?: () => void
  onDeleteForever?: () => void
}) {
  const { copy, copied } = useCopyToClipboard()
  const host = hostOf(entry.url)
  const meta = TYPE_META[entry.type]

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" className="icon-btn md:hidden" onClick={onBack} aria-label="Back to list">
            <Icon name="arrowLeft" size={17} />
          </button>
          <span className="chip">{trashed ? 'Trash' : meta.label}</span>
          <span className="hidden text-[11.5px] text-faint sm:inline">
            {trashed
              ? `Deleted ${timeAgo(new Date(entry.deletedAt ?? entry.updatedAt).getTime())}`
              : `Updated ${timeAgo(new Date(entry.updatedAt).getTime())}`}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {trashed ? (
            <>
              {onRestore && (
                <button
                  type="button"
                  className="btn-secondary h-9 px-2.5 text-[12px] sm:h-8"
                  onClick={onRestore}
                >
                  <Icon name="undo" size={13} /> Restore
                </button>
              )}
              {onDeleteForever && (
                <button
                  type="button"
                  className="icon-btn hover:text-danger"
                  onClick={onDeleteForever}
                  aria-label="Delete permanently"
                >
                  <Icon name="trash" size={15} />
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className={cx('icon-btn', entry.favorite && 'text-warn')}
                onClick={onToggleFavorite}
                aria-label="Toggle favorite"
                aria-pressed={entry.favorite}
              >
                <Icon name="star" size={16} filled={entry.favorite} />
              </button>
              <button type="button" className="btn-secondary h-9 px-2.5 text-[12px] sm:h-8" onClick={onEdit}>
                <Icon name="edit" size={13} /> Edit
              </button>
              <button
                type="button"
                className="icon-btn hover:text-danger"
                onClick={onDelete}
                aria-label="Delete item"
              >
                <Icon name="trash" size={15} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[660px] px-4 py-6 sm:px-6">
          {trashed && (
            <div className="mb-5 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
              This item is in the trash. Restore it to edit it or return it to your vault.
            </div>
          )}
          <div className="flex items-start gap-4">
            <EntryAvatar entry={entry} size={48} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[24px] leading-tight font-semibold tracking-[-0.025em]">{entry.title}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                {host ? (
                  <a
                    href={entry.url?.includes('://') ? entry.url : `https://${entry.url}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 font-mono hover:text-accent"
                  >
                    <Icon name="globe" size={12} />
                    {host}
                  </a>
                ) : (
                  <span>{meta.label}</span>
                )}
                {entry.username && <span className="max-w-[28ch] truncate">{entry.username}</span>}
                {entry.type === 'login' && entry.password && (
                  <span className="chip normal-case tracking-normal">
                    {entry.twoFactor === 'on' || (entry.totp && parseTotp(entry.totp))
                      ? '2FA on'
                      : entry.twoFactor === 'unavailable'
                        ? 'No 2FA offered'
                        : '2FA off'}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {entry.type === 'login' && entry.password && (
              <button type="button" className="btn-primary" onClick={() => copy(entry.password!, 'password')}>
                <Icon name={copied === 'password' ? 'check' : 'copy'} size={14} />
                {copied === 'password' ? 'Copied' : 'Copy password'}
              </button>
            )}
            {!trashed && entry.type === 'login' && entry.password && onShare && (
              <button type="button" className="btn-secondary" onClick={onShare}>
                <Icon name="mail" size={14} /> Share
              </button>
            )}
            {entry.url && (
              <a
                className="btn-secondary"
                href={entry.url.includes('://') ? entry.url : `https://${entry.url}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="globe" size={14} /> Open website
                <Icon name="arrowUpRight" size={12} className="text-faint" />
              </a>
            )}
            {entry.type === 'login' && entry.username && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => copy(entry.username!, 'username')}
              >
                <Icon name={copied === 'username' ? 'check' : 'copy'} size={14} />
                {copied === 'username' ? 'Copied' : 'Copy username'}
              </button>
            )}
          </div>

          <div className="mt-6">
            {entry.type === 'login' && (
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {entry.username && <FieldRow label="Username" value={entry.username} />}
                {entry.password && <FieldRow label="Password" value={entry.password} mono secret />}
                {entry.url && <FieldRow label="Website" value={entry.url} mono href={entry.url.includes('://') ? entry.url : `https://${entry.url}`} />}
              </div>
            )}

            {entry.type === 'card' && entry.card && (
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {entry.card.number && <FieldRow label="Number" value={entry.card.number} mono secret />}
                {entry.card.holder && <FieldRow label="Cardholder" value={entry.card.holder} />}
                {entry.card.expiry && <FieldRow label="Expiry" value={entry.card.expiry} mono />}
                {entry.card.cvv && <FieldRow label="CVV" value={entry.card.cvv} mono secret />}
                {entry.card.pin && <FieldRow label="PIN" value={entry.card.pin} mono secret />}
              </div>
            )}

            {entry.type === 'identity' && entry.identity && (
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {entry.identity.fullName && <FieldRow label="Full name" value={entry.identity.fullName} />}
                {entry.identity.email && <FieldRow label="Email" value={entry.identity.email} />}
                {entry.identity.phone && <FieldRow label="Phone" value={entry.identity.phone} />}
                {entry.identity.address && <FieldRow label="Address" value={entry.identity.address} />}
              </div>
            )}

            {entry.totp && (
              <div className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
                <TotpBlock secret={entry.totp} />
              </div>
            )}

            {entry.notes && (
              <div className="mt-6">
                <h3 className="text-[11.5px] font-medium text-muted">Notes</h3>
                <p className="mt-1.5 max-w-[68ch] text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">{entry.notes}</p>
              </div>
            )}

            {entry.tags.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <span key={tag} className="chip normal-case tracking-normal">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {!trashed && history.length > 0 && (
              <div className="mt-6">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[11.5px] font-medium text-muted">History</h3>
                  <span className="text-[11px] text-faint">
                    {history.length} previous {history.length === 1 ? 'version' : 'versions'}
                  </span>
                </div>
                <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
                  {history.map((version, index) => (
                    <div
                      key={`${version.updatedAt}-${index}`}
                      className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-ink">
                          Saved {timeAgo(new Date(version.updatedAt).getTime())}
                        </div>
                        <div className="mt-0.5 truncate text-[11.5px] text-muted">
                          {version.title}
                          {version.username ? ` · ${version.username}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn-secondary h-8 shrink-0 px-2.5 text-[12px]"
                        onClick={() => onRestoreVersion(version.updatedAt)}
                      >
                        <Icon name="undo" size={13} /> Restore
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                  Previous versions stay encrypted with the vault. Restoring one keeps the current version in history.
                </p>
              </div>
            )}

            <div className="mt-8 border-t border-line pt-3 text-[11px] text-faint">
              Created {timeAgo(new Date(entry.createdAt).getTime())} · Updated{' '}
              {timeAgo(new Date(entry.updatedAt).getTime())}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const FILTERS = [
  { value: 'all', label: 'All items', icon: 'grid' },
  { value: 'favorites', label: 'Favorites', icon: 'star' },
  { value: 'login', label: 'Logins', icon: 'key' },
  { value: 'card', label: 'Cards', icon: 'card' },
  { value: 'note', label: 'Notes', icon: 'note' },
  { value: 'identity', label: 'Identities', icon: 'user' },
  { value: 'trash', label: 'Trash', icon: 'trash' },
] as const

type Filter = (typeof FILTERS)[number]['value']

function NavGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-4 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">{children}</p>
  )
}

export function VaultApp() {
  const {
    data,
    handle,
    mutate,
    lock,
    sync,
    error,
    conflict,
    resolveConflict,
    lastSyncedAt,
    clearError,
    deleteEntryPermanently,
    retrySave,
  } = useVault()
  const [resolving, setResolving] = useState<ConflictChoice | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<EntrySort>('title')
  const [tagFilter, setTagFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [editGeneratorOpen, setEditGeneratorOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [authenticatorOpen, setAuthenticatorOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Entry | null>(null)
  const [deleteForeverTarget, setDeleteForeverTarget] = useState<Entry | null>(null)
  const [shareTarget, setShareTarget] = useState<Entry | null>(null)
  const [receivedOpen, setReceivedOpen] = useState(false)
  const [sentOpen, setSentOpen] = useState(false)
  const [receivedIds, setReceivedIds] = useState<string[]>([])
  const [receivedUnread, setReceivedUnread] = useState(0)
  const [receivedNoticeDismissed, setReceivedNoticeDismissed] = useState(false)
  const [trashSelection, setTrashSelection] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'delete' | 'empty' | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        lock()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lock])

  const entries = data?.entries ?? []
  const trash = data?.trash ?? []

  const tagOptions = useMemo(() => {
    const source =
      filter === 'trash'
        ? trash
        : filter === 'favorites'
          ? entries.filter((entry) => entry.favorite)
          : filter === 'all'
            ? entries
            : entries.filter((entry) => entry.type === filter)
    return [...new Set(source.flatMap((entry) => entry.tags))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
  }, [entries, trash, filter])

  useEffect(() => {
    if (tagFilter !== 'all' && !tagOptions.includes(tagFilter)) setTagFilter('all')
  }, [tagFilter, tagOptions])

  useEffect(() => {
    setTrashSelection((prev) => {
      if (prev.size === 0) return prev
      const valid = new Set(trash.map((entry) => entry.id))
      const next = new Set([...prev].filter((id) => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [trash])

  useEffect(() => {
    if (filter !== 'trash') setTrashSelection(new Set())
  }, [filter])

  useEffect(() => {
    if (!handle) return
    let cancelled = false

    async function refreshReceived() {
      try {
        const result = await listReceivedRecipientSharesFn()
        if (cancelled) return
        const active = result.shares.filter((share) => share.expiresAt > Date.now())
        setReceivedIds(active.map((share) => share.id))
        let seen: string[] = []
        try {
          seen = JSON.parse(localStorage.getItem(`rook.seenShares.${handle}`) ?? '[]') as string[]
        } catch {
          seen = []
        }
        const seenSet = new Set(seen)
        setReceivedUnread(active.filter((share) => !seenSet.has(share.id)).length)
      } catch {
        // Sharing is additive; a transient failure must not interrupt the vault.
      }
    }

    void refreshReceived()
    const timer = window.setInterval(refreshReceived, 60_000)
    const onFocus = () => void refreshReceived()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [handle])

  useEffect(() => {
    // A newly received share should surface its notification again, even if
    // the previous one was dismissed.
    if (receivedUnread > 0) setReceivedNoticeDismissed(false)
  }, [receivedUnread])

  const visible = useMemo(() => {
    const source = filter === 'trash' ? trash : entries
    const filtered = source.filter((entry) => {
      if (filter === 'favorites' && !entry.favorite) return false
      if (
        filter !== 'all' &&
        filter !== 'favorites' &&
        filter !== 'trash' &&
        entry.type !== filter
      ) {
        return false
      }
      if (filter !== 'trash' && tagFilter !== 'all' && !entry.tags.includes(tagFilter)) {
        return false
      }
      return matchesQuery(entry, query)
    })
    return filter === 'trash' ? sortTrash(filtered) : sortEntries(filtered, sort)
  }, [entries, trash, filter, query, sort, tagFilter])

  const groupFavorites = filter !== 'trash' && filter !== 'favorites'
  const favoriteVisible = groupFavorites ? visible.filter((entry) => entry.favorite) : []
  const otherVisible = groupFavorites ? visible.filter((entry) => !entry.favorite) : visible
  const listGroups =
    favoriteVisible.length > 0
      ? [
          { label: 'Favorites', items: favoriteVisible },
          ...(otherVisible.length > 0 ? [{ label: 'Other items', items: otherVisible }] : []),
        ]
      : [{ label: null, items: visible }]

  const counts = useMemo(() => {
    const byType = (type: EntryType) => entries.filter((entry) => entry.type === type).length
    return {
      all: entries.length,
      favorites: entries.filter((entry) => entry.favorite).length,
      login: byType('login'),
      card: byType('card'),
      note: byType('note'),
      identity: byType('identity'),
      trash: trash.length,
    } as Record<string, number>
  }, [entries, trash])

  const authenticatorCount = useMemo(
    () =>
      entries.filter(
        (entry) => entry.type === 'login' && Boolean(entry.totp && parseTotp(entry.totp)),
      ).length,
    [entries],
  )

  const selected = (filter === 'trash' ? trash : entries).find((entry) => entry.id === selectedId) ?? null
  const history = selected && filter !== 'trash' ? (data?.history[selected.id] ?? []) : []
  const activeFilter = FILTERS.find((item) => item.value === filter) ?? FILTERS[0]

  function saveEntry(entry: Entry, record = true) {
    mutate((current) => upsertEntry(current, entry, record))
  }

  function moveToTrash(id: string) {
    mutate((current) => trashEntry(current, id))
    if (selectedId === id) setSelectedId(null)
  }

  function restore(id: string) {
    mutate((current) => restoreEntry(current, id))
    setFilter('all')
    setQuery('')
    setSelectedId(id)
  }

  function restoreHistory(entryId: string, updatedAt: string) {
    mutate((current) => restoreVersion(current, entryId, updatedAt))
  }

  async function deleteForever(id: string) {
    if (selectedId === id) setSelectedId(null)
    setDeleteForeverTarget(null)
    try {
      await deleteEntryPermanently(id)
    } catch {
      // The vault context surfaces save/conflict errors in the main banner.
    }
  }

  function toggleFavorite(entry: Entry) {
    saveEntry(touch({ ...entry, favorite: !entry.favorite }), false)
  }

  async function resolveVaultConflict(choice: ConflictChoice) {
    setResolving(choice)
    try {
      await resolveConflict(choice)
    } finally {
      setResolving(null)
    }
  }

  function startCreate(type: EntryType) {
    setNewMenuOpen(false)
    setRailOpen(false)
    setEditGeneratorOpen(false)
    setEditing(newDraft(type))
  }

  function openEntry(entry: Entry) {
    setFilter('all')
    setQuery('')
    setTagFilter('all')
    setSelectedId(entry.id)
    setEditing(null)
    setEditGeneratorOpen(false)
    setRailOpen(false)
  }

  function generateForEntry(entry: Entry) {
    setAuditOpen(false)
    setFilter('all')
    setQuery('')
    setTagFilter('all')
    setSelectedId(entry.id)
    setEditGeneratorOpen(true)
    setEditing(entry)
  }

  function setAuditIgnored(entry: Entry, ignored: boolean) {
    saveEntry({ ...entry, auditIgnored: ignored }, false)
  }

  function markReceivedSeen(ids: string[] = receivedIds) {
    if (!handle) return
    let seen: string[] = []
    try {
      seen = JSON.parse(localStorage.getItem(`rook.seenShares.${handle}`) ?? '[]') as string[]
    } catch {
      seen = []
    }
    const active = new Set([...receivedIds, ...ids])
    const merged = [...new Set([...seen, ...ids])]
    // Prune shares that are no longer active so the local marker cannot grow
    // forever. Keep the list untouched until at least one share is known.
    const next = active.size > 0 ? merged.filter((id) => active.has(id)) : merged
    try {
      localStorage.setItem(`rook.seenShares.${handle}`, JSON.stringify(next))
    } catch {
      // A private-mode storage failure should not block the share inbox.
    }
    setReceivedUnread(0)
  }

  function openReceivedShares() {
    // The inbox marks shares as seen only after they load, so a transient
    // network failure does not clear the unread badge.
    setReceivedOpen(true)
    setRailOpen(false)
  }

  const selectedTrash = trash.filter((entry) => trashSelection.has(entry.id))
  const allVisibleSelected = visible.length > 0 && visible.every((entry) => trashSelection.has(entry.id))

  function toggleTrashSelection(id: string) {
    setTrashSelection((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllVisible() {
    setTrashSelection((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const entry of visible) next.delete(entry.id)
        return next
      }
      return new Set([...prev, ...visible.map((entry) => entry.id)])
    })
  }

  function restoreSelected() {
    if (selectedTrash.length === 0) return
    mutate((current) => selectedTrash.reduce((next, entry) => restoreEntry(next, entry.id), current))
    setFilter('all')
    setQuery('')
    setTagFilter('all')
    setSelectedId(selectedTrash[0]?.id ?? null)
    setTrashSelection(new Set())
  }

  async function deleteSelectedForever() {
    if (selectedTrash.length === 0) return
    setBulkBusy(true)
    try {
      for (const entry of selectedTrash) {
        await deleteEntryPermanently(entry.id)
      }
      setSelectedId(null)
      setTrashSelection(new Set())
    } catch {
      // The vault context surfaces save/conflict errors in the main banner.
    } finally {
      setBulkBusy(false)
      setBulkAction(null)
    }
  }

  async function emptyTrash() {
    if (trash.length === 0) return
    setBulkBusy(true)
    try {
      for (const entry of trash) {
        await deleteEntryPermanently(entry.id)
      }
      setSelectedId(null)
      setTrashSelection(new Set())
    } catch {
      // The vault context surfaces save/conflict errors in the main banner.
    } finally {
      setBulkBusy(false)
      setBulkAction(null)
    }
  }

  const emptyState = query
    ? {
        title: 'No matches',
        body: 'Try a different word, or clear the search to see everything.',
        icon: 'search',
        cta: 'Clear search',
        onCta: () => setQuery(''),
      }
    : filter === 'trash'
      ? {
          title: 'Trash is empty',
          body: 'Items you delete stay here until you remove them permanently.',
          icon: 'trash',
          cta: 'Browse all items',
          onCta: () => setFilter('all'),
        }
      : entries.length === 0
      ? {
          title: 'Nothing here yet',
          body: 'Add a login, note, card, or identity. Everything is encrypted before it is saved.',
          icon: 'archive',
          cta: 'Add your first login',
          onCta: () => startCreate('login'),
        }
      : filter === 'favorites'
        ? {
            title: 'No favorites yet',
            body: 'Star an item to keep it at the top of the list.',
            icon: 'star',
            cta: 'Browse all items',
            onCta: () => setFilter('all'),
          }
        : filter === 'all'
          ? {
              title: 'Nothing to show',
              body: 'Clear the search to see everything in the vault.',
              icon: 'search',
              cta: 'Clear search',
              onCta: () => setQuery(''),
            }
          : (() => {
              const type = filter
              const singular = TYPE_META[type].label.toLowerCase()
              const article = singular === 'identity' ? 'an' : 'a'
              const plural = { login: 'logins', note: 'notes', card: 'cards', identity: 'identities' }[type]
              return {
                title: `No ${plural} yet`,
                body: `Add ${article} ${singular} to fill this view.`,
                icon: TYPE_META[type].icon,
                cta: `Add ${article} ${singular}`,
                onCta: () => startCreate(type),
              }
            })()

  const formOpen = Boolean(editing)
  const detailOpen = Boolean(selected) || formOpen

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      {railOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setRailOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col border-r border-line bg-surface-2 transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-[244px] lg:translate-x-0',
          railOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between px-3">
          <div className="flex items-center gap-2.5 pl-1">
            <span className="flex size-8 items-center justify-center rounded-[10px] border border-line bg-white text-[#0a0b0e] shadow-rest">
              <RookMark className="size-[18px]" />
            </span>
            <span className="text-[14px] font-semibold tracking-[-0.02em]">Rook</span>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <button
              type="button"
              className="icon-btn lg:hidden"
              onClick={() => setRailOpen(false)}
              aria-label="Close navigation"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <NavGroupLabel>Vault</NavGroupLabel>
          <div className="space-y-0.5">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setFilter(item.value)
                  setRailOpen(false)
                }}
                className={cx('nav-item', filter === item.value && 'nav-item-active')}
                aria-current={filter === item.value ? 'page' : undefined}
                aria-label={`${item.label}, ${counts[item.value]} ${counts[item.value] === 1 ? 'item' : 'items'}`}
              >
                <Icon
                  name={item.icon}
                  size={16}
                  className={filter === item.value ? 'text-accent' : 'text-faint'}
                  filled={item.value === 'favorites' && filter === 'favorites'}
                />
                <span className="flex-1 text-left">{item.label}</span>
                <span className="font-mono text-[10.5px] text-faint tabular-nums">{counts[item.value]}</span>
              </button>
            ))}
          </div>

          <NavGroupLabel>Tools</NavGroupLabel>
          <div className="space-y-0.5">
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                setAuthenticatorOpen(true)
                setRailOpen(false)
              }}
              aria-label={`Authenticator, ${authenticatorCount} ${authenticatorCount === 1 ? 'code' : 'codes'}`}
            >
              <Icon name="authenticator" size={16} className="text-faint" />
              <span className="flex-1 text-left">Authenticator</span>
              {authenticatorCount > 0 && (
                <span className="font-mono text-[10.5px] text-faint tabular-nums">
                  {authenticatorCount}
                </span>
              )}
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={openReceivedShares}
              aria-label={`Shared with me${receivedUnread > 0 ? `, ${receivedUnread} unread` : ''}`}
            >
              <Icon name="mail" size={16} className="text-faint" />
              <span className="flex-1 text-left">Shared with me</span>
              {receivedUnread > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-on-accent tabular-nums">
                  {receivedUnread}
                </span>
              )}
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                setSentOpen(true)
                setRailOpen(false)
              }}
            >
              <Icon name="share" size={16} className="text-faint" />
              <span className="flex-1 text-left">Shared by me</span>
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                setAuditOpen(true)
                setRailOpen(false)
              }}
            >
              <Icon name="shield" size={16} className="text-faint" />
              <span className="flex-1 text-left">Security audit</span>
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                setGeneratorOpen(true)
                setRailOpen(false)
              }}
            >
              <Icon name="generator" size={16} className="text-faint" />
              <span className="flex-1 text-left">Generator</span>
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                setSettingsOpen(true)
                setRailOpen(false)
              }}
            >
              <Icon name="settings" size={16} className="text-faint" />
              <span className="flex-1 text-left">Settings</span>
            </button>
          </div>
        </nav>

        <div className="border-t border-line p-2">
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-semibold text-muted uppercase">
              {handle?.charAt(0) ?? 'K'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-ink">{handle}</p>
              <p className="text-[10.5px] text-faint">Synced to server</p>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={lock}
              title="Lock vault (⌘L)"
              aria-label="Lock vault"
            >
              <Icon name="lock" size={15} />
            </button>
          </div>
        </div>
      </aside>

      <section
        className={cx(
          'flex min-w-0 flex-col border-r border-line bg-surface',
          'w-full md:w-[336px] md:shrink-0',
          detailOpen ? 'hidden md:flex' : 'flex',
        )}
        aria-label="Item list"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
          <button
            type="button"
            className="icon-btn lg:hidden"
            onClick={() => setRailOpen(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em]">{activeFilter.label}</h1>
            <p className="text-[10.5px] text-faint">
              {visible.length} {visible.length === 1 ? 'item' : 'items'}
            </p>
          </div>
          {filter !== 'trash' && (
            <div className="relative">
              <button
                type="button"
                className="btn-primary h-9 px-2.5 text-[12px] sm:h-8"
                onClick={() => setNewMenuOpen((prev) => !prev)}
                aria-label="New item"
                aria-haspopup="menu"
                aria-expanded={newMenuOpen}
              >
                <Icon name="plus" size={15} />
                <span className="hidden sm:inline">New item</span>
              </button>
              {newMenuOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-30 cursor-default"
                    aria-label="Close menu"
                    onClick={() => setNewMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    aria-label="New item"
                    className="absolute top-10 right-0 z-40 w-44 rounded-lg border border-line bg-surface p-1.5 shadow-float rise"
                  >
                    {(Object.keys(TYPE_META) as EntryType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        role="menuitem"
                        onClick={() => startCreate(type)}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-ink hover:bg-surface-3"
                      >
                        <Icon name={TYPE_META[type].icon} size={14} className="text-faint" />
                        {TYPE_META[type].label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="px-3 pt-3 pb-2">
          <div className="relative">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="field h-8 pl-8 text-[12.5px]"
              placeholder={filter === 'trash' ? 'Search trash' : 'Search vault'}
              aria-label="Search vault"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
                className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-faint hover:bg-surface-3 hover:text-ink"
                aria-label="Clear search"
              >
                <Icon name="close" size={13} />
              </button>
            ) : (
              <span className="kbd pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline-flex">⌘K</span>
            )}
          </div>

          {filter === 'trash' ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <label className="mr-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  disabled={visible.length === 0}
                  className="size-3.5 accent-[var(--primary)]"
                />
                Select all
              </label>
              {selectedTrash.length > 0 && (
                <span className="text-[10.5px] text-faint">{selectedTrash.length} selected</span>
              )}
              <button
                type="button"
                className="btn-secondary h-7 px-2 text-[11px]"
                onClick={restoreSelected}
                disabled={selectedTrash.length === 0 || bulkBusy}
              >
                <Icon name="undo" size={12} /> Restore selected
              </button>
              <button
                type="button"
                className="btn-quiet h-7 px-2 text-[11px] text-danger"
                onClick={() => setBulkAction('delete')}
                disabled={selectedTrash.length === 0 || bulkBusy}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn-quiet h-7 px-2 text-[11px] text-danger"
                onClick={() => setBulkAction('empty')}
                disabled={trash.length === 0 || bulkBusy}
              >
                Empty trash
              </button>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5">
              <label className="sr-only" htmlFor="entry-sort">
                Sort items
              </label>
              <select
                id="entry-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as EntrySort)}
                className="field h-7 min-w-0 flex-1 px-2 text-[11.5px]"
              >
                <option value="title">Title A–Z</option>
                <option value="updated">Recently updated</option>
                <option value="created">Recently added</option>
              </select>
              <label className="sr-only" htmlFor="entry-tag">
                Filter by tag
              </label>
              <select
                id="entry-tag"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                className="field h-7 min-w-0 flex-1 px-2 text-[11.5px]"
              >
                <option value="all">All tags</option>
                {tagOptions.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visible.length === 0 && (
            <div className="flex flex-col items-center px-4 py-12 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-faint">
                <Icon name={emptyState.icon} size={18} />
              </span>
              <p className="mt-3 text-[13px] font-medium text-ink">{emptyState.title}</p>
              <p className="mt-1 max-w-[26ch] text-[11.5px] leading-relaxed text-muted">{emptyState.body}</p>
              <button type="button" className="btn-secondary mt-3 h-8 text-[12px]" onClick={emptyState.onCta}>
                {emptyState.cta.startsWith('Add') && <Icon name="plus" size={14} />}
                {emptyState.cta}
              </button>
            </div>
          )}

          {listGroups.map((group) => (
            <div key={group.label ?? 'items'}>
              {group.label && (
                <p className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.08em] text-faint uppercase">
                  {group.label}
                </p>
              )}
              {group.items.map((entry) => {
                const subtitle =
                  filter === 'trash'
                    ? {
                        text: `Deleted ${timeAgo(new Date(entry.deletedAt ?? entry.updatedAt).getTime())}`,
                        mono: false,
                      }
                    : entrySubtitle(entry)
                return (
                  <div
                    key={entry.id}
                    className={cx(
                      'group mb-0.5 flex w-full items-center gap-1 rounded-lg transition-colors duration-100',
                      selectedId === entry.id && !formOpen ? 'bg-accent-soft' : 'hover:bg-surface-3',
                    )}
                  >
                    {filter === 'trash' && (
                      <input
                        type="checkbox"
                        checked={trashSelection.has(entry.id)}
                        onChange={() => toggleTrashSelection(entry.id)}
                        aria-label={`Select ${entry.title}`}
                        className="ml-2 size-3.5 shrink-0 accent-[var(--primary)]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(entry.id)
                        setEditing(null)
                        setRailOpen(false)
                      }}
                      className={cx(
                        'flex min-w-0 flex-1 items-center gap-3 py-2 text-left',
                        filter === 'trash' ? 'pr-2' : 'px-2',
                      )}
                    >
                      <EntryAvatar entry={entry} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-ink">{entry.title}</span>
                          {entry.favorite && <Icon name="star" size={10} className="shrink-0 text-warn" filled />}
                        </span>
                        <span
                          className={cx(
                            'mt-0.5 block truncate text-[11.5px] text-muted',
                            subtitle.mono && 'font-mono',
                          )}
                        >
                          {subtitle.text}
                        </span>
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex h-9 shrink-0 items-center justify-between border-t border-line px-3 text-[10.5px] text-faint">
          <span data-sync={sync} role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
            <span
              className={cx(
                'size-1.5 rounded-full',
                sync === 'saved'
                  ? 'bg-success'
                  : sync === 'saving'
                    ? 'bg-warn pulse-soft'
                    : sync === 'conflict' || sync === 'error'
                      ? 'bg-danger'
                      : 'bg-faint',
              )}
            />
            {sync === 'saving'
              ? 'Saving…'
              : sync === 'conflict'
                ? 'Conflict'
                : sync === 'error'
                  ? 'Not saved'
                  : `Saved ${timeAgo(lastSyncedAt)}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon name="lock" size={10} /> Encrypted
          </span>
        </div>
      </section>

      <main className={cx('flex min-w-0 flex-1 flex-col bg-surface', detailOpen ? 'flex' : 'hidden md:flex')}>
        {error && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-danger/20 bg-danger-soft px-4 py-2 text-[12px] text-danger">
            <span className="flex min-w-0 items-center gap-2">
              <Icon name="alert" size={14} className="shrink-0" />
              <span className="truncate">{error}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {sync === 'error' && (
                <button type="button" className="btn-secondary h-7 px-2 text-[11px]" onClick={retrySave}>
                  <Icon name="refresh" size={12} /> Retry
                </button>
              )}
              <button type="button" onClick={clearError} aria-label="Dismiss" className="icon-btn size-7">
                <Icon name="close" size={14} />
              </button>
            </span>
          </div>
        )}

        {formOpen && editing ? (
          <EntryForm
            entry={editing}
            initialGeneratorOpen={editGeneratorOpen}
            onCancel={() => {
              setEditGeneratorOpen(false)
              setEditing(null)
            }}
            onSave={(entry) => {
              const saved = entry.id ? entry : { ...entry, id: crypto.randomUUID() }
              saveEntry(saved)
              setSelectedId(saved.id)
              setEditGeneratorOpen(false)
              setEditing(null)
            }}
          />
        ) : selected ? (
          <EntryDetail
            entry={selected}
            history={history}
            onEdit={() => {
              setEditGeneratorOpen(false)
              setEditing(selected)
            }}
            onDelete={() => setDeleteTarget(selected)}
            onToggleFavorite={() => toggleFavorite(selected)}
            onBack={() => setSelectedId(null)}
            onRestoreVersion={(updatedAt) => restoreHistory(selected.id, updatedAt)}
            onShare={() => setShareTarget(selected)}
            trashed={filter === 'trash'}
            onRestore={filter === 'trash' ? () => restore(selected.id) : undefined}
            onDeleteForever={
              filter === 'trash' ? () => setDeleteForeverTarget(selected) : undefined
            }
          />
        ) : filter === 'trash' ? (
          <div className="flex h-full items-center justify-center overflow-y-auto px-5 py-10">
            <div className="w-full max-w-[420px] text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-line bg-surface-2 text-faint">
                <Icon name="trash" size={24} />
              </span>
              <h2 className="mt-5 text-[18px] font-semibold tracking-[-0.015em]">
                {trash.length === 0 ? 'Trash is empty' : 'Select an item'}
              </h2>
              <p className="mx-auto mt-1.5 max-w-[38ch] text-[13px] leading-relaxed text-muted">
                {trash.length === 0
                  ? 'Items you delete stay here until you remove them permanently.'
                  : 'Choose something from the trash to restore it or delete it permanently.'}
              </p>
              {trash.length === 0 && (
                <button type="button" className="btn-secondary mt-5" onClick={() => setFilter('all')}>
                  Browse all items
                </button>
              )}
            </div>
          </div>
        ) : entries.length > 0 && visible.length === 0 ? (
          <div className="flex h-full items-center justify-center overflow-y-auto px-5 py-10">
            <div className="w-full max-w-[420px] text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-line bg-surface-2 text-faint">
                <Icon name={emptyState.icon} size={24} />
              </span>
              <h2 className="mt-5 text-[18px] font-semibold tracking-[-0.015em]">{emptyState.title}</h2>
              <p className="mx-auto mt-1.5 max-w-[38ch] text-[13px] leading-relaxed text-muted">{emptyState.body}</p>
              <button type="button" className="btn-secondary mt-5" onClick={emptyState.onCta}>
                {emptyState.cta.startsWith('Add') && <Icon name="plus" size={14} />}
                {emptyState.cta}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center overflow-y-auto px-5 py-10">
            <div className="w-full max-w-[460px] text-center">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-line bg-surface-2 text-accent shadow-rest">
                <Icon name="archive" size={24} />
              </span>
              <h2 className="mt-5 text-[18px] font-semibold tracking-[-0.015em]">
                {entries.length === 0 ? 'Your vault is unlocked' : 'Select an item'}
              </h2>
              <p className="mx-auto mt-1.5 max-w-[42ch] text-[13px] leading-relaxed text-muted">
                {entries.length === 0
                  ? 'Nothing is stored yet. Everything you add is encrypted in this tab before it is saved.'
                  : 'Choose something from the list, or start a new item. Search stays one keystroke away.'}
              </p>

              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(TYPE_META) as EntryType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => startCreate(type)}
                    className="group flex h-[78px] flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[12px] font-medium text-muted shadow-rest transition-colors duration-100 hover:border-accent/40 hover:bg-accent-soft hover:text-ink"
                  >
                    <Icon name={TYPE_META[type].icon} size={17} className="text-faint group-hover:text-accent" />
                    {TYPE_META[type].label}
                  </button>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11.5px] text-faint">
                <span>
                  <span className="kbd">⌘K</span> search
                </span>
                <span>
                  <span className="kbd">⌘L</span> lock
                </span>
                <button
                  type="button"
                  className="underline-offset-2 hover:text-ink hover:underline"
                  onClick={() => setAuditOpen(true)}
                >
                  Run security audit
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <AuditModal
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        entries={entries}
        onOpenEntry={(entry) => {
          setAuditOpen(false)
          openEntry(entry)
        }}
        onGeneratePassword={generateForEntry}
        onSetIgnored={setAuditIgnored}
      />
      {authenticatorOpen && (
        <AuthenticatorModal
          entries={entries}
          onClose={() => setAuthenticatorOpen(false)}
          onOpenEntry={(entry) => {
            setAuthenticatorOpen(false)
            openEntry(entry)
          }}
        />
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <GeneratorModal open={generatorOpen} onClose={() => setGeneratorOpen(false)} />
      {shareTarget && (
        <ShareDialog
          open
          onClose={() => setShareTarget(null)}
          entry={shareTarget}
          handle={handle}
        />
      )}
      <ReceivedSharesDialog
        open={receivedOpen}
        onClose={() => setReceivedOpen(false)}
        onSeen={markReceivedSeen}
        onAdded={(entry) => {
          setReceivedOpen(false)
          openEntry(entry)
        }}
      />
      <SentSharesDialog
        open={sentOpen}
        onClose={() => setSentOpen(false)}
        entries={entries}
        onOpenEntry={(entry) => {
          setSentOpen(false)
          openEntry(entry)
        }}
      />

      {receivedUnread > 0 && !receivedNoticeDismissed && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-xl border border-line bg-surface p-3 shadow-float"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Icon name="mail" size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-ink">
              {receivedUnread} new shared {receivedUnread === 1 ? 'item' : 'items'}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              Someone shared a login with you. Review it in your inbox.
            </p>
            <button
              type="button"
              className="btn-primary mt-2 h-7 px-2 text-[11px]"
              onClick={() => {
                setReceivedNoticeDismissed(true)
                openReceivedShares()
              }}
            >
              Review
            </button>
          </div>
          <button
            type="button"
            className="icon-btn size-7 shrink-0"
            aria-label="Dismiss notification"
            onClick={() => setReceivedNoticeDismissed(true)}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Move to trash"
        width="max-w-sm"
      >
        <p className="text-[13px] leading-relaxed text-muted">
          <span className="font-medium text-ink">{deleteTarget?.title}</span> will move to Trash. You can restore it
          later from the Trash view.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              if (deleteTarget) moveToTrash(deleteTarget.id)
              setDeleteTarget(null)
            }}
          >
            <Icon name="trash" size={14} /> Move to trash
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteForeverTarget)}
        onClose={() => setDeleteForeverTarget(null)}
        title="Delete permanently"
        width="max-w-sm"
      >
        <p className="text-[13px] leading-relaxed text-muted">
          <span className="font-medium text-ink">{deleteForeverTarget?.title}</span> will be removed
          permanently, including its version history. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleteForeverTarget(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger-solid"
            onClick={() => {
              if (deleteForeverTarget) void deleteForever(deleteForeverTarget.id)
            }}
          >
            <Icon name="trash" size={14} /> Delete permanently
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkAction === 'delete'}
        onClose={() => setBulkAction(null)}
        title="Delete selected permanently"
        width="max-w-sm"
      >
        <p className="text-[13px] leading-relaxed text-muted">
          {selectedTrash.length} {selectedTrash.length === 1 ? 'item' : 'items'} will be removed
          permanently, including version history. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkAction(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger-solid"
            onClick={() => void deleteSelectedForever()}
            disabled={bulkBusy}
          >
            <Icon name="trash" size={14} /> {bulkBusy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </Modal>

      <Modal
        open={bulkAction === 'empty'}
        onClose={() => setBulkAction(null)}
        title="Empty trash"
        width="max-w-sm"
      >
        <p className="text-[13px] leading-relaxed text-muted">
          All {trash.length} {trash.length === 1 ? 'item' : 'items'} in Trash will be removed
          permanently, including version history. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setBulkAction(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger-solid"
            onClick={() => void emptyTrash()}
            disabled={bulkBusy}
          >
            <Icon name="trash" size={14} /> {bulkBusy ? 'Emptying…' : 'Empty trash'}
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(conflict)}
        onClose={() => {}}
        dismissible={false}
        title="Resolve vault conflict"
        description="Another session saved changes to this vault."
        width="max-w-md"
      >
        <p className="text-[13px] leading-relaxed text-muted">
          This vault changed in another session while this tab had unsaved edits. Nothing in this tab has been
          discarded yet.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">This tab</p>
            <p className="mt-1 text-[13px] font-medium text-ink">
              {entries.length} {entries.length === 1 ? 'item' : 'items'}
            </p>
            <p className="text-[11px] text-muted">
              {trash.length} in trash
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">Server</p>
            <p className="mt-1 text-[13px] font-medium text-ink">
              {conflict?.remoteEntries ?? 0} {(conflict?.remoteEntries ?? 0) === 1 ? 'item' : 'items'}
            </p>
            <p className="text-[11px] text-muted">
              {conflict?.remoteTrash ?? 0} in trash · {timeAgo(conflict?.remoteUpdatedAt ?? null)}
            </p>
          </div>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          <span className="font-medium text-ink">Merge items</span> keeps items added on either side. If the same
          item changed in both versions, the newest edit wins and the other version stays in its history.
        </p>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 space-y-2">
          <button
            type="button"
            className="btn-primary h-9 w-full text-[12.5px]"
            disabled={resolving !== null}
            onClick={() => void resolveVaultConflict('merge')}
          >
            {resolving === 'merge' ? 'Merging…' : 'Merge items'}
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium">Recommended</span>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-secondary h-9 text-[12.5px]"
              disabled={resolving !== null}
              onClick={() => void resolveVaultConflict('mine')}
            >
              {resolving === 'mine' ? 'Keeping…' : 'Keep mine'}
            </button>
            <button
              type="button"
              className="btn-secondary h-9 text-[12.5px]"
              disabled={resolving !== null}
              onClick={() => void resolveVaultConflict('server')}
            >
              {resolving === 'server' ? 'Loading…' : 'Use server'}
            </button>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Keep mine overwrites the server version. Use server discards unsaved changes in this tab.
        </p>
      </Modal>
    </div>
  )
}

export { newEntry }
