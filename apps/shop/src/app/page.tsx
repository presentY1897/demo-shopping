import { PageContainer } from '@shopping/ui/layout'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { RecentlyViewedStrip } from '@/components/collections/recently-viewed-strip'
import { CategoryShortcuts } from '@/components/home/category-shortcuts'
import { DemoInvite } from '@/components/home/demo-invite'
import { FollowedBrandSection } from '@/components/home/followed-brand-section'
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
        팔로우한 브랜드의 신상품 (TASK-0089 F6). 이 페이지가 아무것도 기다리지
        않는다는 성질을 지킨다 — 팔로우 목록도 상품도 마운트 뒤에 읽는다.
        **로그인하지 않았거나 팔로우한 곳이 없으면 아무것도 그리지 않으므로**,
        조건이 맞지 않는 사람의 홈에 빈 상자가 늘지 않는다.
      */}
      <FollowedBrandSection messages={home} />

      {/*
        최근 본 상품 (TASK-0087). 이 페이지가 아무것도 기다리지 않는다는 성질을
        지킨다 — 스트립은 클라이언트 컴포넌트이고, 로그인하지 않은 사람에게는
        브라우저의 이력을, 로그인한 사람에게는 마운트 뒤에 받은 것을 그린다.
        **비어 있으면 아무것도 그리지 않으므로** 처음 온 사람의 홈에 빈 상자가
        늘지 않는다.
      */}
      <RecentlyViewedStrip copy={messages.collections.recent} />

      {/*
        The cold-start panel stays (TASK-0101). It is what turns 「아직 비어 있는
        홈」 into 「깨우는 중입니다」.
      */}
      {/*
        **자리를 미리 잡아 둔다.** 이 패널은 「깨우는 중」에서 「준비됐다」로 바뀌며
        높이가 변하는데, 자리를 안 잡아 두면 그 순간 아래가 밀린다 — Lighthouse 가
        홈에서 잰 레이아웃 이동 0.255 가 전부 이 한 번이었다.

        비어 보이는 자리를 남기는 것보다 낫다: 이동은 **읽고 있던 사람의 눈이 따라가야
        하는** 사고이고, 여백은 잠깐 비어 있을 뿐이다.
      */}
      <section className="flex min-h-64 flex-col gap-3">
        <ApiWakeGate health={messages.health} wake={messages.wake} />
        <p className="text-fg-subtle text-sm">{messages.health.notice}</p>
      </section>
    </PageContainer>
  )
}
