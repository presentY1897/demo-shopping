import { Card, Grid } from '@shopping/ui/components'
import { PageContainer } from '@shopping/ui/layout'

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
 * **It is also why the density is not read from a cookie** (TASK-0018 4.1): a
 * cookie would put this page back on the dynamic path and undo exactly that.
 *
 * The real home screen — recommendations, new arrivals, brand rows — is
 * TASK-0044. What is here is the layout, the density preview it needs to be
 * checked against, and the cold-start panel this page has carried since
 * TASK-0101.
 */
export default function HomePage() {
  const messages = messagesFor()
  const home = messages.home

  return (
    <PageContainer className="flex flex-col gap-8 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{home.title}</h1>
        <p className="text-fg-muted">{home.description}</p>
      </header>

      <section className="flex flex-col gap-3">
        <ApiWakeGate health={messages.health} wake={messages.wake} />
        <p className="text-fg-subtle text-sm">{messages.health.notice}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{home.previewTitle}</h2>
        <p className="text-fg-muted text-sm">{home.previewDescription}</p>

        {/*
          `columns="density"` reads `--density-cols`, so this grid is 1 / 2 / 3
          columns at minimal and 2 / 4 / 6 at maximal without a breakpoint
          written here. It is what F5 — three steps × three viewports — is
          checked against until real product cards arrive in TASK-0040.
        */}
        <Grid as="ul" columns="density" gap="md">
          {home.previewItems.map((name) => (
            <Card as="li" key={name} variant="outline">
              <div
                aria-hidden="true"
                className="bg-surface-muted text-fg-subtle flex aspect-square w-full items-center justify-center text-xs"
              >
                {home.previewImageLabel}
              </div>
              <p className="text-fg text-sm font-medium">{name}</p>
              <p className="text-fg-subtle text-xs">{home.previewPriceLabel}</p>
            </Card>
          ))}
        </Grid>
      </section>

      {/*
        The component gallery is a development tool and is not served in
        production (see app/components/page.tsx), so the way in is too. Without a
        link it is a page only whoever wrote it knows the URL of.
      */}
      {process.env.NODE_ENV === 'production' ? null : (
        <nav className="flex flex-col gap-1">
          <a className="text-primary min-h-touch text-sm underline" href="/components">
            {messages.components.linkLabel}
          </a>
        </nav>
      )}
    </PageContainer>
  )
}
