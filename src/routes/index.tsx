import { createFileRoute } from '@tanstack/react-router'
import { LockScreen } from '~/components/LockScreen'
import { VaultApp } from '~/components/VaultApp'
import { RookMark } from '~/components/RookMark'
import { useVault } from '~/lib/vault-context'

export const Route = createFileRoute('/')({
  component: Home,
})

function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-[10px] border border-line bg-white text-[#0a0b0e] shadow-rest">
          <RookMark className="size-[20px]" />
        </div>
        <span className="text-[12px] text-muted">Opening Rook…</span>
      </div>
    </div>
  )
}

function Gate() {
  const { status } = useVault()
  if (status === 'booting') return <BootScreen />
  if (status === 'locked') return <LockScreen />
  return <VaultApp />
}

function Home() {
  return <Gate />
}
