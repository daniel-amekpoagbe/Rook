import { createFileRoute } from '@tanstack/react-router'
import { ShareView } from '~/components/ShareView'

export const Route = createFileRoute('/share/$shareId')({
  head: () => ({
    meta: [{ title: 'Shared password — Rook' }],
  }),
  component: SharePage,
})

function SharePage() {
  const { shareId } = Route.useParams()
  return <ShareView shareId={shareId} />
}
