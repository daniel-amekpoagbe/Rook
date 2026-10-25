import { useRef, useState } from 'react'
import { IMPORT_SOURCE_LABELS, parseImportText, type ImportResult } from '~/lib/import'
import { scorePassword } from '~/lib/strength'
import { friendlyError, useVault } from '~/lib/vault-context'
import { Icon, Sheet, StrengthMeter, cx } from './ui'

function download(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-line py-5 first:pt-0 last:border-0 last:pb-0">
      <h3 className="text-[12.5px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    handle,
    autoLockMinutes,
    setAutoLockMinutes,
    changeMasterPassword,
    exportBackup,
    exportCsv,
    importBackup,
    importEntries,
    signOut,
    sync,
    lastSyncedAt,
  } = useVault()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [pendingCsv, setPendingCsv] = useState(false)
  const [pendingImport, setPendingImport] = useState<{ file: File; password: string } | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [pendingPlainImport, setPendingPlainImport] = useState<{ fileName: string; result: ImportResult } | null>(null)
  const [plainImportBusy, setPlainImportBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const plainFileInput = useRef<HTMLInputElement>(null)

  const strength = scorePassword(next)

  async function rotate() {
    setMessage(null)
    if (next !== confirm) {
      setMessage({ tone: 'error', text: 'New passwords do not match.' })
      return
    }
    if (next.length < 10) {
      setMessage({ tone: 'error', text: 'Use at least 10 characters.' })
      return
    }
    if (next === current) {
      setMessage({ tone: 'error', text: 'The new password must be different from the current one.' })
      return
    }
    if (handle && next.toLowerCase() === handle.toLowerCase()) {
      setMessage({ tone: 'error', text: "Your master password can't be your username." })
      return
    }
    if (strength.score < 2) {
      const reason = strength.warnings[0] ? ` (${strength.warnings[0].toLowerCase()})` : ''
      setMessage({ tone: 'error', text: `That password is too weak to protect a vault${reason}.` })
      return
    }
    setBusy(true)
    try {
      await changeMasterPassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setMessage({ tone: 'ok', text: 'Master password changed. The vault was re-encrypted with a new key.' })
    } catch (caught) {
      setMessage({ tone: 'error', text: friendlyError(caught) })
    } finally {
      setBusy(false)
    }
  }

  function backupEncrypted() {
    const blob = exportBackup()
    if (!blob) return
    download(`rook-${handle ?? 'vault'}-${new Date().toISOString().slice(0, 10)}.knv.json`, JSON.stringify(blob, null, 2))
    setMessage({ tone: 'ok', text: 'Encrypted backup downloaded. It needs your master password to open.' })
  }

  function backupCsv() {
    const csv = exportCsv()
    if (!csv) return
    setMessage(null)
    setPendingCsv(true)
  }

  function confirmCsv() {
    const csv = exportCsv()
    if (!csv) return
    download(`rook-${handle ?? 'vault'}-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv')
    setPendingCsv(false)
    setMessage({ tone: 'ok', text: 'Plain-text CSV downloaded. Delete it after use.' })
  }

  function chooseImportFile(file: File) {
    setMessage(null)
    setPendingImport({ file, password: '' })
  }

  async function confirmImport() {
    if (!pendingImport) return
    if (!pendingImport.password) {
      setMessage({ tone: 'error', text: 'Enter the backup password to decrypt it.' })
      return
    }
    setImportBusy(true)
    try {
      const text = await pendingImport.file.text()
      await importBackup(text, pendingImport.password)
      setPendingImport(null)
      setMessage({ tone: 'ok', text: 'Backup decrypted and merged into this vault.' })
    } catch (caught) {
      setMessage({ tone: 'error', text: friendlyError(caught) })
    } finally {
      setImportBusy(false)
    }
  }

  async function choosePlainImportFile(file: File) {
    setMessage(null)
    setPendingPlainImport(null)
    try {
      const result = parseImportText(await file.text())
      if (result.entries.length === 0) {
        throw new Error('No importable items were found in that file.')
      }
      setPendingPlainImport({ fileName: file.name, result })
    } catch (caught) {
      setMessage({ tone: 'error', text: friendlyError(caught) })
    }
  }

  function confirmPlainImport() {
    if (!pendingPlainImport) return
    setPlainImportBusy(true)
    try {
      const { added, skipped } = importEntries(pendingPlainImport.result.entries)
      const skippedTotal = pendingPlainImport.result.skipped + skipped
      const source = IMPORT_SOURCE_LABELS[pendingPlainImport.result.source]
      setPendingPlainImport(null)
      setMessage({
        tone: 'ok',
        text: `Imported ${added} item${added === 1 ? '' : 's'} from ${source}.${
          skippedTotal > 0
            ? ` Skipped ${skippedTotal} duplicate or unsupported item${skippedTotal === 1 ? '' : 's'}.`
            : ''
        }`,
      })
    } catch (caught) {
      setMessage({ tone: 'error', text: friendlyError(caught) })
    } finally {
      setPlainImportBusy(false)
    }
  }

  function close() {
    setCurrent('')
    setNext('')
    setConfirm('')
    setPendingCsv(false)
    setPendingImport(null)
    setPendingPlainImport(null)
    setMessage(null)
    onClose()
  }

  return (
    <Sheet open={open} onClose={close} title="Settings" description="Account, security, and portability.">
      <Section title="Account">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[12px] font-semibold text-muted uppercase">
              {handle?.charAt(0) ?? 'K'}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium">{handle}</div>
              <div className="text-[11px] text-faint">
                {sync === 'saved' ? 'Saved to server' : sync === 'saving' ? 'Saving…' : sync === 'conflict' ? 'Conflict' : 'Ready'}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary h-8 px-2.5 text-[12px]"
            onClick={async () => {
              close()
              await signOut()
            }}
          >
            <Icon name="logout" size={13} /> Sign out
          </button>
        </div>
      </Section>

      <Section title="Auto-lock" description="The in-memory key is wiped after this much inactivity.">
        <div className="grid grid-cols-5 gap-1.5">
          {[1, 5, 15, 30, 60].map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => setAutoLockMinutes(minutes)}
              className={cx(
                'h-8 rounded-lg border text-[11.5px] font-medium transition-colors',
                autoLockMinutes === minutes
                  ? 'border-accent/35 bg-accent-soft text-accent-hover'
                  : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              {minutes < 60 ? `${minutes}m` : '1h'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Change master password" description="Re-derives keys with a fresh salt and re-encrypts the vault.">
        <div className="space-y-2">
          <div>
            <label htmlFor="current-master-password" className="label">
              Current password
            </label>
            <input
              id="current-master-password"
              className="field"
              type="password"
              placeholder="Your current master password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="next-master-password" className="label">
                New password
              </label>
              <input
                id="next-master-password"
                className="field"
                type="password"
                placeholder="At least 10 characters"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="confirm-master-password" className="label">
                Confirm password
              </label>
              <input
                id="confirm-master-password"
                className="field"
                type="password"
                placeholder="Repeat the new password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          {next.length > 0 && (
            <div className="pt-0.5">
              <StrengthMeter strength={strength} />
            </div>
          )}
          <button type="button" className="btn-secondary h-8 px-2.5 text-[12px]" onClick={rotate} disabled={busy}>
            {busy ? 'Re-keying…' : 'Change password'}
          </button>
        </div>
      </Section>

      <Section title="Backup and portability">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary h-8 px-2.5 text-[12px]" onClick={backupEncrypted}>
            <Icon name="download" size={13} /> Encrypted backup
          </button>
          <button type="button" className="btn-secondary h-8 px-2.5 text-[12px]" onClick={backupCsv}>
            <Icon name="download" size={13} /> CSV export
          </button>
          <button
            type="button"
            className="btn-secondary h-8 px-2.5 text-[12px]"
            onClick={() => fileInput.current?.click()}
          >
            <Icon name="upload" size={13} /> Import backup
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.knv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) chooseImportFile(file)
              event.target.value = ''
            }}
          />
        </div>

        {pendingCsv && (
          <div className="mt-3 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2.5">
            <p className="text-[11.5px] leading-relaxed text-muted">
              <span className="font-medium text-ink">Plain-text export.</span> The CSV contains every password
              unencrypted. Store it only somewhere you trust, and delete it after use.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-secondary h-8 px-2.5 text-[12px]" onClick={() => setPendingCsv(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger-solid h-8 px-2.5 text-[12px]"
                onClick={confirmCsv}
              >
                <Icon name="download" size={13} /> Export CSV
              </button>
            </div>
          </div>
        )}

        {pendingImport && (
          <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-[11.5px] leading-relaxed text-muted">
              <span className="font-medium text-ink">{pendingImport.file.name}</span> is encrypted. Enter the master
              password used when it was created.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                className="field h-8 flex-1"
                type="password"
                placeholder="Backup master password"
                aria-label="Backup master password"
                value={pendingImport.password}
                onChange={(event) =>
                  setPendingImport((prev) => (prev ? { ...prev, password: event.target.value } : prev))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void confirmImport()
                }}
                autoFocus
                autoComplete="off"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary h-8 px-2.5 text-[12px]"
                  onClick={() => setPendingImport(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary h-8 px-2.5 text-[12px]"
                  onClick={confirmImport}
                  disabled={importBusy}
                >
                  {importBusy ? 'Importing…' : 'Import'}
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          The encrypted backup is a self-contained copy of the vault blob, including its KDF header. It is safe to store
          anywhere you trust, as long as you remember the master password.
        </p>
      </Section>

      <Section
        title="Import from another manager"
        description="Bring logins, notes, cards, and identities over from Chrome, 1Password, or Bitwarden. Files are parsed in this tab and never uploaded."
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary h-8 px-2.5 text-[12px]"
            onClick={() => plainFileInput.current?.click()}
          >
            <Icon name="upload" size={13} /> Choose CSV or JSON
          </button>
          <input
            ref={plainFileInput}
            type="file"
            accept=".csv,.json"
            aria-label="Import CSV or JSON file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void choosePlainImportFile(file)
              event.target.value = ''
            }}
          />
        </div>

        {pendingPlainImport && (
          <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-[11.5px] leading-relaxed text-muted">
              <span className="font-medium text-ink">{pendingPlainImport.fileName}</span> looks like a{' '}
              <span className="font-medium text-ink">{IMPORT_SOURCE_LABELS[pendingPlainImport.result.source]}</span>{' '}
              export with{' '}
              <span className="font-medium text-ink">
                {pendingPlainImport.result.entries.length}{' '}
                {pendingPlainImport.result.entries.length === 1 ? 'item' : 'items'}
              </span>
              .
            </p>
            {pendingPlainImport.result.warnings.length > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-warn">
                {pendingPlainImport.result.warnings.join(' ')}
              </p>
            )}
            <p className="mt-1 truncate text-[11px] text-faint">
              {pendingPlainImport.result.entries
                .slice(0, 4)
                .map((entry) => entry.title)
                .join(' · ')}
              {pendingPlainImport.result.entries.length > 4 ? ' …' : ''}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-secondary h-8 px-2.5 text-[12px]"
                onClick={() => setPendingPlainImport(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary h-8 px-2.5 text-[12px]"
                onClick={confirmPlainImport}
                disabled={plainImportBusy}
              >
                {plainImportBusy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Supported: Chrome CSV, 1Password CSV, Bitwarden JSON/CSV, and Rook CSV. Duplicate items are skipped by title,
          username, and URL.
        </p>
      </Section>

      <Section title="Storage" description="How this build keeps your data.">
        <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted">
          <li className="flex gap-2">
            <Icon name="check" size={13} className="mt-0.5 shrink-0 text-success" />
            Vault blob: SQLite on the Node server, encrypted before upload.
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={13} className="mt-0.5 shrink-0 text-success" />
            Master password: never stored, never transmitted.
          </li>
          <li className="flex gap-2">
            <Icon name="check" size={13} className="mt-0.5 shrink-0 text-success" />
            Session: httpOnly cookie holding a random token; only its SHA-256 is stored.
          </li>
        </ul>
        <div className="mt-2 font-mono text-[10.5px] text-faint">
          Last save:{' '}
          {lastSyncedAt
            ? new Date(lastSyncedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
            : '—'}
        </div>
      </Section>

      {message && (
        <div
          role="status"
          className={cx(
            'mt-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed',
            message.tone === 'ok'
              ? 'border-success/25 bg-success/5 text-success'
              : 'border-danger/20 bg-danger-soft text-danger',
          )}
        >
          <Icon name={message.tone === 'ok' ? 'checkCircle' : 'alert'} size={14} className="mt-0.5 shrink-0" />
          {message.text}
        </div>
      )}
    </Sheet>
  )
}
