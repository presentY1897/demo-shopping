/**
 * The footer.
 *
 * Deliberately without a link list. Every destination a storefront footer
 * normally carries — 이용약관, 고객센터, 회사소개 — belongs to a milestone that
 * has not run yet, and a column of links that all resolve to the same "준비 중"
 * screen is worse than none: it is six dead tab stops on every page (P4).
 *
 * What it does carry is the two things a visitor needs to know about this site:
 * that it is a demo with invented brands, and that the display density is
 * theirs to change. The second is the whole point of the header control, and a
 * one-line explanation somewhere permanent is what makes it discoverable after
 * the first-visit hint is gone.
 *
 * Server-renderable: no hook, no browser API.
 */

import { PageContainer } from '@shopping/ui/layout'

import type { FooterMessages } from '@/messages'

export function ShopFooter({
  brand,
  messages,
}: {
  readonly brand: string
  readonly messages: FooterMessages
}) {
  return (
    <footer aria-label={messages.label} className="border-border bg-surface-sunken mt-12 border-t">
      <PageContainer className="flex flex-col gap-6 py-8">
        <p className="text-fg text-base font-bold">{brand}</p>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="flex flex-col gap-1">
            <h2 className="text-fg text-sm font-medium">{messages.demoTitle}</h2>
            <p className="text-fg-muted text-sm">{messages.demoBody}</p>
          </section>

          <section className="flex flex-col gap-1">
            <h2 className="text-fg text-sm font-medium">{messages.densityTitle}</h2>
            <p className="text-fg-muted text-sm">{messages.densityBody}</p>
          </section>
        </div>

        <p className="text-fg-subtle text-xs">{messages.copyright}</p>
      </PageContainer>
    </footer>
  )
}
