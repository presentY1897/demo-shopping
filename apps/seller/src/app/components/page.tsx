import { ComponentGallery } from '@shopping/ui/preview'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { messagesFor } from '@/messages'

/**
 * The base component gallery — a development tool.
 *
 * **Not served in production**, on the same reasoning as `/tokens`: this app is
 * a storefront (or a console), not a component catalogue, and the sanctioned
 * showcase is Storybook (TASK-0104). The route still compiles, typechecks and
 * builds everywhere — only the response differs — so it cannot rot unnoticed the
 * way a page excluded from the build would.
 *
 * All three apps render the same `ComponentGallery` from `@shopping/ui`, which
 * is what makes this page evidence for TASK-0015 F5: the only difference
 * between the three screens is the accent token each app overrides.
 */
export const dynamic = 'force-dynamic'

const ENABLED = process.env.NODE_ENV !== 'production'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function ComponentsPage() {
  if (!ENABLED) notFound()

  return <ComponentGallery messages={messagesFor().components} />
}
