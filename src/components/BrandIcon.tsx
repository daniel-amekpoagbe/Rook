import type { CSSProperties, SVGProps } from 'react'
import { hostOf } from '~/lib/vault'

export type Brand =
  | 'amazon'
  | 'apple'
  | 'discord'
  | 'facebook'
  | 'github'
  | 'google'
  | 'instagram'
  | 'linkedin'
  | 'microsoft'
  | 'netflix'
  | 'reddit'
  | 'slack'
  | 'spotify'
  | 'tiktok'
  | 'whatsapp'
  | 'x'
  | 'youtube'

const BRAND_DOMAINS: Array<[Brand, string[]]> = [
  ['google', ['google.com', 'gmail.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['instagram', ['instagram.com']],
  ['facebook', ['facebook.com', 'fb.com', 'messenger.com']],
  ['x', ['x.com', 'twitter.com']],
  ['github', ['github.com', 'githubusercontent.com']],
  ['microsoft', ['microsoft.com', 'live.com', 'outlook.com', 'office.com', 'azure.com']],
  ['apple', ['apple.com', 'icloud.com']],
  ['amazon', ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.in']],
  ['netflix', ['netflix.com']],
  ['linkedin', ['linkedin.com']],
  ['reddit', ['reddit.com']],
  ['discord', ['discord.com', 'discordapp.com']],
  ['spotify', ['spotify.com']],
  ['slack', ['slack.com']],
  ['whatsapp', ['whatsapp.com']],
  ['tiktok', ['tiktok.com']],
]

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

export function brandForUrl(url: string | undefined): Brand | null {
  const host = hostOf(url)
  if (!host) return null
  return BRAND_DOMAINS.find(([, domains]) => domains.some((domain) => matchesDomain(host, domain)))?.[0] ?? null
}

export function brandForEntry(url: string | undefined, title: string): Brand | null {
  const fromUrl = brandForUrl(url)
  if (fromUrl) return fromUrl
  const normalizedTitle = title.trim().toLowerCase()
  return (
    BRAND_DOMAINS.find(([brand, domains]) => {
      const name = domains[0]!.split('.')[0]
      return normalizedTitle === name || normalizedTitle.includes(name) || normalizedTitle.includes(brand)
    })?.[0] ?? null
  )
}

const BRAND_COLORS: Record<Brand, string> = {
  amazon: '#111827',
  apple: '#111827',
  discord: '#5865f2',
  facebook: '#1877f2',
  github: '#24292f',
  google: '#4285f4',
  instagram: '#d946ef',
  linkedin: '#0a66c2',
  microsoft: '#f25022',
  netflix: '#e50914',
  reddit: '#ff4500',
  slack: '#611f69',
  spotify: '#1db954',
  tiktok: '#111827',
  whatsapp: '#25d366',
  x: '#111827',
  youtube: '#ff0033',
}

function LogoSvg({ brand, ...props }: { brand: Brand } & SVGProps<SVGSVGElement>) {
  switch (brand) {
    case 'google':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path fill="#4285f4" d="M21.35 12.27c0-.77-.07-1.51-.22-2.22H12v4.2h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.91-4.18 2.91-7.37Z" />
          <path fill="#34a853" d="M12 21.99c2.63 0 4.84-.87 6.45-2.35l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.99Z" />
          <path fill="#fbbc05" d="M6.54 14.08a5.86 5.86 0 0 1 0-3.72V7.83H3.3a9.99 9.99 0 0 0 0 8.78l3.24-2.53Z" />
          <path fill="#ea4335" d="M12 6.33c1.43 0 2.72.49 3.73 1.46l2.8-2.8C16.83 3.43 14.63 2.5 12 2.5a9.74 9.74 0 0 0-8.7 5.33l3.24 2.53C7.31 8.05 9.46 6.33 12 6.33Z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <defs>
            <linearGradient id="instagram-gradient" x1="0" x2="1" y1="1" y2="0">
              <stop stopColor="#feda75" />
              <stop offset=".45" stopColor="#d62976" />
              <stop offset="1" stopColor="#4f5bd5" />
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#instagram-gradient)" />
          <circle cx="12" cy="12" r="4.25" fill="none" stroke="white" strokeWidth="1.8" />
          <circle cx="17.25" cy="6.8" r="1.1" fill="white" />
        </svg>
      )
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path fill="#ff0033" d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.8 4.7 12 4.7 12 4.7s-5.8 0-7.6.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12a29 29 0 0 0 .4 4.8 2.8 2.8 0 0 0 2 2c1.8.5 7.6.5 7.6.5s5.8 0 7.6-.5a2.8 2.8 0 0 0 2-2A29 29 0 0 0 22 12a29 29 0 0 0-.4-4.8Z" />
          <path fill="white" d="m10 15.3 5.2-3.3L10 8.7v6.6Z" />
        </svg>
      )
    case 'facebook':
      return <svg viewBox="0 0 24 24" {...props}><circle cx="12" cy="12" r="10" fill="#1877f2" /><path fill="white" d="M13.4 20v-7h2.35l.35-2.72H13.4V8.55c0-.8.22-1.35 1.4-1.35h1.5V4.77c-.27-.04-1.18-.11-2.25-.11-2.22 0-3.74 1.36-3.74 3.86v1.76H7.8V13h2.51v7h3.09Z" /></svg>
    case 'linkedin':
      return <svg viewBox="0 0 24 24" {...props}><rect x="2" y="2" width="20" height="20" rx="3" fill="#0a66c2" /><path fill="white" d="M6.3 9.15h2.7V18H6.3V9.15ZM7.65 5A1.6 1.6 0 1 1 7.64 8.2 1.6 1.6 0 0 1 7.65 5ZM10.7 9.15h2.6v1.2h.04c.36-.69 1.24-1.42 2.55-1.42 2.73 0 3.24 1.8 3.24 4.14V18h-2.7v-4.36c0-1.04-.02-2.38-1.45-2.38-1.46 0-1.68 1.14-1.68 2.3V18h-2.6V9.15Z" /></svg>
    case 'x':
      return <svg viewBox="0 0 24 24" {...props}><path fill="currentColor" d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-6.4L6.47 22H3.36l7.24-8.28L2.8 2h6.4l4.42 5.84L18.9 2Zm-1.1 17.75h1.73L8.25 4.12H6.4L17.8 19.75Z" /></svg>
    case 'spotify':
      return <svg viewBox="0 0 24 24" {...props}><circle cx="12" cy="12" r="10" fill="#1db954" /><path fill="none" stroke="#111" strokeLinecap="round" strokeWidth="1.5" d="M7 10.2c3.4-1 6.9-.7 10 .7M7.7 13c2.8-.7 5.7-.4 8.2.7M8.6 15.6c2-.4 4-.2 5.7.4" /></svg>
    case 'whatsapp':
      return <svg viewBox="0 0 24 24" {...props}><circle cx="12" cy="12" r="10" fill="#25d366" /><path fill="none" stroke="white" strokeLinecap="round" strokeWidth="1.5" d="M8.3 17.2 9 14.8a5.1 5.1 0 1 1 2 1.7l-2.7.7Z" /><path fill="none" stroke="white" strokeLinecap="round" strokeWidth="1.3" d="M10 9.2c.2 1.4 1.2 2.5 2.5 3.1.5.2 1-.2 1.3-.6" /></svg>
    case 'apple':
      return <svg viewBox="0 0 24 24" {...props}><path fill="currentColor" d="M16.4 12.7c0-2 1.7-3 1.8-3.1-1-.1-2.1-1.1-3.7-1.1-1.5 0-2.7.9-3.4.9-.7 0-1.8-.9-3-.9-1.6 0-3.1 1-3.9 2.5-1.7 3-.4 7.4 1.2 9.6.8 1.1 1.7 2.3 2.9 2.2 1.2 0 1.6-.8 3-.8s1.8.8 3 .8c1.2 0 2-1.1 2.8-2.2.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.1-.8-2-3.2ZM14.2 7c.7-.9 1.1-2.1 1-3.3-1.1.1-2.4.7-3.1 1.6-.7.8-1.2 2-1 3.2 1.2.1 2.4-.6 3.1-1.5Z" /></svg>
    default:
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <text x="12" y="16" fill="white" fontSize="10" fontWeight="700" textAnchor="middle">
            {brand[0].toUpperCase()}
          </text>
        </svg>
      )
  }
}

export function BrandIcon({ brand, size = 22 }: { brand: Brand; size?: number }) {
  const style = { '--brand-color': BRAND_COLORS[brand] } as CSSProperties
  return (
    <span className="brand-icon inline-flex shrink-0 items-center justify-center" style={style} aria-hidden="true">
      <LogoSvg brand={brand} width={size} height={size} />
    </span>
  )
}
