'use client'

/**
 * 수량 · 합계 · 담기 (TASK-0043).
 *
 * One component, two mountings: the desktop's right-hand panel and the phone's
 * fixed bottom bar render **this**, and D-055 decides which one exists — never
 * both with one hidden. The controls are identical because the decision is
 * identical; only the frame around them differs.
 *
 * The two buttons do nothing. M07 owns the basket, and TASK-0023 4장 is explicit
 * that an unavailable action is **shown, disabled, with a reason** rather than
 * hidden — the point of the demo is that the feature is visible. So the buttons
 * are here, they say why they are inert, and `aria-disabled` keeps them on the
 * tab order so a screen reader reaches the reason.
 */

import type { Product, ProductVariant } from '@shopping/shared'
import { Button, IconButton } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'

import { purchaseLimit } from '@/lib/products/variant-selection'
import type { ProductOptionMessages, ProductPurchaseMessages } from '@/messages'

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

export interface PurchaseControlsProps {
  readonly product: Product
  readonly variant: ProductVariant | null
  readonly quantity: number
  readonly onQuantityChange: (quantity: number) => void
  readonly messages: ProductPurchaseMessages
  readonly optionMessages: ProductOptionMessages
  /** The bottom bar keeps it to one line; the panel has room for the rest. */
  readonly compact?: boolean
}

export function PurchaseControls({
  product,
  variant,
  quantity,
  onQuantityChange,
  messages,
  optionMessages,
  compact = false,
}: PurchaseControlsProps) {
  const limit = purchaseLimit(product, variant)
  const soldOut = variant !== null && (variant.availableStock === 0 || !variant.isActive)
  const ready = variant !== null && !soldOut
  const total = variant === null ? null : variant.price * quantity

  return (
    <div className="flex flex-col gap-3">
      {compact ? null : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-fg text-sm font-medium">{messages.quantityLabel}</span>

          <div className="border-border flex items-center gap-1 rounded-md border">
            <IconButton
              disabled={!ready || quantity <= 1}
              label={messages.decrease}
              onClick={() => {
                onQuantityChange(quantity - 1)
              }}
              size="sm"
              variant="ghost"
            >
              <span aria-hidden="true">−</span>
            </IconButton>
            <span aria-live="polite" className="min-w-8 text-center text-sm tabular-nums">
              {quantity}
            </span>
            <IconButton
              disabled={!ready || (limit !== null && quantity >= limit)}
              label={messages.increase}
              onClick={() => {
                onQuantityChange(quantity + 1)
              }}
              size="sm"
              variant="ghost"
            >
              <span aria-hidden="true">+</span>
            </IconButton>
          </div>
        </div>
      )}

      {compact || limit === null ? null : (
        <p className="text-fg-subtle text-xs">
          {messages.limitNotice.replace('{count}', String(limit))}
        </p>
      )}

      {total === null ? (
        <p className="text-fg-muted text-sm">{optionMessages.chooseNotice}</p>
      ) : soldOut ? (
        <p className="text-danger text-sm">{messages.soldOutNotice}</p>
      ) : (
        <p className="flex items-baseline justify-between gap-2">
          <span className="text-fg-muted text-sm">{messages.totalLabel}</span>
          <span className="text-fg text-lg font-bold">
            {formatMoney({ amount: total, currency: CURRENCY })}
          </span>
        </p>
      )}

      <div className="flex gap-2">
        <Button
          aria-disabled
          className="flex-1"
          onClick={(event) => {
            // Inert until M07. `aria-disabled` rather than `disabled` so the
            // control keeps its tab stop and the reason below is reachable.
            event.preventDefault()
          }}
          type="button"
          variant="outline"
        >
          {messages.addToCart}
        </Button>
        <Button
          aria-disabled
          className="flex-1"
          onClick={(event) => {
            event.preventDefault()
          }}
          type="button"
        >
          {messages.buyNow}
        </Button>
      </div>

      <p className="text-fg-subtle text-xs">{messages.comingSoon}</p>
    </div>
  )
}
