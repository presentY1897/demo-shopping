'use client'

/**
 * 홈의 한 섹션 — 신상품 · 인기 상품 (TASK-0044 F1 · F2).
 *
 * **밀도는 몇 개를 보일지 정하고, 요청은 한 번뿐이다.** 가장 많은 단계의 개수를
 * 한 번 가져오고 화면이 잘라 낸다 — 단계를 바꿀 때마다 다시 요청하면 전환이
 * 느려지고 캐시가 세 벌이 된다. TASK-0040 F3 이 카드에 대해 내린 판단과 같다.
 *
 * 읽기는 **브라우저에서** 한다 — TASK-0101 F4 를 지키기 위해서다. `useSection` 이
 * 그 이유를 적어 두었다.
 *
 * 미니멀은 큰 이미지 소수, 맥시멀은 조밀한 다수 — 개수와 열 수가 함께 움직이므로
 * 세 단계의 인상이 실제로 달라진다.
 *
 * **가게를 눌러 둔 줄도 이 컴포넌트다** (TASK-0089 4.5). 「팔로우한 브랜드의 신상품」은
 * `sellerIds` 가 붙은 같은 검색이고, 다른 것은 어느 가게를 눌러 두었는가뿐이다 —
 * 줄 하나를 따로 만들면 밀도·빈 상태·「더 보기」가 두 벌이 된다.
 */

import type { SearchSort } from '@shopping/shared'
import { Button } from '@shopping/ui/components'
import { ProductGrid, ProductListSkeleton } from '@shopping/ui/catalog'
import type { DensityLevel } from '@shopping/ui'
import { useDensity } from '@shopping/ui/density'
import Link from 'next/link'

import { SearchHitCard } from '@/components/catalog/search-hit-card'
import { CardWishlistNotice } from '@/components/collections/card-wishlist-notice'
import { useCardWishlist } from '@/lib/collections/use-card-wishlist'
import { useSection } from '@/lib/products/use-section'
import type { HomeMessages } from '@/messages'

/** How many listings each step shows. The columns move with it (`ProductGrid`). */
export const SECTION_ITEMS: Readonly<Record<DensityLevel, number>> = { 1: 4, 2: 8, 3: 12 }

/** What the server fetches: enough for the largest step. */
export const SECTION_FETCH_LIMIT = SECTION_ITEMS[3]

export function ProductSection({
  title,
  sort,
  sellerIds,
  href,
  messages,
}: {
  readonly title: string
  readonly sort: SearchSort
  /** 눌러 둘 가게들. 비우면 카탈로그 전체다 (TASK-0089 4.6 — 목록 안은 OR). */
  readonly sellerIds?: readonly string[]
  /** Where 「더 보기」 goes — the same search, unbounded. */
  readonly href: string
  readonly messages: HomeMessages
}) {
  const { density } = useDensity()
  // 카드 열두 개가 함께 쓰는 핸들러 하나 (TASK-0086) — 세션과 라우터를 아는 판단은
  // 여기 한 벌이고, 하트가 눌렸는지는 카드가 직접 표에서 읽는다.
  const wishlist = useCardWishlist()
  const state = useSection(sort, SECTION_FETCH_LIMIT, sellerIds)
  const items = state.status === 'ready' ? state.items : []
  const shown = items.slice(0, SECTION_ITEMS[density])

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-fg text-lg font-semibold">{title}</h2>
        {items.length === 0 ? null : (
          <Link className="text-fg-muted text-sm underline-offset-2 hover:underline" href={href}>
            {messages.moreLabel}
          </Link>
        )}
      </div>

      {state.status === 'loading' ? (
        <ProductListSkeleton
          count={SECTION_ITEMS[density]}
          density={density}
          label={messages.loadingLabel}
        />
      ) : state.status === 'error' ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-fg-muted text-sm">{messages.sectionFailed}</p>
          <Button onClick={state.retry} size="sm" variant="outline">
            {messages.retryLabel}
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <p className="text-fg-subtle text-sm">{messages.sectionEmpty}</p>
      ) : (
        <>
          <CardWishlistNotice failed={wishlist.failed} />
          <ProductGrid density={density} label={messages.gridLabel.replace('{title}', title)}>
            {shown.map((hit) => (
              <li key={hit.id}>
                <SearchHitCard
                  density={density}
                  hit={hit}
                  labels={messages.card}
                  onWishlist={wishlist.toggle}
                />
              </li>
            ))}
          </ProductGrid>
        </>
      )}
    </section>
  )
}
