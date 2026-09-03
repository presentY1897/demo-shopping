import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { messagesFor } from '@/messages'

import { TokenPreview } from './token-preview'

/**
 * Design token preview — a development tool.
 *
 * **Not served in production, on purpose.** `apps/shop` is the one app that is
 * indexed (DECISIONS 1장) and it is a storefront; a page of swatches is not a
 * storefront page, and the sanctioned public showcase of the component system is
 * Storybook (TASK-0104). The route still compiles, typechecks and builds in
 * every environment — only the response differs — so it cannot rot unnoticed the
 * way a page excluded from the build would.
 */
export const dynamic = 'force-dynamic'

const ENABLED = process.env.NODE_ENV !== 'production'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function TokensPage() {
  if (!ENABLED) notFound()

  const messages = messagesFor()

  return <TokenPreview messages={messages.tokens} />
}
