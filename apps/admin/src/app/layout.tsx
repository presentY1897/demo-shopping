import { CONSOLE_DENSITY } from '@shopping/ui'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { AdminShell } from '@/components/layout/admin-shell'
import { DEFAULT_LOCALE, messagesFor } from '@/messages'

import './globals.css'

const messages = messagesFor()

export const metadata: Metadata = {
  title: {
    // Three consoles are open in three tabs during a demo (DECISIONS 2장), and
    // the tab strip is where you tell them apart before the favicon loads.
    default: messages.app.name,
    template: `%s · ${messages.app.name}`,
  },
  description: messages.app.description,
  // Console apps are never indexed (DECISIONS 1장).
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    // Pinned to the standard step and no toggle anywhere (D-033): an operations
    // screen wants the same information density every time, and a per-operator
    // setting is one more variable during a support call. The tokens are the
    // shared ones, so the console gets the design system without the choice.
    <html lang={DEFAULT_LOCALE} data-density={CONSOLE_DENSITY}>
      <body className="bg-surface text-fg antialiased">
        <AdminShell messages={messages.layout}>{children}</AdminShell>
      </body>
    </html>
  )
}
