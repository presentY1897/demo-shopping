'use client'

import { useState, type ReactNode } from 'react'
import { ProductImagePlaceholder } from './product-image-placeholder'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'
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
  /** `{name}` — 담기. */
  readonly wishlist: string
  /** `{name}` — 빼기. 담긴 카드의 버튼은 이 이름으로 불린다. */
  readonly wishlistOn: string
  readonly quickAdd: string
  /** `{name}` — swatch list's accessible name. */
  readonly colorsLabel: string
  readonly imageUnavailable?: string
  readonly ratingLabel: string
}

export interface ProductCardProps {
  readonly product: ProductCardProduct
  readonly density: DensityLevel
  readonly labels: ProductCardLabels
  readonly href: string
  /** Absent hides the control entirely. */
  readonly onWishlist?: (id: string) => void
  /**
   * 담겼는가. `undefined` 는 **모른다** — 아직 답이 오지 않았거나 비로그인이다.
   *
   * 셋을 가르는 이유는 「모른다」를 「안 담김」으로 그리면 담아 둔 카드의 하트가
   * 새로고침마다 한 번씩 비었다가 차기 때문이다(TASK-0086 F1). 모를 때는
   * `aria-pressed` 를 **달지 않는다** — 누르지 않은 버튼이라고 말하는 것보다 말하지
   * 않는 편이 참이다.
   */
  readonly wishlisted?: boolean
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

/**
 * 카드가 올 자리를 **카드 모양으로** 비워 둔다 (TASK-0097 F2).
 *
 * 사진 비율만 그려 두면 글이 도착할 때 밑의 것이 전부 밀린다 — 360px 에서 재 보면
 * 사진은 195px 이고 글은 98~120px 이라, **한 줄마다 100px 씩** 아래가 내려간다.
 * 홈은 그런 줄이 넉 줄이었고 그것이 이 화면의 CLS 를 0.22 로 만들고 있었다.
 *
 * 그래서 같은 파일에 둔다. 카드의 본문이 한 줄 늘어나면 이 자리도 같이 늘려야 하고,
 * 두 파일에 나뉘어 있으면 그 사실을 아무도 모른다.
 *
 * **미니멀은 한 줄, 나머지는 두 줄.** 카드가 넓을수록 이름이 적은 줄을 쓴다 —
 * 미니멀은 한 화면에 한 장이라 320px 이고, 거기서는 이름이 대개 한 줄에 들어간다.
 */
export function ProductCardSkeleton({ density }: { readonly density: DensityLevel }) {
  const bar = 'bg-surface-muted block animate-pulse rounded-sm'

  return (
    <div
      aria-hidden="true"
      className="border-border bg-surface flex flex-col overflow-hidden rounded-md border"
      data-density={density}
    >
      <div className={cx('bg-surface-muted w-full animate-pulse', IMAGE_RATIO[density])} />

      {/* 카드 본문과 같은 상자다 — 여백과 줄 간격이 어긋나면 높이도 어긋난다. */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className={cx(bar, 'h-3 w-1/3')} />
        <span className={cx(bar, 'h-4 w-full')} />
        {density === 1 ? null : <span className={cx(bar, 'h-4 w-2/3')} />}
        <span className={cx(bar, 'h-5 w-1/2')} />
        {density === 1 ? null : <span className={cx(bar, 'h-3 w-1/4')} />}
      </div>
    </div>
  )
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
/**
 * 100배 정수 평점을 **소수 한 자리로** — 435 는 4.4 다.
 *
 * 반올림을 **정수 공간에서** 한다. `435 / 100` 은 4.35 가 아니라 4.34999… 로
 * 저장되고, 그것을 `toFixed(1)` 에 넘기면 「4.3」이 나온다 — 사람이 보기에 명백히
 * 틀린 값인데 아무것도 실패하지 않는다. 나누기를 마지막에 한 번만 하면 그 자리가
 * 없어진다.
 *
 * 0 과 없음이 같은 답인 이유는 `Product_rating_check` 가 「리뷰가 없으면 평균도 0」을
 * 요구하기 때문이다 — 0점짜리 평점은 존재하지 않고, 0은 언제나 「아직 없다」다.
 */
export function ratingOf(ratingAvg: number | undefined): number | null {
  return ratingAvg === undefined || ratingAvg <= 0 ? null : Math.round(ratingAvg / 10) / 10
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
  wishlisted,
  onQuickAdd,
  renderImage,
  className,
}: ProductCardProps) {
  const money = (amount: number): string => formatMoney({ amount, currency: 'KRW' })
  const discount = discountPercent(product.price, product.listPrice)
  const rating = ratingOf(product.ratingAvg)
  const soldOut = product.inStock === false
  const image = product.imageUrl?.trim() ? product.imageUrl.trim() : null
  const [failedImage, setFailedImage] = useState<string | null>(null)

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
      <div
        className={cx('bg-surface-muted relative w-full', IMAGE_RATIO[density])}
        onErrorCapture={() => setFailedImage(image)}
      >
        {image === null || failedImage === image ? (
          <ProductImagePlaceholder label={labels.imageUnavailable} />
        ) : renderImage !== undefined ? (
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
            aria-label={fill(wishlisted === true ? labels.wishlistOn : labels.wishlist, {
              name: product.name,
            })}
            // 모를 때는 속성 자체가 없다. `aria-pressed={undefined}` 가 그 뜻이다.
            aria-pressed={wishlisted}
            className={cx(
              'bg-surface/85 text-fg absolute top-2 right-2 rounded-full p-1.5 text-sm',
              FOCUS_RING,
            )}
            onClick={() => {
              onWishlist(product.id)
            }}
            type="button"
          >
            {/*
             * 색이 아니라 **모양**이 상태를 말한다. 채워진 하트와 빈 하트는 색을
             * 못 보는 사람에게도 다르고, 대비만으로 상태를 알리는 카드는 9조합
             * 검사(F7)의 축을 하나 놓친 것이다.
             */}
            {wishlisted === true ? '♥' : '♡'}
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
          className={cx(
            'text-fg after:absolute after:inset-0 line-clamp-2 text-sm font-medium',
            FOCUS_RING,
          )}
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
            className={cx(
              'border-border text-fg hover:bg-surface-muted relative z-10 mt-2 rounded-sm border px-2 py-1 text-xs',
              FOCUS_RING,
            )}
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
