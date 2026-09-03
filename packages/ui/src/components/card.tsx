/**
 * A card that answers to **its own width**, not the window's.
 *
 * This is the point DECISIONS 1장 makes with `카드 내부는 컨테이너 쿼리`. The
 * same card is dropped into a 1-column minimal grid and a 6-column maximal grid,
 * and at 1440px those are a ~1300px card and a ~200px card. A media query sees
 * one number — 1440 — for both, so a viewport-driven card would lay the wide one
 * out as if it were narrow, or the narrow one as if it were wide. There is no
 * breakpoint that is right for both, because the viewport is not the variable.
 *
 * So the card declares itself a **container** (`@container/card`) and every
 * internal switch is a container variant (`@md/card:`), which compiles to
 * `@container card (width >= 28rem)` — a rule the browser evaluates against this
 * element's own inline size. `test/container-query.spec.tsx` compiles the class
 * names this component actually renders and fails if any of them turns into a
 * `@media` rule instead.
 *
 * Naming the container (`/card`) rather than using a bare `@container` matters
 * once cards nest — a card inside a card's body would otherwise resolve the
 * inner card's variants against whichever container is nearest, which is not
 * necessarily the one the class was written for.
 *
 * Server-renderable: no hook, no browser API.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

export const CARD_VARIANTS = ['raised', 'outline', 'flat'] as const
export type CardVariant = (typeof CARD_VARIANTS)[number]

/** `li` so a grid of cards can be a real list; `article` for a standalone one. */
export const CARD_ELEMENTS = ['div', 'li', 'article'] as const
export type CardElement = (typeof CARD_ELEMENTS)[number]

const VARIANT_STYLES: Readonly<Record<CardVariant, string>> = {
  raised: 'bg-surface-raised border-border border shadow-sm',
  outline: 'bg-surface border-border border',
  flat: 'bg-surface-sunken',
}

export interface CardProps {
  readonly children: ReactNode
  /** An image, a thumbnail, a chart. Sits above the body when the card is narrow. */
  readonly media?: ReactNode
  /** Buttons. Below the body when narrow, beside it when wide. */
  readonly actions?: ReactNode
  readonly variant?: CardVariant
  readonly as?: CardElement
  readonly className?: string
}

export function Card({
  children,
  media,
  actions,
  variant = 'raised',
  as = 'div',
  className,
}: CardProps) {
  const Tag = as

  return (
    <Tag
      className={cx(
        // `@container/card` is what makes every `@md/card:` below resolve
        // against this box. Removing it does not break the layout loudly — it
        // silently makes the card always render its narrow form.
        '@container/card text-fg overflow-hidden rounded-lg p-4',
        VARIANT_STYLES[variant],
        className,
      )}
    >
      <div className="flex flex-col gap-3 @md/card:flex-row @md/card:items-start @md/card:gap-4">
        {media === undefined ? null : (
          <div className="w-full shrink-0 overflow-hidden rounded-md @md/card:w-40">{media}</div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>

        {actions === undefined ? null : (
          <div className="flex flex-col gap-2 @md/card:shrink-0 @md/card:items-end">{actions}</div>
        )}
      </div>
    </Tag>
  )
}
