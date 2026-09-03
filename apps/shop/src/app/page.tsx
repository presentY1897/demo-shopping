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
        <h1 className="text-primary text-2xl font-bold">{messages.app.name}</h1>
        <p className="text-fg-muted mt-1">{messages.app.description}</p>
      </header>

      <HealthPanel result={result} messages={messages} />

      <p className="text-fg-subtle text-sm">{messages.health.notice}</p>

      {/*
        The component gallery is a development tool and is not served in
        production (see app/components/page.tsx), so the way in is too. Without a
        link it is a page only whoever wrote it knows the URL of.

        The design token preview that used to sit beside it is gone: Storybook
        took the job over in TASK-0104, and `pnpm storybook` is where the tokens
        are now read (D-206).
      */}
      {process.env.NODE_ENV === 'production' ? null : (
        <nav className="flex flex-col gap-1">
          <a className="text-primary min-h-touch text-sm underline" href="/components">
            {messages.components.linkLabel}
          </a>
        </nav>
      )}
    </main>
  )
}
