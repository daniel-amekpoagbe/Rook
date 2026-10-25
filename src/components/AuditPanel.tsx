import { useMemo, useState } from 'react'
import { scorePassword } from '~/lib/strength'
import { daysSince } from './ui'
import { hostOf, type Entry } from '~/lib/vault'
import { Icon, Sheet, cx } from './ui'
import { TYPE_META } from './EntryEditor'

async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** HIBP k-anonymity: only the first 5 hex chars of the hash ever leave the browser. */
async function breachedSuffixes(prefix: string): Promise<Map<string, number>> {
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'Add-Padding': 'true' },
  })
  if (!response.ok) throw new Error('Breach service unavailable')
  const text = await response.text()
  const map = new Map<string, number>()
  for (const line of text.split('\n')) {
    const [suffix, count] = line.trim().split(':')
    if (suffix && count) map.set(suffix.toUpperCase(), Number(count))
  }
  return map
}

interface Flag {
  entry: Entry
  reasons: string[]
  severity: 'high' | 'medium' | 'low'
}

export function AuditModal({ open, onClose, entries }: { open: boolean; onClose: () => void; entries: Entry[] }) {
  const [breaches, setBreaches] = useState<Map<string, number> | null>(null)
  const [checking, setChecking] = useState(false)
  const [breachError, setBreachError] = useState<string | null>(null)

  const flags = useMemo<Flag[]>(() => {
    const passwordCounts = new Map<string, number>()
    for (const entry of entries) {
      if (entry.password) passwordCounts.set(entry.password, (passwordCounts.get(entry.password) ?? 0) + 1)
    }

    const result: Flag[] = []
    for (const entry of entries) {
      const reasons: string[] = []
      let severity: Flag['severity'] = 'low'

      if (entry.password) {
        const strength = scorePassword(entry.password)
        if (strength.score <= 1) {
          reasons.push(`Weak password (${strength.bits} bits)`)
          severity = 'high'
        } else if (strength.score === 2) {
          reasons.push(`Only fair strength (${strength.bits} bits)`)
          if (severity === 'low') severity = 'medium'
        }
        if ((passwordCounts.get(entry.password) ?? 0) > 1) {
          reasons.push(`Reused on ${passwordCounts.get(entry.password)} items`)
          severity = 'high'
        }
        if (breaches?.has(entry.password)) {
          reasons.push('Found in a known breach')
          severity = 'high'
        }
      }

      const age = daysSince(entry.updatedAt)
      if (entry.password && age > 365) {
        reasons.push(`Unchanged for ${Math.floor(age / 30)} months`)
        if (severity === 'low') severity = 'medium'
      }

      if (entry.type === 'login' && entry.password && !entry.totp) {
        reasons.push('No one-time password set up')
      }

      if (reasons.length) result.push({ entry, reasons, severity })
    }

    const order = { high: 0, medium: 1, low: 2 }
    return result.sort((a, b) => order[a.severity] - order[b.severity])
  }, [entries, breaches])

  const counts = useMemo(() => {
    const withPassword = entries.filter((entry) => Boolean(entry.password))
    return {
      total: entries.length,
      weak: withPassword.filter((entry) => scorePassword(entry.password!).score <= 1).length,
      reused: flags.filter((flag) => flag.reasons.some((reason) => reason.startsWith('Reused'))).length,
      breached: breaches ? flags.filter((flag) => flag.reasons.includes('Found in a known breach')).length : null,
      without2fa: entries.filter((entry) => entry.type === 'login' && entry.password && !entry.totp).length,
    }
  }, [entries, flags, breaches])

  async function runBreachCheck() {
    setChecking(true)
    setBreachError(null)
    try {
      const unique = [...new Set(entries.map((entry) => entry.password).filter(Boolean))] as string[]
      const found = new Map<string, number>()
      const batch: string[][] = []
      for (let i = 0; i < unique.length; i += 5) batch.push(unique.slice(i, i + 5))

      for (const group of batch) {
        await Promise.all(
          group.map(async (password) => {
            const hash = await sha1Hex(password)
            const prefix = hash.slice(0, 5)
            const suffix = hash.slice(5)
            const map = await breachedSuffixes(prefix)
            if (map.has(suffix)) found.set(password, map.get(suffix)!)
          }),
        )
      }
      setBreaches(found)
    } catch (caught) {
      setBreachError(caught instanceof Error ? caught.message : 'Breach check failed')
    } finally {
      setChecking(false)
    }
  }

  const stats = [
    { label: 'Items', value: counts.total, tone: undefined },
    { label: 'Weak', value: counts.weak, tone: counts.weak > 0 ? 'warn' : undefined },
    { label: 'Reused', value: counts.reused, tone: counts.reused > 0 ? 'warn' : undefined },
    { label: 'No 2FA', value: counts.without2fa, tone: counts.without2fa > 0 ? 'warn' : undefined },
  ] as const

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Security audit"
      description="Weak, reused, old, and unprotected credentials."
    >
      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <div
              className={cx(
                'font-mono text-[18px] leading-none font-semibold tabular-nums',
                stat.tone === 'warn' ? 'text-warn' : 'text-ink',
              )}
            >
              {stat.value}
            </div>
            <div className="mt-1 text-[10.5px] font-medium tracking-[0.06em] text-muted uppercase">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11.5px] leading-relaxed text-muted">
            {breaches
              ? `${counts.breached} password${counts.breached === 1 ? '' : 's'} found in known breaches.`
              : 'Check passwords against Have I Been Pwned using k-anonymity. Only a 5-character hash prefix is sent.'}
            {breachError && <span className="mt-1 block text-danger">{breachError}</span>}
          </div>
          <button
            type="button"
            className="btn-secondary h-8 shrink-0 px-2.5 text-[12px]"
            onClick={runBreachCheck}
            disabled={checking}
          >
            {checking ? 'Checking…' : breaches ? 'Re-check' : 'Check breaches'}
          </button>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[12.5px] font-semibold">Findings</h3>
          <span className="text-[11px] text-faint">
            {flags.length} {flags.length === 1 ? 'item' : 'items'}
          </span>
        </div>

        {flags.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-line bg-surface-2 px-4 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl border border-line bg-surface text-success shadow-rest">
              <Icon name="shield" size={19} />
            </span>
            <p className="mt-3 text-[13px] font-medium">No issues found</p>
            <p className="mt-1 max-w-[30ch] text-[11.5px] leading-relaxed text-muted">
              Every stored password is strong, unique and recent.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {flags.map(({ entry, reasons, severity }) => (
              <div key={entry.id} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span
                    className={cx(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      severity === 'high' ? 'bg-danger' : severity === 'medium' ? 'bg-warn' : 'bg-faint',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium">{entry.title}</span>
                      {entry.username && (
                        <span className="truncate text-[11px] text-faint">{entry.username}</span>
                      )}
                    </div>
                    {hostOf(entry.url) && (
                      <p className="truncate text-[11px] text-faint">{hostOf(entry.url)}</p>
                    )}
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {reasons.map((reason) => (
                        <li key={reason} className="text-[11px] text-muted">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <span className="chip shrink-0">{TYPE_META[entry.type].label}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
