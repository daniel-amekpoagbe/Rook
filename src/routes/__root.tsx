/// <reference types="vite/client" />
import { HeadContent, Scripts, createRootRoute, type ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import '~/styles/app.css'
import { Icon } from '~/components/ui'
import { VaultProvider } from '~/lib/vault-context'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Rook — encrypted personal vault' },
      {
        name: 'description',
        content: 'A zero-knowledge password manager: Argon2id + XChaCha20-Poly1305, encrypted on your device.',
      },
      { name: 'theme-color', content: '#f4f5f7' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
    links: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  }),
  errorComponent: RootError,
  shellComponent: RootDocument,
})

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('rook.theme')||localStorage.getItem('keynest.theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;try{localStorage.setItem('rook.theme',t)}catch(e){}}}catch(e){}})();`

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-10">
      <div className="w-full max-w-[420px] rounded-xl border border-line bg-surface p-6 text-center shadow-rest">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl border border-danger/20 bg-danger-soft text-danger">
          <Icon name="alert" size={20} />
        </span>
        <h1 className="mt-4 text-[18px] font-semibold tracking-[-0.015em]">Something went wrong</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          The interface stopped rendering. Your encrypted vault is still safe on the server.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
        <details className="mt-5 text-left">
          <summary className="cursor-pointer text-[11px] text-faint hover:text-ink">Technical details</summary>
          <pre className="mt-2 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[10.5px] whitespace-pre-wrap text-muted">
            {error instanceof Error ? error.message : String(error)}
          </pre>
        </details>
      </div>
    </div>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <VaultProvider>{children}</VaultProvider>
        <Scripts />
      </body>
    </html>
  )
}
