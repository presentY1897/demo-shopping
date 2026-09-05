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
 */

import type { SearchSort } from '@shopping/shared'
import { ProductCard, ProductGrid, ProductListSkeleton } from '@shopping/ui/catalog'
import type { DensityLevel } from '@shopping/ui'
import { useDensity } from '@shopping/ui/density'
import Link from 'next/link'

import { useSection } from '@/lib/products/use-section'
import type { HomeMessages } from '@/messages'

/** How many listings each step shows. The columns move with it (`ProductGrid`). */
export const SECTION_ITEMS: Readonly<Record<DensityLevel, number>> = { 1: 4, 2: 8, 3: 12 }

/** What the server fetches: enough for the largest step. */
export const SECTION_FETCH_LIMIT = SECTION_ITEMS[3]

export function ProductSection({
  title,
  sort,
  href,
  messages,
}: {
  readonly title: string
  readonly sort: SearchSort
  /** Where 「더 보기」 goes — the same search, unbounded. */
  readonly href: string
  readonly messages: HomeMessages
}) {
  const { density } = useDensity()
  const state = useSection(sort, SECTION_FETCH_LIMIT)
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
        <ProductListSkeleton density={density} label={messages.loadingLabel} />
      ) : shown.length === 0 ? (
        <p className="text-fg-subtle text-sm">{messages.sectionEmpty}</p>
      ) : (
        <ProductGrid density={density} label={messages.gridLabel.replace('{title}', title)}>
          {shown.map((hit) => (
            <li key={hit.id}>
              <ProductCard
                density={density}
                href={`/products/${hit.id}`}
                labels={messages.card}
                product={{
                  id: hit.id,
                  name: hit.name,
                  brandName: hit.brandName,
                  price: hit.price,
                  imageUrl: hit.thumbnailUrl,
                  ratingAvg: hit.ratingAvg,
                  ratingCount: hit.ratingCount,
                  salesCount: hit.salesCount,
                  inStock: hit.inStock,
                }}
              />
            </li>
          ))}
        </ProductGrid>
      )}
    </section>
  )
}
