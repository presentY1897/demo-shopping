/**
 * ISR — 페이지가 내건 창과 요청이 보내는 창이 같은가 (TASK-0102 F6).
 *
 * **이 검사가 막는 실패는 조용하다.** 페이지가 `revalidate = 60` 을 내보내는데 그
 * 안의 요청이 `cache: 'no-store'` 를 보내면 페이지의 그 숫자는 **무력하다** — 아무것도
 * 캐시되지 않고 매 요청이 서버 렌더다. 경고도 없고 빌드 출력도 똑같다.
 *
 * 공용 클라이언트의 기본값이 `no-store` 인 것은 옳다: 그것이 나르는 것 대부분은 누군가의
 * 세션이거나 장바구니다. 그래서 캐시는 **옵트인**이고, 검사할 것은 상점의 페이지들이
 * 자기가 내건 숫자로 옵트인했는가다.
 */

import { describe, expect, it, vi } from 'vitest'

import { storefrontProductDetail } from '@shopping/api-mocks'

import {
  CATALOGUE_REVALIDATE_SECONDS,
  PRODUCT_REVALIDATE_SECONDS,
  SITEMAP_REVALIDATE_SECONDS,
} from '@/lib/seo/revalidate'

const detailCalls: { readonly revalidate?: number }[] = []

vi.mock('@/lib/products/detail-api', () => ({
  fetchProductDetail: vi.fn(async (_id: string, options: { revalidate?: number } = {}) => {
    detailCalls.push(options)

    const { storefrontProductDetail: fixture } = await import('@shopping/api-mocks')

    return fixture
  }),
}))

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const productPage = (await import('@/app/products/[id]/page')) as {
  revalidate?: number
  generateMetadata: (input: { params: Promise<{ id: string }> }) => Promise<unknown>
}

describe('상품 상세', () => {
  it('exports the window it caches for', () => {
    expect(productPage.revalidate).toBe(PRODUCT_REVALIDATE_SECONDS)
  })

  it('asks for that same window, so the export is not inert', async () => {
    detailCalls.length = 0

    await productPage.generateMetadata({
      params: Promise.resolve({ id: storefrontProductDetail.product.id }),
    })

    expect(detailCalls.length).toBeGreaterThan(0)
    expect(detailCalls.every((call) => call.revalidate === PRODUCT_REVALIDATE_SECONDS)).toBe(true)
  })
})

describe('그 밖의 캐시되는 라우트', () => {
  it('brand and sitemap export their own windows', async () => {
    const [brand, sitemapModule] = await Promise.all([
      import('@/app/brands/[sellerId]/page') as Promise<{ revalidate?: number }>,
      import('@/app/sitemap') as Promise<{ revalidate?: number }>,
    ])

    expect(brand.revalidate).toBe(CATALOGUE_REVALIDATE_SECONDS)
    expect(sitemapModule.revalidate).toBe(SITEMAP_REVALIDATE_SECONDS)
  })

  it('the home exports none — it caches nothing because it fetches nothing', async () => {
    // TASK-0101 F4: `HomePage()` awaits nothing, so there is nothing to
    // revalidate. A window here would be a claim about a read that never happens.
    const homeModule = (await import('@/app/page')) as { revalidate?: number }

    expect(homeModule.revalidate).toBeUndefined()
  })
})
