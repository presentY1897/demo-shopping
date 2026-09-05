'use client'

import { Button, EmptyState, ErrorState } from '@shopping/ui/components'
import Link from 'next/link'

import { useCart } from '@/lib/cart/use-cart'
import { useOpenCheckout } from '@/lib/checkout/use-open-checkout'
import {
  allState,
  groupState,
  selectableIds,
  toggleAll,
  toggleGroup,
  toggleItem,
} from '@/lib/cart/selection'
import { cartTotals } from '@/lib/cart/totals'
import type { CartMessages } from '@/messages'

import { CartGroupCard } from './cart-group-card'
import { CartSummary } from './cart-summary'

export interface CartScreenProps {
  readonly messages: CartMessages
}

/**
 * 장바구니 (TASK-0046).
 *
 * 클라이언트 컴포넌트다. **선택이 이 탭에서 일어나는 일**이고, 장바구니는 한 사람의
 * 것이라 색인되지도 공유되지도 않는다 — 서버 렌더로 얻을 것이 없다.
 *
 * 화면이 계산하는 것은 합계뿐이고, 그 합계도 `packages/shared` 의 계산 엔진이
 * 낸다(4.2). 무엇이 품절인지, 가격이 얼마나 올랐는지는 서버가 이미 판단해서
 * `notices` 로 보내 준다 — 화면이 다시 비교하면 두 벌이 되고 어느 날 갈린다.
 */
export function CartScreen({ messages }: CartScreenProps) {
  const { state, selection, busy, setSelection, changeQuantity, remove, retry } = useCart()
  const checkout = useOpenCheckout()

  if (state.status === 'loading') {
    return (
      <p aria-live="polite" className="text-fg-muted py-16 text-center text-sm">
        {messages.loading}
      </p>
    )
  }

  if (state.status === 'failed') {
    return (
      <ErrorState
        action={
          <Button onClick={retry} type="button">
            {messages.retry}
          </Button>
        }
        description={messages.failedBody}
        title={messages.failedTitle}
      />
    )
  }

  const { cart } = state

  if (cart.groups.length === 0) {
    return (
      <EmptyState
        action={
          <Link className="text-accent text-sm font-medium underline" href="/">
            {messages.emptyAction}
          </Link>
        }
        description={messages.emptyBody}
        title={messages.emptyTitle}
      />
    )
  }

  const totals = cartTotals(cart, selection)
  const top = allState(cart, selection)
  const selectable = selectableIds(cart)

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              aria-label={messages.selectAll.replace('{count}', String(selectable.length))}
              checked={top === 'checked'}
              className="accent-accent size-4"
              disabled={busy}
              onChange={() => {
                setSelection(toggleAll(selection, cart))
              }}
              ref={(node) => {
                // `indeterminate` 는 속성이 아니라 **프로퍼티**다. JSX 로는 쓸 수
                // 없어서 여기서 준다 — 세 상태 중 하나를 그리는 유일한 방법이다.
                if (node !== null) node.indeterminate = top === 'indeterminate'
              }}
              type="checkbox"
            />
            <span>{messages.selectAll.replace('{count}', String(selectable.length))}</span>
          </label>

          <Button
            disabled={busy || totals.selectedCount === 0}
            onClick={() => {
              remove([...selection])
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {messages.removeSelected}
          </Button>
        </div>

        {cart.groups.map((group) => (
          <CartGroupCard
            busy={busy}
            group={group}
            key={group.sellerId}
            messages={messages}
            onQuantityChange={changeQuantity}
            onRemove={(itemId) => {
              remove([itemId])
            }}
            onToggleGroup={() => {
              setSelection(toggleGroup(selection, group))
            }}
            onToggleItem={(itemId) => {
              const item = group.items.find((entry) => entry.id === itemId)

              if (item !== undefined) setSelection(toggleItem(selection, item))
            }}
            selection={selection}
            state={groupState(group, selection)}
            totals={
              totals.groups.get(group.sellerId) ?? {
                productAmount: 0,
                shippingFee: 0,
                freeShippingRemaining: null,
              }
            }
          />
        ))}
      </div>

      <div className="lg:w-80 lg:shrink-0">
        <CartSummary
          busy={busy}
          messages={messages}
          onCheckout={() => {
            checkout.open([...selection])
          }}
          openFailed={checkout.failed}
          opening={checkout.opening}
          totals={totals}
        />
      </div>
    </div>
  )
}
