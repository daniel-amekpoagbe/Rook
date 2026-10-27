import { useMemo, useState } from 'react'
import { hostOf, matchesQuery, sortEntries, type Entry } from '~/lib/vault'
import { parseTotp } from '~/lib/totp'
import { BrandIcon, brandCssVars, brandForEntry } from './BrandIcon'
import { formatTotpCode, TotpRing, useSecondClock, useTotp } from './TotpCode'
import { Icon, Modal, useCopyToClipboard } from './ui'

function AuthenticatorAvatar({ entry }: { entry: Entry }) {
  const brand = brandForEntry(entry.url, entry.title)
  const initial = entry.title.trim().charAt(0).toUpperCase()
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface text-[12px] font-semibold text-faint"
      style={brand ? brandCssVars(brand) : undefined}
      aria-hidden="true"
    >
      {brand ? <BrandIcon brand={brand} size={20} /> : initial || <Icon name="key" size={16} />}
    </span>
  )
}

function AuthenticatorRow({
  entry,
  now,
  onOpen,
}: {
  entry: Entry
  now: number
  onOpen: () => void
}) {
  const { result, config, error } = useTotp(entry.totp ?? '', now)
  const { copied, copy } = useCopyToClipboard()
  const subtitle =
    [config?.issuer ?? config?.account, entry.username].filter(Boolean).join(' · ') ||
    hostOf(entry.url) ||
    'Login'

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <AuthenticatorAvatar entry={entry} />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
        aria-label={`Open ${entry.title}`}
      >
        <span className="block truncate text-[13px] font-medium text-ink">{entry.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-faint">{subtitle}</span>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        {error ? (
          <span className="text-[11px] text-danger">Invalid</span>
        ) : result ? (
          <>
            <span
              data-testid="authenticator-code"
              className="font-mono text-[15px] tracking-[0.1em] text-ink tabular-nums"
              aria-label={`One-time code for ${entry.title}: ${result.code}`}
            >
              {formatTotpCode(result.code)}
            </span>
            <TotpRing result={result} />
            <button
              type="button"
              className="icon-btn size-7"
              onClick={() => void copy(result.code, entry.id)}
              aria-label={`Copy one-time code for ${entry.title}`}
            >
              <Icon
                name={copied === entry.id ? 'check' : 'copy'}
                size={13}
                className={copied === entry.id ? 'text-success' : undefined}
              />
            </button>
          </>
        ) : (
          <span className="text-[11px] text-faint">Generating…</span>
        )}
      </div>
    </div>
  )
}

export function AuthenticatorModal({
  entries,
  onClose,
  onOpenEntry,
}: {
  entries: Entry[]
  onClose: () => void
  onOpenEntry: (entry: Entry) => void
}) {
  const [query, setQuery] = useState('')
  const now = useSecondClock()

  const accounts = useMemo(
    () =>
      sortEntries(
        entries.filter(
          (entry) =>
            entry.type === 'login' &&
            Boolean(entry.totp && parseTotp(entry.totp)) &&
            matchesQuery(entry, query),
        ),
      ),
    [entries, query],
  )

  return (
    <Modal
      open
      onClose={onClose}
      title="Authenticator"
      description="Codes from your encrypted vault"
      width="max-w-lg"
    >
      <div className="relative">
        <Icon
          name="search"
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="field h-9 pl-8 text-[12.5px]"
          placeholder="Search accounts"
          aria-label="Search authenticator accounts"
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-faint hover:bg-surface-3 hover:text-ink"
            aria-label="Clear authenticator search"
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      {accounts.length > 0 ? (
        <div className="mt-3 space-y-2">
          {accounts.map((entry) => (
            <AuthenticatorRow
              key={entry.id}
              entry={entry}
              now={now}
              onOpen={() => onOpenEntry(entry)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface-2 text-faint">
            <Icon name="clock" size={18} />
          </span>
          <p className="mt-3 text-[13px] font-medium text-ink">
            {query ? 'No matching accounts' : 'No authenticator codes yet'}
          </p>
          <p className="mt-1 max-w-[34ch] text-[11.5px] leading-relaxed text-muted">
            {query
              ? 'Try a different name or username.'
              : 'Add a login and paste its base32 secret or otpauth:// URI in the editor.'}
          </p>
        </div>
      )}

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-faint">
        Codes are calculated in this browser. Authenticator secrets stay inside the encrypted
        vault and are never sent to the server.
      </p>
    </Modal>
  )
}
