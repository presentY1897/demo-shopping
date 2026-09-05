import { PageContainer } from '@shopping/ui/layout'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { CategoryShortcuts } from '@/components/home/category-shortcuts'
import { DemoInvite } from '@/components/home/demo-invite'
import { ProductSection } from '@/components/home/product-section'
import { messagesFor } from '@/messages'

/**
 * 홈 (TASK-0044).
 *
 * **This page still awaits nothing**, and that is not an accident of how it was
 * written — TASK-0101 F4 is a completed criterion that says so, measured
 * structurally: `HomePage()` returns markup rather than a promise, calling it
 * issues no request, and `/` prerenders as static. The reason is the cold start:
 * the API can take ninety seconds to wake and a server render would meet that
 * with a five second timeout, so a visitor would get a failure screen instead of
 * a page.
 *
 * So the sections read their own data after mount (`useSection`). The shell, the
 * hero and the category shortcuts are in the markup; the product rows arrive a
 * moment later, and `ApiWakeGate` is what explains the gap.
 *
 * TASK-0102 owns SEO. If the product rows have to be in the HTML for a crawler,
 * that is a change to TASK-0101 F4 and needs a decision, not a quiet rewrite of
 * this file.
 */
export default function HomePage() {
  const messages = messagesFor()
  const home = messages.home

  return (
    <PageContainer className="flex flex-col gap-8 py-6">
      {/*
        A text-first hero (R1). A large image here would be the LCP element on
        every first visit, and what this storefront has to say in its first
        sentence is what makes it different — which is text.
      */}
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{home.heroTitle}</h1>
        <p className="text-fg-muted">{home.heroBody}</p>
      </section>

      <DemoInvite messages={home.demo} />

      <CategoryShortcuts messages={home} />

      <ProductSection
        href="/search?sort=newest"
        messages={home}
        sort="newest"
        title={home.newTitle}
      />

      <ProductSection
        href="/search?sort=sales"
        messages={home}
        sort="sales"
        title={home.popularTitle}
      />

      {/*
        The cold-start panel stays (TASK-0101). It is what turns 「아직 비어 있는
        홈」 into 「깨우는 중입니다」.
      */}
      <section className="flex flex-col gap-3">
        <ApiWakeGate health={messages.health} wake={messages.wake} />
        <p className="text-fg-subtle text-sm">{messages.health.notice}</p>
      </section>
    </PageContainer>
  )
}
