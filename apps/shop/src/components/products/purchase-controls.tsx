'use client'

/**
 * 수량 · 합계 · 담기 (TASK-0043).
 *
 * One component, two mountings: the desktop's right-hand panel and the phone's
 * fixed bottom bar render **this**, and D-055 decides which one exists — never
 * both with one hidden. The controls are identical because the decision is
 * identical; only the frame around them differs.
 *
 * 담기는 이제 실제로 담는다 (TASK-0046 4.5). 「바로 구매」는 아직 아니다 — 주문서로
 * 곧장 들어가는 길은 TASK-0050 의 것이고, TASK-0023 4장대로 **보이되 비활성이고 그
 * 이유가 붙어 있다.** `aria-disabled` 라 탭 순서에 남고, 그래서 이유를 읽을 수 있다.
 */

import type { Product, ProductVariant } from '@shopping/shared'
import { Button, IconButton } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import type { AddToCartState } from '@/lib/cart/use-add-to-cart'

import { purchaseLimit } from '@/lib/products/variant-selection'
import type { CartMessages, ProductOptionMessages, ProductPurchaseMessages } from '@/messages'

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

export interface PurchaseControlsProps {
  readonly product: Product
  readonly variant: ProductVariant | null
  readonly quantity: number
  readonly onQuantityChange: (quantity: number) => void
  readonly messages: ProductPurchaseMessages
  readonly optionMessages: ProductOptionMessages
  readonly cartMessages: CartMessages
  /** 담기. 조합이 정해졌을 때만 불린다. */
  readonly onAddToCart: (variantId: string, quantity: number) => void
  /** 담기의 결과. 화면이 그것을 말로 옮긴다. */
  readonly addState: AddToCartState
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
  cartMessages,
  onAddToCart,
  addState,
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
          // 조합을 고르기 전에는 `aria-disabled` 다 (`disabled` 가 아니다).
          // 탭 순서에 남아야 그 이유 — 바로 위의 옵션 영역 — 에 닿을 수 있고,
          // 그것이 TASK-0023 4장이 정한 방식이다. 반대로 요청이 도는 동안은 진짜
          // `disabled` 다: 그때는 읽을 이유가 없고 두 번 눌리면 두 번 담긴다.
          aria-disabled={!ready}
          className="flex-1"
          disabled={addState.status === 'adding'}
          loading={addState.status === 'adding'}
          onClick={() => {
            // `aria-disabled` 는 클릭을 막지 않는다 — 막는 것은 여기다. 조합이
            // 없거나 품절이면 담을 것이 없고, 서버가 거절할 요청을 보내 봐야
            // 사람이 얻는 것은 오류 문장뿐이다.
            if (ready && variant !== null) onAddToCart(variant.id, quantity)
          }}
          type="button"
          variant="outline"
        >
          {addState.status === 'adding' ? cartMessages.addPending : messages.addToCart}
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

      {/*
        결과를 말로 옮긴다. `aria-live` 라 화면을 보지 않는 사람도 담겼다는 것을
        안다 — 헤더의 배지가 움직이는 것만으로는 그 사실이 전해지지 않는다.
      */}
      <p aria-live="polite" className="text-fg-subtle text-xs">
        {addState.status === 'added' ? (
          <>
            {cartMessages.added}{' '}
            <Link className="underline underline-offset-2" href="/cart">
              {cartMessages.viewCart}
            </Link>
          </>
        ) : addState.status === 'failed' ? (
          cartMessages.addFailed
        ) : (
          messages.comingSoon
        )}
      </p>
    </div>
  )
}
