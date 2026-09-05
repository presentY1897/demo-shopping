import { DEFAULT_DENSITY } from '@shopping/ui'
import { DensityScript } from '@shopping/ui/density'
import { SkipLink } from '@shopping/ui/layout'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { AuthProvider } from '@/lib/auth/auth-context'

import { DemoBanner } from '@/components/demo/demo-banner'
import { AccountDensityProvider } from '@/components/layout/account-density-provider'
import { ShopFooter } from '@/components/layout/shop-footer'
import { ShopHeader } from '@/components/layout/shop-header'
import { metadataBase } from '@/lib/seo/site'
import { DEFAULT_LOCALE, messagesFor } from '@/messages'

import './globals.css'

const messages = messagesFor()

export const metadata: Metadata = {
  /**
   * Every relative `alternates.canonical` and every relative OG image below is
   * resolved against this (TASK-0102). Without it Next emits them relative,
   * which a crawler reading the page from a cache or a feed cannot resolve.
   */
  metadataBase: metadataBase(),
  title: {
    default: messages.app.name,
    template: `%s · ${messages.app.name}`,
  },
  description: messages.app.description,
}

/**
 * The density the *server* renders, which is still nothing.
 *
 * **The M04 seam closed on the client, not here** (TASK-0112). Reading the
 * account server side would mean reading the session cookie, and a page that
 * reads a cookie drops out of static rendering — which is the one thing
 * `docs/design/pages.md` refuses for this app, because the storefront's static
 * home page is all a visitor sees during a cold start of up to 90 seconds
 * (TASK-0101). So the boot script paints what localStorage holds, and
 * `AccountDensityProvider` reconciles it with the account a moment later.
 */
function serverDensity(): null {
  return null
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  const initial = serverDensity()
  const layout = messages.layout

  return (
    // `suppressHydrationWarning` covers exactly one thing: `DensityScript`
    // rewrites `data-density` on this element before React hydrates, so the
    // attribute the client sees is legitimately not the one the server sent. It
    // is scoped to this element's own attributes and hides nothing below it.
    <html lang={DEFAULT_LOCALE} data-density={initial ?? DEFAULT_DENSITY} suppressHydrationWarning>
      <body className="bg-surface text-fg flex min-h-dvh flex-col antialiased">
        {/*
          First child of <body> so it runs while the parser is still above the
          content — the correction lands before anything is painted. An effect
          would run after paint and the visitor would watch the page reflow on
          every navigation.
        */}
        <DensityScript serverDensity={initial} />

        {/*
          Above the shell, because the header's account menu reads it and so does
          every screen inside `main`. One renewal on boot serves all of them
          (TASK-0023 4장).
        */}
        <AuthProvider>
          {/*
            Above the shell and outside `main`, so it is the first thing after
            the session is known and is present on every route — including
            `/login`, where somebody who just issued an account lands.
          */}
          <DemoBanner messages={messages.demo} />

          <AccountDensityProvider>
            <SkipLink href="#main">{layout.skipToContent}</SkipLink>

            <ShopHeader brand={messages.app.name} messages={layout} />

            {/*
            `tabIndex={-1}` is what makes the skip link work: without it the
            fragment moves the scroll position but not the focus, and the next
            Tab goes back to the header the visitor just skipped.
          */}
            <main className="flex-1" id="main" tabIndex={-1}>
              {children}
            </main>

            <ShopFooter brand={messages.app.name} messages={layout.footer} />
          </AccountDensityProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
