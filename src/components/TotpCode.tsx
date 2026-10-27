import { useEffect, useMemo, useState } from 'react'
import {
  generateTotp,
  parseTotp,
  type TotpConfig,
  type TotpResult,
} from '~/lib/totp'
import { Icon, cx, useCopyToClipboard } from './ui'

/**
 * One timer per mounted authenticator surface, aligned to the next wall-clock
 * second. Codes are recomputed only when the TOTP counter changes, not on every
 * countdown tick.
 */
export function useSecondClock(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      timer = setTimeout(() => {
        if (!active) return
        setNow(Date.now())
        schedule()
      }, 1000 - (Date.now() % 1000))
    }
    schedule()

    const onVisibility = () => {
      if (!document.hidden) setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return now
}

export interface TotpState {
  result: TotpResult | null
  config: TotpConfig | null
  error: string | null
}

export function useTotp(secret: string, now: number): TotpState {
  const config = useMemo(() => parseTotp(secret), [secret])
  const counter = config ? Math.floor(now / 1000 / config.period) : -1
  const [result, setResult] = useState<TotpResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setResult(null)
    setError(null)
  }, [config])

  useEffect(() => {
    if (!config) {
      setResult(null)
      setError('This authenticator secret is not supported.')
      return
    }

    let active = true
    setError(null)
    void generateTotp(config, counter * config.period * 1000)
      .then((next) => {
        if (active) setResult(next)
      })
      .catch(() => {
        if (active) {
          setResult(null)
          setError('Authenticator codes require a secure browser context.')
        }
      })
    return () => {
      active = false
    }
  }, [config, counter])

  if (!config) return { result: null, config, error }

  const secondsIntoPeriod = Math.floor(now / 1000) % config.period
  const remaining = Math.max(0, config.period - secondsIntoPeriod)
  const progress = secondsIntoPeriod / config.period

  return {
    result: result ? { ...result, remaining, progress } : null,
    config,
    error,
  }
}

export function formatTotpCode(code: string): string {
  const midpoint = Math.ceil(code.length / 2)
  return `${code.slice(0, midpoint)} ${code.slice(midpoint)}`
}

export function TotpRing({ result }: { result: TotpResult }) {
  const degrees = Math.max(0, Math.min(1, 1 - result.progress)) * 360
  return (
    <span
      className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(var(--primary) ${degrees}deg, var(--hairline) 0deg)`,
      }}
      role="img"
      aria-label={`${result.remaining} seconds remaining`}
    >
      <span className="absolute inset-[3px] rounded-full bg-surface-2" aria-hidden="true" />
      <span className="relative font-mono text-[9px] text-faint tabular-nums" aria-hidden="true">
        {result.remaining}
      </span>
    </span>
  )
}

export function TotpBlock({ secret }: { secret: string }) {
  const now = useSecondClock()
  const { result, config, error } = useTotp(secret, now)
  const { copied, copy } = useCopyToClipboard()

  if (error) return <p className="text-[12px] text-danger">{error}</p>
  if (!result) return <p className="text-[12px] text-muted">Generating code…</p>

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11.5px] font-medium text-muted">
            {config?.issuer ? `${config.issuer} · One-time code` : 'One-time code'}
          </div>
          <div
            data-testid="totp-code"
            className="mt-0.5 font-mono text-[22px] leading-none tracking-[0.14em] text-ink"
            aria-label={`One-time code ${result.code}`}
          >
            {formatTotpCode(result.code)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cx(
              'font-mono text-[11px] tabular-nums',
              result.remaining <= 5 ? 'text-danger' : 'text-faint',
            )}
          >
            {result.remaining}s
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void copy(result.code)}
            aria-label="Copy one-time code"
          >
            <Icon
              name={copied === result.code ? 'check' : 'copy'}
              size={15}
              className={copied === result.code ? 'text-success' : undefined}
            />
          </button>
        </div>
      </div>
      <div className="mt-3 h-0.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${(1 - result.progress) * 100}%` }}
        />
      </div>
    </div>
  )
}
