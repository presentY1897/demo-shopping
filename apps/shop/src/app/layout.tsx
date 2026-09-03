import { DEFAULT_DENSITY } from '@shopping/ui'
import { DensityProvider, DensityScript } from '@shopping/ui/density'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { DEFAULT_LOCALE, messagesFor } from '@/messages'

import './globals.css'

const messages = messagesFor()

export const metadata: Metadata = {
  title: messages.app.name,
  description: messages.app.description,
}

/**
 * The density a signed-in shopper stored on the server.
 *
 * **M04 seam.** `UserPreference` does not exist yet, so every visitor is
 * anonymous and the value comes from localStorage. When accounts land this
 * becomes an awaited read of the session, and the same number flows to both the
 * boot script and the provider — the two places that have to agree for the first
 * paint to be right.
 */
function serverDensity(): null {
  return null
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  const initial = serverDensity()

  return (
    // `suppressHydrationWarning` covers exactly one thing: `DensityScript`
    // rewrites `data-density` on this element before React hydrates, so the
    // attribute the client sees is legitimately not the one the server sent. It
    // is scoped to this element's own attributes and hides nothing below it.
    <html lang={DEFAULT_LOCALE} data-density={initial ?? DEFAULT_DENSITY} suppressHydrationWarning>
      <body className="bg-surface text-fg min-h-dvh antialiased">
        {/*
          First child of <body> so it runs while the parser is still above the
          content — the correction lands before anything is painted. An effect
          would run after paint and the visitor would watch the page reflow on
          every navigation.
        */}
        <DensityScript serverDensity={initial} />
        <DensityProvider serverDensity={initial}>{children}</DensityProvider>
      </body>
    </html>
  )
}
