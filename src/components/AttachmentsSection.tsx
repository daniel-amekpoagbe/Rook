import { useRef, useState } from 'react'
import {
  formatFileSize,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ENTRY,
  type Attachment,
} from '~/lib/attachments'
import type { Entry } from '~/lib/vault'
import { friendlyError, useVault } from '~/lib/vault-context'
import { Icon, Spinner } from './ui'

type Message = { tone: 'ok' | 'error'; text: string }

export function AttachmentsSection({
  entry,
  readOnly = false,
}: {
  entry: Entry
  readOnly?: boolean
}) {
  const { addAttachment, removeAttachment, downloadAttachment } = useVault()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [message, setMessage] = useState<Message | null>(null)

  const atLimit = entry.attachments.length >= MAX_ATTACHMENTS_PER_ENTRY
  const disabled = busy !== null

  async function choose(file: File | undefined) {
    if (!file) return
    setBusy('add')
    setMessage(null)
    try {
      await addAttachment(entry.id, file)
      setMessage({ tone: 'ok', text: 'Attachment encrypted and saved.' })
    } catch (caught) {
      setMessage({ tone: 'error', text: friendlyError(caught) })
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function download(attachment: Attachment) {
    setBusy(`download:${attachment.id}`)
    setMessage(null)
    try {
      const result = await downloadAttachment(entry.id, attachment)
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (caught) {
      setMessage({ tone: 'error', text: friendlyError(caught) })
    } finally {
      setBusy(null)
    }
  }

  async function remove(attachment: Attachment) {
    setBusy(`remove:${attachment.id}`)
    setMessage(null)
    try {
      await removeAttachment(entry.id, attachment.id)
      setConfirmId(null)
      setMessage({ tone: 'ok', text: 'Attachment removed.' })
    } catch (caught) {
      setMessage({ tone: 'error', text: friendlyError(caught) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[11.5px] font-medium text-muted">Attachments</h3>
        <span className="text-[11px] text-faint">
          {entry.attachments.length}/{MAX_ATTACHMENTS_PER_ENTRY}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {entry.attachments.length === 0 ? (
          <p className="px-4 py-3 text-[12px] text-muted">
            {readOnly ? 'No files attached.' : 'No files attached yet.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {entry.attachments.map((attachment) => {
              const downloading = busy === `download:${attachment.id}`
              const removing = busy === `remove:${attachment.id}`
              return (
                <li key={attachment.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-faint">
                    <Icon name="note" size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">
                      {attachment.name}
                    </span>
                    <span className="block truncate text-[11px] text-faint">
                      {formatFileSize(attachment.size)}
                      {attachment.type ? ` · ${attachment.type}` : ''}
                    </span>
                  </span>

                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void download(attachment)}
                    disabled={disabled}
                    aria-label={`Download ${attachment.name}`}
                  >
                    {downloading ? <Spinner size={15} /> : <Icon name="download" size={15} />}
                  </button>

                  {!readOnly &&
                    (confirmId === attachment.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          className="btn-danger-solid h-8 px-2 text-[11px]"
                          onClick={() => void remove(attachment)}
                          disabled={disabled}
                        >
                          {removing ? 'Removing…' : 'Remove'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary h-8 px-2 text-[11px]"
                          onClick={() => setConfirmId(null)}
                          disabled={disabled}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="icon-btn hover:text-danger"
                        onClick={() => setConfirmId(attachment.id)}
                        disabled={disabled}
                        aria-label={`Remove ${attachment.name}`}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    ))}
                </li>
              )
            })}
          </ul>
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-3 py-2">
            <p className="text-[11px] text-faint">
              Encrypted before upload · max {formatFileSize(MAX_ATTACHMENT_BYTES)} per file
            </p>
            <button
              type="button"
              className="btn-secondary h-8 px-2.5 text-[11.5px]"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || atLimit}
            >
              {busy === 'add' ? (
                <>
                  <Spinner size={13} /> Encrypting…
                </>
              ) : (
                <>
                  <Icon name="plus" size={13} /> Add file
                </>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              onChange={(event) => void choose(event.target.files?.[0])}
            />
          </div>
        )}
      </div>

      {atLimit && (
        <p className="mt-1.5 text-[11px] text-warn">
          This item has reached its attachment limit.
        </p>
      )}
      {message && (
        <p
          role="status"
          aria-live="polite"
          className={message.tone === 'error' ? 'mt-1.5 text-[11px] text-danger' : 'mt-1.5 text-[11px] text-success'}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
