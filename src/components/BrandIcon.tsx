import type { CSSProperties, SVGProps } from 'react'
import type { IconType } from 'react-icons'
import { FaAmazon, FaSlack } from 'react-icons/fa6'
import {
  Si1Password,
  SiAirbnb,
  SiAnthropic,
  SiAtlassian,
  SiBinance,
  SiBitbucket,
  SiBitwarden,
  SiBluesky,
  SiBookingdotcom,
  SiCloudflare,
  SiCoinbase,
  SiDigitalocean,
  SiDiscord,
  SiDocker,
  SiDropbox,
  SiEbay,
  SiEpicgames,
  SiEtsy,
  SiFigma,
  SiGithub,
  SiGitlab,
  SiJira,
  SiLinear,
  SiMastodon,
  SiMedium,
  SiNetflix,
  SiNetlify,
  SiNotion,
  SiNpm,
  SiPaypal,
  SiPinterest,
  SiProton,
  SiReddit,
  SiRoblox,
  SiShopify,
  SiSignal,
  SiSnapchat,
  SiSoundcloud,
  SiStackoverflow,
  SiSteam,
  SiStripe,
  SiSubstack,
  SiSupabase,
  SiTelegram,
  SiThreads,
  SiTiktok,
  SiTwitch,
  SiUber,
  SiVercel,
  SiZoom,
} from 'react-icons/si'
import { hostOf } from '~/lib/vault'

export type Brand =
  | '1password'
  | 'airbnb'
  | 'amazon'
  | 'anthropic'
  | 'apple'
  | 'atlassian'
  | 'binance'
  | 'bitbucket'
  | 'bitwarden'
  | 'bluesky'
  | 'booking'
  | 'cloudflare'
  | 'coinbase'
  | 'digitalocean'
  | 'discord'
  | 'docker'
  | 'dropbox'
  | 'ebay'
  | 'epicgames'
  | 'etsy'
  | 'facebook'
  | 'figma'
  | 'github'
  | 'gitlab'
  | 'gmail'
  | 'google'
  | 'instagram'
  | 'jira'
  | 'linear'
  | 'linkedin'
  | 'mastodon'
  | 'medium'
  | 'microsoft'
  | 'netflix'
  | 'netlify'
  | 'notion'
  | 'npm'
  | 'paypal'
  | 'pinterest'
  | 'proton'
  | 'reddit'
  | 'roblox'
  | 'shopify'
  | 'signal'
  | 'slack'
  | 'snapchat'
  | 'soundcloud'
  | 'spotify'
  | 'stackoverflow'
  | 'steam'
  | 'stripe'
  | 'substack'
  | 'supabase'
  | 'telegram'
  | 'threads'
  | 'tiktok'
  | 'twitch'
  | 'uber'
  | 'vercel'
  | 'whatsapp'
  | 'x'
  | 'youtube'
  | 'zoom'

interface BrandDefinition {
  id: Brand
  domains: string[]
  aliases: string[]
}

// Gmail and Jira are intentionally listed before their parent brands so the
// more specific match wins for hosts such as mail.google.com and jira.example.
const BRANDS: BrandDefinition[] = [
  { id: 'gmail', domains: ['gmail.com', 'googlemail.com', 'mail.google.com'], aliases: ['gmail', 'google mail'] },
  {
    id: 'google',
    domains: ['google.com', 'google.co.uk', 'google.ca', 'google.de', 'google.fr', 'google.co.jp', 'google.com.au'],
    aliases: ['google', 'google workspace', 'google cloud', 'google drive', 'google photos'],
  },
  { id: 'youtube', domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], aliases: ['youtube'] },
  { id: 'instagram', domains: ['instagram.com', 'instagr.am'], aliases: ['instagram', 'insta'] },
  { id: 'facebook', domains: ['facebook.com', 'fb.com', 'messenger.com'], aliases: ['facebook', 'messenger', 'meta'] },
  { id: 'x', domains: ['x.com', 'twitter.com', 't.co'], aliases: ['x', 'twitter'] },
  { id: 'github', domains: ['github.com', 'github.io', 'githubusercontent.com'], aliases: ['github'] },
  {
    id: 'microsoft',
    domains: [
      'microsoft.com',
      'microsoftonline.com',
      'microsoft365.com',
      'live.com',
      'outlook.com',
      'office.com',
      'office.net',
      'office365.com',
      'sharepoint.com',
      'onedrive.com',
      'azure.com',
      'msn.com',
      'xbox.com',
      'bing.com',
      'skype.com',
    ],
    aliases: ['microsoft', 'outlook', 'office 365', 'microsoft 365', 'azure', 'xbox', 'skype', 'bing', 'hotmail'],
  },
  { id: 'apple', domains: ['apple.com', 'icloud.com', 'me.com'], aliases: ['apple', 'icloud', 'apple id'] },
  {
    id: 'amazon',
    domains: [
      'amazon.com',
      'amazon.co.uk',
      'amazon.ca',
      'amazon.de',
      'amazon.fr',
      'amazon.es',
      'amazon.it',
      'amazon.co.jp',
      'amazon.com.au',
      'amazon.in',
      'amazonaws.com',
      'audible.com',
    ],
    aliases: ['amazon', 'aws', 'audible', 'prime video'],
  },
  { id: 'netflix', domains: ['netflix.com'], aliases: ['netflix'] },
  { id: 'linkedin', domains: ['linkedin.com', 'lnkd.in'], aliases: ['linkedin'] },
  { id: 'reddit', domains: ['reddit.com', 'redd.it'], aliases: ['reddit'] },
  { id: 'discord', domains: ['discord.com', 'discordapp.com', 'discord.gg'], aliases: ['discord'] },
  { id: 'spotify', domains: ['spotify.com', 'spotify.link'], aliases: ['spotify'] },
  { id: 'slack', domains: ['slack.com', 'slack-edge.com'], aliases: ['slack'] },
  { id: 'whatsapp', domains: ['whatsapp.com', 'wa.me'], aliases: ['whatsapp'] },
  { id: 'tiktok', domains: ['tiktok.com', 'tiktokv.com'], aliases: ['tiktok', 'tik tok'] },
  { id: 'supabase', domains: ['supabase.com', 'supabase.co', 'supabase.io'], aliases: ['supabase'] },
  { id: 'linear', domains: ['linear.app', 'linear.com'], aliases: ['linear'] },
  { id: 'notion', domains: ['notion.so', 'notion.site', 'notion.com'], aliases: ['notion'] },
  { id: 'figma', domains: ['figma.com'], aliases: ['figma'] },
  { id: 'dropbox', domains: ['dropbox.com', 'dropboxusercontent.com'], aliases: ['dropbox'] },
  { id: 'jira', domains: ['jira.com', 'jira.atlassian.com'], aliases: ['jira'] },
  { id: 'atlassian', domains: ['atlassian.com', 'atlassian.net'], aliases: ['atlassian'] },
  { id: 'gitlab', domains: ['gitlab.com', 'gitlab.io'], aliases: ['gitlab'] },
  { id: 'bitbucket', domains: ['bitbucket.org'], aliases: ['bitbucket'] },
  { id: 'vercel', domains: ['vercel.com', 'vercel.app'], aliases: ['vercel'] },
  { id: 'netlify', domains: ['netlify.com', 'netlify.app'], aliases: ['netlify'] },
  { id: 'cloudflare', domains: ['cloudflare.com', 'cloudflareaccess.com', 'workers.dev', 'pages.dev'], aliases: ['cloudflare'] },
  { id: 'digitalocean', domains: ['digitalocean.com', 'do.co'], aliases: ['digitalocean', 'digital ocean'] },
  { id: 'stripe', domains: ['stripe.com'], aliases: ['stripe'] },
  { id: 'paypal', domains: ['paypal.com', 'paypal.me'], aliases: ['paypal'] },
  { id: 'shopify', domains: ['shopify.com', 'myshopify.com'], aliases: ['shopify'] },
  { id: 'zoom', domains: ['zoom.us', 'zoom.com'], aliases: ['zoom'] },
  { id: 'telegram', domains: ['telegram.org', 'telegram.me', 't.me'], aliases: ['telegram'] },
  { id: 'signal', domains: ['signal.org', 'signal.me'], aliases: ['signal'] },
  { id: 'proton', domains: ['proton.me', 'protonmail.com', 'protonvpn.com', 'proton.com'], aliases: ['proton', 'protonmail', 'proton mail', 'proton vpn'] },
  { id: 'anthropic', domains: ['anthropic.com', 'claude.ai'], aliases: ['anthropic', 'claude'] },
  { id: 'docker', domains: ['docker.com', 'docker.io'], aliases: ['docker'] },
  { id: 'npm', domains: ['npmjs.com', 'npmjs.org'], aliases: ['npm'] },
  { id: 'bitwarden', domains: ['bitwarden.com'], aliases: ['bitwarden'] },
  { id: '1password', domains: ['1password.com', '1password.ca', '1password.eu'], aliases: ['1password', '1 password'] },
  { id: 'twitch', domains: ['twitch.tv'], aliases: ['twitch'] },
  { id: 'steam', domains: ['steampowered.com', 'steamcommunity.com'], aliases: ['steam'] },
  { id: 'epicgames', domains: ['epicgames.com', 'unrealengine.com'], aliases: ['epic games', 'epicgames', 'unreal engine'] },
  { id: 'roblox', domains: ['roblox.com'], aliases: ['roblox'] },
  { id: 'coinbase', domains: ['coinbase.com'], aliases: ['coinbase'] },
  { id: 'binance', domains: ['binance.com'], aliases: ['binance'] },
  { id: 'etsy', domains: ['etsy.com'], aliases: ['etsy'] },
  { id: 'ebay', domains: ['ebay.com'], aliases: ['ebay'] },
  { id: 'airbnb', domains: ['airbnb.com'], aliases: ['airbnb'] },
  { id: 'uber', domains: ['uber.com'], aliases: ['uber'] },
  { id: 'booking', domains: ['booking.com'], aliases: ['booking', 'booking.com'] },
  { id: 'soundcloud', domains: ['soundcloud.com'], aliases: ['soundcloud'] },
  { id: 'pinterest', domains: ['pinterest.com', 'pin.it'], aliases: ['pinterest'] },
  { id: 'snapchat', domains: ['snapchat.com', 'snap.com'], aliases: ['snapchat'] },
  { id: 'threads', domains: ['threads.net', 'threads.com'], aliases: ['threads'] },
  { id: 'mastodon', domains: ['mastodon.social', 'joinmastodon.org'], aliases: ['mastodon'] },
  { id: 'bluesky', domains: ['bsky.app', 'blueskyweb.xyz'], aliases: ['bluesky', 'bsky'] },
  { id: 'stackoverflow', domains: ['stackoverflow.com'], aliases: ['stack overflow', 'stackoverflow'] },
  { id: 'medium', domains: ['medium.com'], aliases: ['medium'] },
  { id: 'substack', domains: ['substack.com'], aliases: ['substack'] },
]

interface BrandTheme {
  color: string
  dark: string
}

const BRAND_THEME: Record<Brand, BrandTheme> = {
  '1password': { color: '#1a8cff', dark: '#5eb1ff' },
  airbnb: { color: '#ff5a5f', dark: '#ff7a7f' },
  amazon: { color: '#ff9900', dark: '#ffb13b' },
  anthropic: { color: '#d97757', dark: '#e89a7d' },
  apple: { color: '#111827', dark: '#f5f5f7' },
  atlassian: { color: '#0052cc', dark: '#4c9aff' },
  binance: { color: '#c99400', dark: '#f3ba2f' },
  bitbucket: { color: '#0052cc', dark: '#4c9aff' },
  bitwarden: { color: '#175ddc', dark: '#6a9bff' },
  bluesky: { color: '#0285ff', dark: '#4aa8ff' },
  booking: { color: '#003580', dark: '#4a8bd9' },
  cloudflare: { color: '#f38020', dark: '#ff9a4d' },
  coinbase: { color: '#0052ff', dark: '#5c8dff' },
  digitalocean: { color: '#0080ff', dark: '#4aa8ff' },
  discord: { color: '#5865f2', dark: '#7b84ff' },
  docker: { color: '#2496ed', dark: '#5cb8ff' },
  dropbox: { color: '#0061ff', dark: '#4a8dff' },
  ebay: { color: '#e53238', dark: '#ff6b70' },
  epicgames: { color: '#313131', dark: '#f5f5f5' },
  etsy: { color: '#f16521', dark: '#ff8a4d' },
  facebook: { color: '#1877f2', dark: '#4a9bff' },
  figma: { color: '#f24e1e', dark: '#ff7a4d' },
  github: { color: '#24292f', dark: '#e6edf3' },
  gitlab: { color: '#fc6d26', dark: '#ff8f52' },
  gmail: { color: '#ea4335', dark: '#ff6b5e' },
  google: { color: '#4285f4', dark: '#6ba0ff' },
  instagram: { color: '#d946ef', dark: '#e879f9' },
  jira: { color: '#0052cc', dark: '#4c9aff' },
  linear: { color: '#5e6ad2', dark: '#8b96ff' },
  linkedin: { color: '#0a66c2', dark: '#4a9bff' },
  mastodon: { color: '#6364ff', dark: '#8b8bff' },
  medium: { color: '#111827', dark: '#f5f5f7' },
  microsoft: { color: '#f25022', dark: '#ff7a4d' },
  netflix: { color: '#e50914', dark: '#ff4d5a' },
  netlify: { color: '#00b3a4', dark: '#3ee0d2' },
  notion: { color: '#111827', dark: '#f5f5f7' },
  npm: { color: '#cb3837', dark: '#ff6b70' },
  paypal: { color: '#003087', dark: '#4a8bd9' },
  pinterest: { color: '#bd081c', dark: '#ff4d5a' },
  proton: { color: '#6d4aff', dark: '#9b7bff' },
  reddit: { color: '#ff4500', dark: '#ff7a4d' },
  roblox: { color: '#111827', dark: '#f5f5f7' },
  shopify: { color: '#7ab55c', dark: '#a8d95a' },
  signal: { color: '#3a76f0', dark: '#6b9bff' },
  slack: { color: '#611f69', dark: '#c084d0' },
  snapchat: { color: '#b8a900', dark: '#fffc00' },
  soundcloud: { color: '#ff5500', dark: '#ff8a4d' },
  spotify: { color: '#1db954', dark: '#3ee07a' },
  stackoverflow: { color: '#f58025', dark: '#ff9a4d' },
  steam: { color: '#111827', dark: '#f5f5f7' },
  stripe: { color: '#635bff', dark: '#8b84ff' },
  substack: { color: '#ff6719', dark: '#ff8a4d' },
  supabase: { color: '#1f9d68', dark: '#3ecf8e' },
  telegram: { color: '#26a5e4', dark: '#5cc8ff' },
  threads: { color: '#111827', dark: '#f5f5f7' },
  tiktok: { color: '#111827', dark: '#f5f5f7' },
  twitch: { color: '#9146ff', dark: '#b07aff' },
  uber: { color: '#111827', dark: '#f5f5f7' },
  vercel: { color: '#111827', dark: '#f5f5f7' },
  whatsapp: { color: '#25d366', dark: '#3ee07a' },
  x: { color: '#111827', dark: '#f5f5f7' },
  youtube: { color: '#ff0033', dark: '#ff4d6a' },
  zoom: { color: '#2d8cff', dark: '#5ca8ff' },
}

const BRAND_ICONS: Partial<Record<Brand, IconType>> = {
  '1password': Si1Password,
  airbnb: SiAirbnb,
  amazon: FaAmazon,
  anthropic: SiAnthropic,
  atlassian: SiAtlassian,
  binance: SiBinance,
  bitbucket: SiBitbucket,
  bitwarden: SiBitwarden,
  bluesky: SiBluesky,
  booking: SiBookingdotcom,
  cloudflare: SiCloudflare,
  coinbase: SiCoinbase,
  digitalocean: SiDigitalocean,
  discord: SiDiscord,
  docker: SiDocker,
  dropbox: SiDropbox,
  ebay: SiEbay,
  epicgames: SiEpicgames,
  etsy: SiEtsy,
  figma: SiFigma,
  github: SiGithub,
  gitlab: SiGitlab,
  jira: SiJira,
  linear: SiLinear,
  mastodon: SiMastodon,
  medium: SiMedium,
  netflix: SiNetflix,
  netlify: SiNetlify,
  notion: SiNotion,
  npm: SiNpm,
  paypal: SiPaypal,
  pinterest: SiPinterest,
  proton: SiProton,
  reddit: SiReddit,
  roblox: SiRoblox,
  shopify: SiShopify,
  signal: SiSignal,
  slack: FaSlack,
  snapchat: SiSnapchat,
  soundcloud: SiSoundcloud,
  stackoverflow: SiStackoverflow,
  steam: SiSteam,
  stripe: SiStripe,
  substack: SiSubstack,
  supabase: SiSupabase,
  telegram: SiTelegram,
  threads: SiThreads,
  tiktok: SiTiktok,
  twitch: SiTwitch,
  uber: SiUber,
  vercel: SiVercel,
  zoom: SiZoom,
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function containsWord(value: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(value)
}

export function brandForUrl(url: string | undefined): Brand | null {
  const host = hostOf(url)
  if (!host) return null
  return BRANDS.find((brand) => brand.domains.some((domain) => matchesDomain(host, domain)))?.id ?? null
}

export function brandForEntry(url: string | undefined, title: string): Brand | null {
  const fromUrl = brandForUrl(url)
  if (fromUrl) return fromUrl
  const normalizedTitle = title.trim().toLowerCase()
  if (!normalizedTitle) return null
  return (
    BRANDS.find((brand) => brand.aliases.some((alias) => containsWord(normalizedTitle, alias)))?.id ?? null
  )
}

export function brandCssVars(brand: Brand): CSSProperties {
  const theme = BRAND_THEME[brand]
  return {
    '--brand-color': theme.color,
    '--brand-color-dark': theme.dark,
  } as CSSProperties
}

function CustomLogo({ brand, ...props }: { brand: Brand } & SVGProps<SVGSVGElement>) {
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
    case 'gmail':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path fill="#4285f4" d="M2 6.6A2.6 2.6 0 0 1 4.6 4H6l6 4.5L18 4h1.4A2.6 2.6 0 0 1 22 6.6v10.8a2.6 2.6 0 0 1-2.6 2.6H18V9.3l-6 4.4-6-4.4v10.7H4.6A2.6 2.6 0 0 1 2 17.4V6.6Z" />
          <path fill="#ea4335" d="M2 6.6A2.6 2.6 0 0 1 4.6 4H6l6 4.5L18 4h1.4A2.6 2.6 0 0 1 22 6.6v1.2L12 15.6 2 7.8V6.6Z" />
          <path fill="#34a853" d="M2 17.4V9.4l6 4.4v6.2H4.6A2.6 2.6 0 0 1 2 17.4Z" />
          <path fill="#fbbc05" d="M22 17.4V9.4l-6 4.4v6.2h3.4a2.6 2.6 0 0 0 2.6-2.6Z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <defs>
            <linearGradient id="rook-instagram-gradient" x1="0" x2="1" y1="1" y2="0">
              <stop stopColor="#feda75" />
              <stop offset=".45" stopColor="#d62976" />
              <stop offset="1" stopColor="#4f5bd5" />
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="18" height="18" rx="5" fill="url(#rook-instagram-gradient)" />
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
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12" r="10" fill="#1877f2" />
          <path fill="white" d="M13.4 20v-7h2.35l.35-2.72H13.4V8.55c0-.8.22-1.35 1.4-1.35h1.5V4.77c-.27-.04-1.18-.11-2.25-.11-2.22 0-3.74 1.36-3.74 3.86v1.76H7.8V13h2.51v7h3.09Z" />
        </svg>
      )
    case 'linkedin':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <rect x="2" y="2" width="20" height="20" rx="3" fill="#0a66c2" />
          <path fill="white" d="M6.3 9.15h2.7V18H6.3V9.15ZM7.65 5A1.6 1.6 0 1 1 7.64 8.2 1.6 1.6 0 0 1 7.65 5ZM10.7 9.15h2.6v1.2h.04c.36-.69 1.24-1.42 2.55-1.42 2.73 0 3.24 1.8 3.24 4.14V18h-2.7v-4.36c0-1.04-.02-2.38-1.45-2.38-1.46 0-1.68 1.14-1.68 2.3V18h-2.6V9.15Z" />
        </svg>
      )
    case 'microsoft':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <rect x="2" y="2" width="9" height="9" fill="#f25022" />
          <rect x="13" y="2" width="9" height="9" fill="#7fba00" />
          <rect x="2" y="13" width="9" height="9" fill="#00a4ef" />
          <rect x="13" y="13" width="9" height="9" fill="#ffb900" />
        </svg>
      )
    case 'spotify':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12" r="10" fill="#1db954" />
          <path fill="none" stroke="#111" strokeLinecap="round" strokeWidth="1.5" d="M7 10.2c3.4-1 6.9-.7 10 .7M7.7 13c2.8-.7 5.7-.4 8.2.7M8.6 15.6c2-.4 4-.2 5.7.4" />
        </svg>
      )
    case 'whatsapp':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <circle cx="12" cy="12" r="10" fill="#25d366" />
          <path fill="none" stroke="white" strokeLinecap="round" strokeWidth="1.5" d="M8.3 17.2 9 14.8a5.1 5.1 0 1 1 2 1.7l-2.7.7Z" />
          <path fill="none" stroke="white" strokeLinecap="round" strokeWidth="1.3" d="M10 9.2c.2 1.4 1.2 2.5 2.5 3.1.5.2 1-.2 1.3-.6" />
        </svg>
      )
    case 'apple':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path fill="currentColor" d="M16.4 12.7c0-2 1.7-3 1.8-3.1-1-.1-2.1-1.1-3.7-1.1-1.5 0-2.7.9-3.4.9-.7 0-1.8-.9-3-.9-1.6 0-3.1 1-3.9 2.5-1.7 3-.4 7.4 1.2 9.6.8 1.1 1.7 2.3 2.9 2.2 1.2 0 1.6-.8 3-.8s1.8.8 3 .8c1.2 0 2-1.1 2.8-2.2.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.1-.8-2-3.2ZM14.2 7c.7-.9 1.1-2.1 1-3.3-1.1.1-2.4.7-3.1 1.6-.7.8-1.2 2-1 3.2 1.2.1 2.4-.6 3.1-1.5Z" />
        </svg>
      )
    case 'x':
      return (
        <svg viewBox="0 0 24 24" {...props}>
          <path fill="currentColor" d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-6.4L6.47 22H3.36l7.24-8.28L2.8 2h6.4l4.42 5.84L18.9 2Zm-1.1 17.75h1.73L8.25 4.12H6.4L17.8 19.75Z" />
        </svg>
      )
    default:
      return null
  }
}

export function BrandIcon({
  brand,
  size = 22,
  className,
}: {
  brand: Brand
  size?: number
  className?: string
}) {
  const Glyph = BRAND_ICONS[brand]
  return (
    <span
      className={`brand-icon inline-flex shrink-0 items-center justify-center${className ? ` ${className}` : ''}`}
      style={brandCssVars(brand)}
      aria-hidden="true"
    >
      {Glyph ? (
        <Glyph size={size} />
      ) : (
        <CustomLogo brand={brand} width={size} height={size} />
      )}
    </span>
  )
}
