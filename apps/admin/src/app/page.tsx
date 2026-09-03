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
 * server render to go stale and the shell can be prerendered.
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
        production (see app/components/page.tsx), so the way in is too.
      */}
      {process.env.NODE_ENV === 'production' ? null : (
        <a className="text-primary min-h-touch text-sm underline" href="/components">
          {messages.components.linkLabel}
        </a>
      )}
    </main>
  )
}
