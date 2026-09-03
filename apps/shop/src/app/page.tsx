import { ApiWakeGate } from '@/components/api-wake-gate'
import { messagesFor } from '@/messages'

/**
 * Static. This page awaits nothing.
 *
 * It used to be `force-dynamic` because it read a live dependency on the server,
 * which meant every visitor waited for the API before receiving any markup at
 * all — and on a cold instance that wait ends in a timeout, not a page
 * (TASK-0101 4.3).
 *
 * The liveness read now happens in the browser, so there is no live value in the
 * server render to go stale and the shell can be prerendered. That is what makes
 * the header and the skeleton appear immediately while the API is still booting.
 */
export default function HomePage() {
  const messages = messagesFor()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-8">
      <header>
        <h1 className="text-primary text-2xl font-bold">{messages.app.name}</h1>
        <p className="text-fg-muted mt-1">{messages.app.description}</p>
      </header>

      <ApiWakeGate health={messages.health} wake={messages.wake} />

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
