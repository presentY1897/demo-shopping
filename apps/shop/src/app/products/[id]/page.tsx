import { ApiClientError } from '@shopping/shared'
import { formatMoney } from '@shopping/ui/format'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ProductDetail } from '@/components/products/product-detail'
import { fetchProductDetail } from '@/lib/products/detail-api'
import { PRODUCT_REVALIDATE_SECONDS } from '@/lib/seo/revalidate'
import { indexedMetadata } from '@/lib/seo/page-metadata'
import { messagesFor } from '@/messages'

/**
 * 상품 상세 (TASK-0043).
 *
 * **Server rendered.** `docs/design/pages.md` has this page indexed with ISR;
 * the tree is read with the public client — no session, because
 * `GET /products/:id/detail` needs none (4.1) — so the render needs nothing from
 * the browser.
 *
 * A 404 from the API becomes a 404 here. That covers three cases the API
 * deliberately does not tell apart — a draft, a suspended listing and an id that
 * never existed — and this page must not tell them apart either.
 */

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

/**
 * ISR (TASK-0102 4장 · F6).
 *
 * Price and stock move, but rendering on every request puts the cold start in
 * front of every visitor. Sixty seconds of staleness is the trade the design
 * names — and R2's other half covers it: the screen re-reads the listing after
 * mount, so what a shopper is about to buy is never a minute old.
 */
/**
 * Next requires this to be a **literal** — an imported constant is rejected with
 * 「Invalid segment configuration export」. So the number is written twice, and
 * `isr-window.spec.ts` is what keeps the two equal: the page's literal is
 * compared against {@link PRODUCT_REVALIDATE_SECONDS}, which is the value the fetch below asks for.
 */
export const revalidate = 60

async function load(id: string) {
  try {
    // The same window the segment exports. Two numbers that must agree and
    // live apart is how a page ends up caching nothing while claiming to.
    return await fetchProductDetail(id, { revalidate: PRODUCT_REVALIDATE_SECONDS })
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound()

    throw error
  }
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const copy = messagesFor().productDetail
  const { product, seller } = await load(id)

  return indexedMetadata({
    title: copy.metaTitle.replace('{name}', product.name),
    description: copy.metaDescription
      .replace('{brand}', seller.brandName)
      .replace('{name}', product.name),
    path: `/products/${product.id}`,
  })
}

export default async function ProductPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const messages = messagesFor()
  const detail = await load(id)
  const { product, seller } = detail

  const orderable = product.variants.filter(
    (variant) => variant.isActive && variant.availableStock > 0,
  )

  /**
   * `Product` with an `AggregateOffer` (F7).
   *
   * The price range comes from the variants that are **orderable**, because that
   * is what the offer is: a range including a sold-out SKU promises a price
   * nobody can pay. `availability` follows the same rule, so the two cannot
   * disagree.
   *
   * No `aggregateRating` when there are no reviews. Google rejects a rating with
   * a zero count, and a `0` here would be a claim the page does not make.
   */
  const prices = orderable.map((variant) => variant.price)
  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    ...(product.description === null ? {} : { description: product.description }),
    ...(product.images[0] === undefined ? {} : { image: product.images.map((image) => image.url) }),
    brand: { '@type': 'Brand', name: seller.brandName },
    ...(product.ratingCount === 0
      ? {}
      : {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.ratingAvg / 100,
            reviewCount: product.ratingCount,
          },
        }),
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: CURRENCY,
      offerCount: orderable.length,
      ...(prices.length === 0
        ? {}
        : { lowPrice: Math.min(...prices), highPrice: Math.max(...prices) }),
      availability:
        orderable.length > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  }

  return (
    <>
      {/*
        `JSON.stringify` of this file's own object. Nothing user-supplied reaches
        it as markup — a product name is escaped by `stringify` — and JSON-LD has
        no other form: a `<script>` with children would be React text nodes,
        which is not what a parser reads.
      */}
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
        type="application/ld+json"
      />

      {/*
        The price as text, for anything that reads the page without running it.
        `formatMoney` rather than a raw number so it matches what the screen
        below renders once it hydrates.
      */}
      <span className="sr-only">
        {prices.length === 0
          ? ''
          : formatMoney({ amount: Math.min(...prices), currency: CURRENCY })}
      </span>

      <ProductDetail
        cartMessages={messages.cart}
        detail={detail}
        messages={messages.productDetail}
      />
    </>
  )
}
