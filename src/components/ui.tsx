import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { IconType } from 'react-icons'
import {
  LuArchive,
  LuArrowLeft,
  LuArrowUpRight,
  LuCheck,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuCircleCheck,
  LuCircleHelp,
  LuClock,
  LuCopy,
  LuCreditCard,
  LuDownload,
  LuEye,
  LuEyeOff,
  LuFileText,
  LuFingerprint,
  LuGlobe,
  LuInfo,
  LuKeyRound,
  LuLayoutGrid,
  LuLink,
  LuLoaderCircle,
  LuLock,
  LuLockOpen,
  LuLogOut,
  LuMail,
  LuMenu,
  LuMoon,
  LuEllipsis,
  LuPencil,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuSettings2,
  LuShare2,
  LuShieldAlert,
  LuShieldCheck,
  LuShuffle,
  LuSparkles,
  LuStar,
  LuSun,
  LuTimer,
  LuTrash2,
  LuTriangleAlert,
  LuUndo2,
  LuUpload,
  LuUserRound,
  LuVault,
  LuX,
} from 'react-icons/lu'
import { STRENGTH_COLORS, type PasswordStrength } from '~/lib/strength'

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

const ICONS: Record<string, IconType> = {
  alert: LuTriangleAlert,
  archive: LuArchive,
  arrowLeft: LuArrowLeft,
  arrowUpRight: LuArrowUpRight,
  audit: LuShieldCheck,
  authenticator: LuTimer,
  card: LuCreditCard,
  check: LuCheck,
  checkCircle: LuCircleCheck,
  chevron: LuChevronRight,
  chevronDown: LuChevronDown,
  chevronLeft: LuChevronLeft,
  close: LuX,
  clock: LuClock,
  copy: LuCopy,
  download: LuDownload,
  edit: LuPencil,
  eye: LuEye,
  eyeOff: LuEyeOff,
  fingerprint: LuFingerprint,
  generator: LuSparkles,
  globe: LuGlobe,
  help: LuCircleHelp,
  info: LuInfo,
  key: LuKeyRound,
  grid: LuLayoutGrid,
  link: LuLink,
  loader: LuLoaderCircle,
  lock: LuLock,
  logout: LuLogOut,
  mail: LuMail,
  menu: LuMenu,
  moon: LuMoon,
  more: LuEllipsis,
  note: LuFileText,
  plus: LuPlus,
  refresh: LuRefreshCw,
  search: LuSearch,
  settings: LuSettings2,
  share: LuShare2,
  shield: LuShieldCheck,
  shieldAlert: LuShieldAlert,
  shuffle: LuShuffle,
  star: LuStar,
  sun: LuSun,
  trash: LuTrash2,
  undo: LuUndo2,
  unlock: LuLockOpen,
  upload: LuUpload,
  user: LuUserRound,
  vault: LuVault,
}

export function Icon({
  name,
  size = 16,
  className,
  filled = false,
  strokeWidth = 1.75,
}: {
  name: keyof typeof ICONS | string
  size?: number
  className?: string
  filled?: boolean
  strokeWidth?: number
}) {
  const Glyph = ICONS[name] ?? LuCircleHelp
  return (
    <Glyph
      size={size}
      className={className}
      strokeWidth={strokeWidth}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
      focusable="false"
    />
  )
}

export function Spinner({ size = 15, className }: { size?: number; className?: string }) {
  return <Icon name="loader" size={size} className={cx('animate-spin', className)} />
}

export function StrengthMeter({
  strength,
  compact = false,
  bits,
}: {
  strength: PasswordStrength
  compact?: boolean
  bits?: number
}) {
  return (
    <div className="w-full">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            className="h-1 flex-1 rounded-full transition-colors duration-300"
            style={{
              background: index < strength.score + 1 ? STRENGTH_COLORS[strength.score] : 'var(--hairline)',
            }}
          />
        ))}
      </div>
      {!compact && (
        <div className="mt-1.5 flex items-baseline justify-between text-[11px] text-muted">
          <span style={{ color: STRENGTH_COLORS[strength.score] }} className="font-medium">
            {strength.label}
          </span>
          <span className="font-mono text-faint">{bits ?? strength.bits} bits</span>
        </div>
      )}
      {!compact && strength.warnings.length > 0 && (
        <p className="mt-1 text-[11px] leading-snug text-faint">{strength.warnings[0]}</p>
      )}
    </div>
  )
}

export function useCopyToClipboard(clearAfterMs = 30_000) {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return {
    copied,
    async copy(value: string, key = value) {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(async () => {
        try {
          const current = await navigator.clipboard.readText()
          if (current === value) await navigator.clipboard.writeText('')
        } catch {
          // Clipboard read permission denied: leave it to the OS timeout.
        }
        setCopied(null)
      }, clearAfterMs)
      setTimeout(() => setCopied((prev) => (prev === key ? null : prev)), 1600)
    },
  }
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let modalRoot: HTMLDivElement | null = null
let modalLockCount = 0
let previousBodyOverflow = ''
const inertedElements: Array<{ element: HTMLElement; previous: boolean }> = []

function getModalRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (!modalRoot) {
    modalRoot = document.createElement('div')
    modalRoot.id = 'rook-modal-root'
    document.body.appendChild(modalRoot)
  }
  return modalRoot
}

function lockModalBackground() {
  if (modalLockCount++ > 0) return
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  const root = getModalRoot()
  for (const child of Array.from(document.body.children)) {
    if (child === root || !(child instanceof HTMLElement)) continue
    if (['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'].includes(child.tagName)) continue
    inertedElements.push({ element: child, previous: child.inert })
    child.inert = true
  }
}

function unlockModalBackground() {
  if (modalLockCount === 0) return
  if (--modalLockCount > 0) return
  document.body.style.overflow = previousBodyOverflow
  for (const { element, previous } of inertedElements.splice(0)) {
    element.inert = previous
  }
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  )
}

function useDialogLayer(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  dismissible: boolean,
) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const previous =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    lockModalBackground()

    const preferred = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        '[data-autofocus], input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([data-skip-autofocus]):not([disabled])',
      ),
    ).find((element) => element.getClientRects().length > 0)
    if (preferred) {
      preferred.focus({ preventScroll: true })
    } else {
      dialog.tabIndex = -1
      dialog.focus({ preventScroll: true })
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (dismissible) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusableWithin(dialog)
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      unlockModalBackground()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, dialogRef, dismissible])
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = 'max-w-lg',
  dismissible = true,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  width?: string
  dismissible?: boolean
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogLayer(open, dialogRef, onClose, dismissible)

  const portalTarget = open ? getModalRoot() : null
  if (!open || !portalTarget) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {dismissible ? (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute inset-0 bg-black/30 fade-in dark:bg-black/55"
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/30 fade-in dark:bg-black/55" />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-overlay rise',
          width,
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line px-5">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
            {description && <p className="truncate text-[11.5px] text-muted">{description}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="icon-btn -mr-2"
              aria-label="Close dialog"
              data-skip-autofocus
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    portalTarget,
  )
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogLayer(open, dialogRef, onClose, true)

  const portalTarget = open ? getModalRoot() : null
  if (!open || !portalTarget) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/35 fade-in backdrop-blur-[1px] dark:bg-black/60"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-[480px] flex-col border-l border-line bg-surface shadow-overlay sheet-in"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line px-5">
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
            {description && <p className="truncate text-[11.5px] text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn -mr-2"
            aria-label="Close panel"
            data-skip-autofocus
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>,
    portalTarget,
  )
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  }, [])

  function toggle() {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      try {
        localStorage.setItem('rook.theme', next)
      } catch {
        // Storage can be unavailable in private windows; the theme still applies.
      }
      return next
    })
  }

  return { theme, toggle }
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className={cx('icon-btn', className)}
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
    </button>
  )
}

export function timeAgo(timestamp: number | null): string {
  if (!timestamp) return 'never'
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

export function daysSince(iso: string): number {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 0
  return Math.floor((Date.now() - then) / 86_400_000)
}
