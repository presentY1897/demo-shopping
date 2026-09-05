'use client'

import type { CartGroup } from '@shopping/shared'
import { Checkbox } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import type { GroupTotals } from '@/lib/cart/totals'
import type { CheckState, Selection } from '@/lib/cart/selection'
import type { CartMessages } from '@/messages'

import { CartLineRow } from './cart-line-row'

const CURRENCY = 'KRW'

export interface CartGroupCardProps {
  readonly group: CartGroup
  readonly totals: GroupTotals
  readonly state: CheckState
  readonly selection: Selection
  readonly busy: boolean
  readonly messages: CartMessages
  readonly onToggleGroup: () => void
  readonly onToggleItem: (itemId: string) => void
  readonly onQuantityChange: (itemId: string, quantity: number) => void
  readonly onRemove: (itemId: string) => void
}

/**
 * 한 판매자의 묶음 (TASK-0046 F1).
 *
 * **마켓플레이스 구조가 눈에 보이는 첫 지점이다.** 브랜드명과 배송비가 그룹 머리에
 * 붙는 이유는 그 둘이 판매자 단위이기 때문이고(D-023), 그것을 보고서야 사는 사람이
 * 「배송이 따로 온다」를 안다.
 *
 * 배송비는 **고른 것에 대한** 값이다. 아무것도 고르지 않은 그룹은 0원이고, 그것이
 * 「무료」와 같은 화면이 되지 않게 무료 조건을 채웠을 때만 「무료배송」이라고 쓴다.
 */
export function CartGroupCard({
  group,
  totals,
  state,
  selection,
  busy,
  messages,
  onToggleGroup,
  onToggleItem,
  onQuantityChange,
  onRemove,
}: CartGroupCardProps) {
  return (
    <section aria-label={group.brandName} className="border-border rounded-lg border p-4">
      <header className="flex flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox
            aria-label={messages.selectGroup.replace('{brand}', group.brandName)}
            checked={state === 'indeterminate' ? 'indeterminate' : state === 'checked'}
            disabled={busy}
            onCheckedChange={onToggleGroup}
          />
          <Link
            className="text-fg truncate text-sm font-semibold"
            href={`/brands/${group.sellerId}`}
          >
            {group.brandName}
          </Link>
        </div>

        <p className="text-fg-subtle shrink-0 text-xs">
          {totals.shippingFee === 0 && totals.productAmount > 0
            ? messages.freeShipping
            : messages.shippingFee.replace(
                '{amount}',
                formatMoney({ amount: totals.shippingFee, currency: CURRENCY }),
              )}
        </p>
      </header>

      <ul className="flex flex-col">
        {group.items.map((item) => (
          <CartLineRow
            busy={busy}
            item={item}
            key={item.id}
            messages={messages}
            onQuantityChange={(quantity) => {
              onQuantityChange(item.id, quantity)
            }}
            onRemove={() => {
              onRemove(item.id)
            }}
            onToggle={() => {
              onToggleItem(item.id)
            }}
            selected={selection.has(item.id)}
          />
        ))}
      </ul>

      {totals.freeShippingRemaining === null ? null : (
        // 조건을 채우면 사라진다 (F6). 남은 금액을 계속 보여 주면 이미 무료인
        // 사람에게 「더 담으라」고 말하게 된다.
        <p className="text-fg-muted border-border mt-2 border-t pt-2 text-xs">
          {messages.freeShippingRemaining.replace(
            '{amount}',
            formatMoney({ amount: totals.freeShippingRemaining, currency: CURRENCY }),
          )}
        </p>
      )}
    </section>
  )
}
