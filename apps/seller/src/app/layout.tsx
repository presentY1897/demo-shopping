import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { DEFAULT_LOCALE, messagesFor } from '@/messages'

import './globals.css'

const messages = messagesFor()

export const metadata: Metadata = {
  title: messages.app.name,
  description: messages.app.description,
  // Console apps are never indexed (DECISIONS 1장).
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE}>
      <body className="min-h-dvh bg-white text-black antialiased">{children}</body>
    </html>
  )
}
