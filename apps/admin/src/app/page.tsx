import { HealthPanel } from '@/components/health-panel'
import { loadHealth } from '@/lib/health'
import { messagesFor } from '@/messages'

/**
 * Never prerendered: the panel reports the state of a live dependency, and a
 * build time snapshot of it would be a lie the moment it is served.
 */
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const messages = messagesFor()
  const result = await loadHealth()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <header>
        <h1 className="text-2xl font-bold text-app-accent">{messages.app.name}</h1>
        <p className="mt-1 text-black/60">{messages.app.description}</p>
      </header>

      <HealthPanel result={result} messages={messages} />

      <p className="text-sm text-black/50">{messages.health.notice}</p>
    </main>
  )
}
