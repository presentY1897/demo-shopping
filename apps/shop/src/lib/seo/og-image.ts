import type { ProductDetailResponse } from '@shopping/shared'
import { formatMoney } from '@shopping/ui/format'

/**
 * What an Open Graph card says about a listing (TASK-0102 F2).
 *
 * Separated from the drawing so it can be tested as what it is — input to
 * output. `ImageResponse` produces a PNG stream, which is not a thing a unit
 * test can read a price out of; this is.
 */

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

export interface OgCard {
  readonly name: string
  readonly brandName: string
  /** Already formatted — the card is an image and cannot format anything later. */
  readonly price: string
  readonly imageUrl: string | null
}

/**
 * The cheapest **orderable** price, which is the number the card promises.
 *
 * A range including a sold-out SKU would advertise a price nobody can pay — the
 * same rule the page's structured data follows, so the card and the page cannot
 * disagree.
 */
export function ogCard(detail: ProductDetailResponse): OgCard {
  const orderable = detail.product.variants.filter(
    (variant) => variant.isActive && variant.stock > 0,
  )
  const priced = orderable.length > 0 ? orderable : detail.product.variants
  const cheapest = [...priced].sort((left, right) => left.price - right.price)[0]

  return {
    name: detail.product.name,
    brandName: detail.seller.brandName,
    price:
      cheapest === undefined ? '' : formatMoney({ amount: cheapest.price, currency: CURRENCY }),
    imageUrl: detail.product.images[0]?.url ?? null,
  }
}

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const
