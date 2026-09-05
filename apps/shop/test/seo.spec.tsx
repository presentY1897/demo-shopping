/**
 * SEO — 메타 규약 · robots · sitemap (TASK-0102 F3 · F4 · F5 · F8b · F9).
 *
 * **F8 은 Lighthouse 가 아니라 이 파일이다** (4.3). Lighthouse 의 SEO 감사는 사실상
 * 목록이고 — title 과 description 이 있는가, canonical 이 맞는가, `robots` 가 크롤을
 * 막고 있지는 않은가 — 전부 마크업에서 확인된다. 점수 대신 항목을 재면 실패했을 때
 * 「무엇이 빠졌는가」가 바로 나온다.
 */

import {
  storefrontCategoryTree,
  storefrontProductDetail,
  storefrontSeller,
} from '@shopping/api-mocks'
import { describe, expect, it, vi } from 'vitest'

import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { canonicalToMetadata, hiddenMetadata, indexedMetadata } from '@/lib/seo/page-metadata'
import { ogCard } from '@/lib/seo/og-image'
import { siteOrigin, siteUrl } from '@/lib/seo/site'
import { messagesFor } from '@/messages'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { generateMetadata: productMetadata } = await import('@/app/products/[id]/page')
const { generateMetadata: categoryMetadata } = await import('@/app/categories/[slug]/page')
const { generateMetadata: brandMetadata } = await import('@/app/brands/[sellerId]/page')
const { metadata: searchMetadata } = await import('@/app/search/page')

const product = storefrontProductDetail.product
const seller = storefrontSeller.seller

describe('F9 절대 URL', () => {
  it('names one origin, with no trailing slash', () => {
    expect(siteOrigin()).toMatch(/^https?:\/\/[^/]+$/)
    expect(siteUrl('/products/x')).toBe(`${siteOrigin()}/products/x`)
  })

  it('joins a path that forgot its leading slash', () => {
    expect(siteUrl('sitemap.xml')).toBe(`${siteOrigin()}/sitemap.xml`)
  })
})

describe('F8b 메타 규약', () => {
  it('gives an indexed page a canonical to itself', () => {
    const meta = indexedMetadata({ title: '제목', description: '설명', path: '/products/x' })

    expect(meta.alternates?.canonical).toBe('/products/x')
    expect(meta.robots).toBeUndefined()
    expect(meta.openGraph?.title).toBe('제목')
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image' })
  })

  it('points a filtered list at the plain URL', () => {
    const meta = canonicalToMetadata(
      { title: '코트', description: '설명', path: '/categories/coat?attr.fit=슬림' },
      '/categories/coat',
    )

    expect(meta.alternates?.canonical).toBe('/categories/coat')
  })

  it('hides a page without also telling a crawler to stop following it', () => {
    const meta = hiddenMetadata({ title: '검색', description: '설명' })

    // `noindex, follow`: the page is not worth indexing and the product links on
    // it are still worth crawling. And **no canonical** — 「색인하지 마라」와
    // 「신호를 저쪽으로 보내라」를 함께 걸면 저쪽까지 빠질 수 있다.
    expect(meta.robots).toEqual({ index: false, follow: true })
    expect(meta.alternates).toBeUndefined()
  })
})

describe('F4 · 화면별 메타데이터', () => {
  it('gives the product page a canonical to itself', async () => {
    const meta = await productMetadata({ params: Promise.resolve({ id: product.id }) })

    expect(meta.alternates?.canonical).toBe(`/products/${product.id}`)
    expect(meta.title).toContain(product.name)
  })

  it('gives the category page the filter-free canonical', async () => {
    const leaf = storefrontCategoryTree.nodes[0]!.children[0]!.children[0]!
    const meta = await categoryMetadata({ params: Promise.resolve({ slug: leaf.slug }) })

    expect(meta.alternates?.canonical).toBe(`/categories/${leaf.slug}`)
  })

  it('gives the brand page a canonical on the id, not the slug (4.2)', async () => {
    const meta = await brandMetadata({ params: Promise.resolve({ sellerId: seller.id }) })

    // Moving to `Seller.slug` would need redirects for links already shipped.
    expect(meta.alternates?.canonical).toBe(`/brands/${seller.id}`)
    expect(meta.alternates?.canonical).not.toContain(seller.slug)
  })

  it('marks the search screen noindex', () => {
    expect(searchMetadata.robots).toEqual({ index: false, follow: true })
  })
})

describe('F5 robots', () => {
  it('lets the catalogue be crawled and keeps the crawler out of one person’s pages', () => {
    const rules = robots()
    const first = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules

    expect(first?.allow).toBe('/')
    expect(first?.disallow).toContain('/mypage')

    // **`/search` is not disallowed.** A `noindex` on a page nobody may fetch is
    // never read, which leaves the page in an index it should have left.
    expect(first?.disallow).not.toContain('/search')
  })

  it('names the sitemap absolutely', () => {
    expect(robots().sitemap).toBe(siteUrl('/sitemap.xml'))
  })
})

describe('F3 sitemap', () => {
  it('carries the home, every category, the products and their brands', async () => {
    const entries = await sitemap()
    const urls = entries.map((entry) => entry.url)

    expect(urls).toContain(siteUrl('/'))
    expect(urls).toContain(siteUrl(`/categories/${storefrontCategoryTree.nodes[0]!.slug}`))
    // The whole tree, not only the roots: a leaf is the page a shopper lands on.
    const leaf = storefrontCategoryTree.nodes[0]!.children[0]!.children[0]!

    expect(urls).toContain(siteUrl(`/categories/${leaf.slug}`))
    expect(urls.some((url) => url.startsWith(siteUrl('/products/')))).toBe(true)
    expect(urls.some((url) => url.startsWith(siteUrl('/brands/')))).toBe(true)
  })

  it('is every URL absolute and on one origin (F9)', async () => {
    const entries = await sitemap()

    expect(entries.every((entry) => entry.url.startsWith(siteOrigin()))).toBe(true)
  })

  it('names each brand once, however many listings it has', async () => {
    const entries = await sitemap()
    const brands = entries.filter((entry) => entry.url.includes('/brands/'))

    expect(new Set(brands.map((entry) => entry.url)).size).toBe(brands.length)
  })
})

describe('F2 OG 카드', () => {
  it('quotes the cheapest orderable price, not the cheapest of all', () => {
    // 블랙·S is out of stock. An offer that included it would advertise a price
    // nobody can pay — the same rule the page's structured data follows.
    const card = ogCard(storefrontProductDetail)

    expect(card.name).toBe(product.name)
    expect(card.brandName).toBe(seller.brandName)
    expect(card.price).toContain('118,000')
    expect(card.imageUrl).toBe(product.images[0]?.url)
  })

  it('falls back to the whole list when nothing is orderable', () => {
    const soldOut = {
      ...storefrontProductDetail,
      product: {
        ...product,
        variants: product.variants.map((variant) => ({ ...variant, stock: 0 })),
      },
    }

    // A card that said nothing about the price would be worse than one that
    // said what the listing costs when it is back.
    expect(ogCard(soldOut).price).toContain('118,000')
  })
})

describe('앱 이름', () => {
  it('templates every page title under the storefront’s name', async () => {
    const layout = (await import('@/app/layout')) as {
      metadata: { title?: { template?: string }; metadataBase?: URL }
    }

    expect(layout.metadata.title?.template).toContain(messagesFor().app.name)
    // Without it, a relative canonical is emitted relative — which a crawler
    // reading the page out of a cache cannot resolve.
    expect(layout.metadata.metadataBase?.origin).toBe(siteOrigin())
  })
})
