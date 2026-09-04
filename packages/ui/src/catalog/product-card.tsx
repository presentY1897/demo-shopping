'use client'

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import type { DensityLevel } from '../density/density'
import { formatMoney } from '../format/money'

/**
 * 상품 카드 — 밀도 3단계가 실제로 보이는 첫 컴포넌트 (TASK-0040).
 *
 * **Every field arrives at every density. Only the rendering changes.** Asking
 * the server again on each toggle would make the switch feel slow and split one
 * cache into three; the payload difference is a rating and a colour list. So the
 * props are the same shape at level 1 and level 3, and `density` decides what is
 * drawn — which is also what makes the toggle instant.
 *
 * **The card sizes itself from its container, not from the viewport.** Six
 * columns on a desktop and one on a phone are the same component at different
 * widths, and a card that read the viewport would be wrong in both — a 1-column
 * mobile card is *wider* than a 6-column desktop one. `@container` is what lets
 * the same density draw a roomy card on a phone and a tight one in a dense grid
 * (4장 「카드 내부 배치는 컨테이너 쿼리로」).
 *
 * **Nothing here fetches, and nothing here navigates on its own.** It is
 * `packages/ui`: the shop passes a `href` and the handlers, so the same card
 * serves search, a category page and the home page without any of them being
 * known here.
 */

/** What a card is given. The same object at every density. */
export interface ProductCardProduct {
  readonly id: string
  readonly name: string
  readonly brandName: string
  /** Minor units, like everything else money in this package. */
  readonly price: number
  /** The struck-through price, when there is one. */
  readonly listPrice?: number | null
  readonly imageUrl?: string | null
  /** 0–500, as the API carries it: 4.5 stars is 450. */
  readonly ratingAvg?: number
  readonly ratingCount?: number
  readonly salesCount?: number
  /** Colour swatches. Hex or CSS colour keywords. */
  readonly colors?: readonly string[]
  readonly inStock?: boolean
  /** Shown at level 3 when it is small enough to be a reason to hurry. */
  readonly remainingStock?: number | null
}

export interface ProductCardLabels {
  /** `{name}` — the link's accessible name. */
  readonly openLabel: string
  readonly soldOut: string
  /** `{percent}` */
  readonly discount: string
  /** `{count}` */
  readonly reviewCount: string
  /** `{count}` */
  readonly salesCount: string
  /** `{count}` — 재고 임박. */
  readonly remaining: string
  readonly wishlist: string
  readonly quickAdd: string
  /** `{name}` — swatch list's accessible name. */
  readonly colorsLabel: string
  readonly ratingLabel: string
}

export interface ProductCardProps {
  readonly product: ProductCardProduct
  readonly density: DensityLevel
  readonly labels: ProductCardLabels
  readonly href: string
  /** Placeholder until M13. Absent hides the control entirely. */
  readonly onWishlist?: (id: string) => void
  /** Placeholder until M07. Level 3 only, and absent hides it. */
  readonly onQuickAdd?: (id: string) => void
  /** Rendered in place of `<img>`, so an app can pass `next/image`. */
  readonly renderImage?: (image: { readonly src: string; readonly alt: string }) => ReactNode
  readonly className?: string
}

/** How much smaller the image gets as the density rises (4장 표). */
const IMAGE_RATIO: Readonly<Record<DensityLevel, string>> = {
  1: 'aspect-[3/4]',
  2: 'aspect-[4/5]',
  3: 'aspect-square',
}

/** Discount, rounded down: claiming 30% for 29.6% is claiming too much. */
export function discountPercent(
  price: number,
  listPrice: number | null | undefined,
): number | null {
  if (listPrice === null || listPrice === undefined || listPrice <= price) return null

  return Math.floor(((listPrice - price) / listPrice) * 100)
}

/** `450` → `4.5`. The API carries hundredths so it can stay an integer. */
export function ratingOf(ratingAvg: number | undefined): number | null {
  return ratingAvg === undefined || ratingAvg <= 0 ? null : Math.round(ratingAvg) / 100
}

function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replaceAll(/\{(\w+)\}/g, (whole, key: string) =>
    values[key] === undefined ? whole : String(values[key]),
  )
}

export function ProductCard({
  product,
  density,
  labels,
  href,
  onWishlist,
  onQuickAdd,
  renderImage,
  className,
}: ProductCardProps) {
  const money = (amount: number): string => formatMoney({ amount, currency: 'KRW' })
  const discount = discountPercent(product.price, product.listPrice)
  const rating = ratingOf(product.ratingAvg)
  const soldOut = product.inStock === false
  const image = product.imageUrl ?? null

  return (
    <article
      className={cx(
        // The container the card measures itself against. Everything below sizes
        // from `@[…]` rather than from a breakpoint.
        '@container/card border-border bg-surface relative flex flex-col overflow-hidden rounded-md border',
        className,
      )}
      data-density={density}
      data-sold-out={soldOut || undefined}
    >
      <div className={cx('bg-surface-muted relative w-full', IMAGE_RATIO[density])}>
        {image === null ? null : renderImage !== undefined ? (
          renderImage({ src: image, alt: product.name })
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- this package
             does not depend on Next, and an app that wants `next/image` passes
             `renderImage` instead of taking this branch. */
          <img
            alt={product.name}
            className="h-full w-full object-cover"
            // Lazy and sized: the grid may hold a hundred of these, and an
            // intrinsic size is what stops the page reflowing as each arrives
            // (F4 — CLS).
            decoding="async"
            loading="lazy"
            src={image}
          />
        )}

        {soldOut ? (
          <span className="bg-fg/70 text-surface absolute inset-0 flex items-center justify-center text-sm font-medium">
            {labels.soldOut}
          </span>
        ) : null}

        {onWishlist === undefined ? null : (
          <button
            aria-label={fill(labels.wishlist, { name: product.name })}
            className="bg-surface/85 text-fg absolute top-2 right-2 rounded-full p-1.5 text-sm"
            onClick={() => {
              onWishlist(product.id)
            }}
            type="button"
          >
            ♡
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        {/*
         * The brand is present at every density and only *visible* from level 2.
         * `sr-only` rather than absent: a screen reader user has no hover, and a
         * card whose brand vanished for them would be less information, not less
         * clutter (4장 「호버 시」).
         */}
        <span
          className={cx(
            'text-fg-muted text-xs',
            density === 1 ? 'sr-only @sm/card:not-sr-only' : '',
          )}
        >
          {product.brandName}
        </span>

        <a
          aria-label={fill(labels.openLabel, { name: product.name })}
          className="text-fg after:absolute after:inset-0 line-clamp-2 text-sm font-medium"
          href={href}
        >
          {product.name}
        </a>

        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-fg text-base font-bold">{money(product.price)}</span>
          {density >= 2 && discount !== null ? (
            <>
              <span className="text-fg-subtle text-xs line-through">
                {money(product.listPrice ?? 0)}
              </span>
              <span className="text-danger text-xs font-semibold">
                {fill(labels.discount, { percent: discount })}
              </span>
            </>
          ) : null}
        </div>

        {density >= 2 && rating !== null ? (
          <p className="text-fg-muted flex items-center gap-1 text-xs">
            <span aria-label={labels.ratingLabel}>★</span>
            <span>{rating.toFixed(1)}</span>
            {density >= 3 && product.ratingCount !== undefined ? (
              <span>{fill(labels.reviewCount, { count: product.ratingCount })}</span>
            ) : null}
          </p>
        ) : null}

        {density >= 2 && (product.colors ?? []).length > 0 ? (
          <ul
            aria-label={fill(labels.colorsLabel, { name: product.name })}
            className="flex flex-wrap gap-1"
          >
            {(product.colors ?? []).slice(0, 5).map((color) => (
              <li
                className="border-border h-3 w-3 rounded-full border"
                key={color}
                style={{ backgroundColor: color }}
              />
            ))}
          </ul>
        ) : null}

        {density >= 3 ? (
          <div className="text-fg-muted mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs">
            {product.salesCount === undefined || product.salesCount === 0 ? null : (
              <span>{fill(labels.salesCount, { count: product.salesCount })}</span>
            )}
            {product.remainingStock === null ||
            product.remainingStock === undefined ||
            product.remainingStock === 0 ? null : (
              <span className="text-danger font-medium">
                {fill(labels.remaining, { count: product.remainingStock })}
              </span>
            )}
          </div>
        ) : null}

        {density >= 3 && onQuickAdd !== undefined && !soldOut ? (
          <button
            // `relative` lifts it above the link's stretched pseudo-element —
            // without it the whole card is one link and this button cannot be
            // clicked at all.
            className="border-border text-fg hover:bg-surface-muted relative z-10 mt-2 rounded-sm border px-2 py-1 text-xs"
            onClick={() => {
              onQuickAdd(product.id)
            }}
            type="button"
          >
            {labels.quickAdd}
          </button>
        ) : null}
      </div>
    </article>
  )
}
