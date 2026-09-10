'use client'

import Image from 'next/image'
import type { SearchHit } from '@shopping/shared'
import { DENSITY_GRID_COLUMNS, DENSITY_VIEWPORT_MIN_WIDTH, type DensityLevel } from '@shopping/ui'
import { ProductCard } from '@shopping/ui/catalog'
import type { ProductCardLabels } from '@shopping/ui/catalog'

import { useWishlisted } from '@/lib/collections/wishlist-state'

/**
 * 검색 결과 한 줄을 카드로 (TASK-0086 4.6).
 *
 * ## 왜 카드 하나에 컴포넌트가 하나 더 필요한가
 *
 * 하트가 눌린 상태를 그리려면 **카드마다** 「이 상품을 찜했나」를 읽어야 하는데,
 * 그것은 훅이고 훅은 `map` 안에서 부를 수 없다. 그래서 격자의 한 칸이 컴포넌트가
 * 된다 — 그 덕분에 하트 하나가 바뀔 때 다시 그려지는 것도 그 칸뿐이다.
 *
 * 홈의 섹션과 검색·카테고리·브랜드관의 목록이 **같은 이 컴포넌트**를 쓴다. 검색
 * 결과를 카드 프롭으로 옮기는 일이 두 군데에 각각 적혀 있으면, 필드가 하나 늘 때
 * 한쪽만 고쳐진 날 두 화면이 다른 카드를 그린다.
 *
 * ## `null` 과 `undefined`
 *
 * 표는 「모른다」를 `null` 로 말하고 카드는 `undefined` 로 받는다 — 카드에게 그것은
 * 「이 프롭이 없다」이고, 없으면 `aria-pressed` 자체가 붙지 않는다. 셋(담김 · 안 담김
 * · 모름)을 둘로 접으면 담아 둔 카드의 하트가 새로고침마다 한 번씩 비었다가 찬다.
 */
export function SearchHitCard({
  hit,
  density,
  labels,
  onWishlist,
  priority = false,
}: {
  readonly priority?: boolean
  readonly hit: SearchHit
  readonly density: DensityLevel
  readonly labels: ProductCardLabels
  readonly onWishlist: (productId: string) => void
}) {
  const columns = DENSITY_GRID_COLUMNS[density]
  const sizes = `(max-width: ${DENSITY_VIEWPORT_MIN_WIDTH.md - 1}px) ${100 / columns.base}vw, (max-width: ${DENSITY_VIEWPORT_MIN_WIDTH.xl - 1}px) ${100 / columns.md}vw, ${Math.ceil(DENSITY_VIEWPORT_MIN_WIDTH.xl / columns.xl)}px`
  const wishlisted = useWishlisted(hit.id)

  return (
    <ProductCard
      renderImage={({ src, alt }) => (
        <Image
          src={src}
          alt={alt}
          fill
          className="object-cover"
          sizes={sizes}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          unoptimized={!src.startsWith('https://cdn.demo-shopping.com/products/')}
        />
      )}
      density={density}
      href={`/products/${hit.id}`}
      labels={labels}
      onWishlist={onWishlist}
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
      wishlisted={wishlisted ?? undefined}
    />
  )
}
