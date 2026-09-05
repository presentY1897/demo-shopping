'use client'

import type { CartItem } from '@shopping/shared'
import { Checkbox, IconButton } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import { isSelectable } from '@/lib/cart/selection'
import type { CartMessages } from '@/messages'

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

export interface CartLineRowProps {
  readonly item: CartItem
  readonly selected: boolean
  readonly busy: boolean
  readonly messages: CartMessages
  readonly onToggle: () => void
  readonly onQuantityChange: (quantity: number) => void
  readonly onRemove: () => void
}

/**
 * 한 줄 (TASK-0046).
 *
 * **품절 줄을 지우지 않는다.** 사용자가 뭘 담았는지 기억하고 재입고를 기다릴 수
 * 있어야 한다(4장). 고를 수 없게만 하고, 왜 못 고르는지를 그 자리에 적는다 — 회색이
 * 된 이유가 화면 어디에도 없으면 사람은 자기가 잘못 눌렀다고 생각한다.
 *
 * 알림은 `notices` 를 그대로 그린다. 화면이 가격과 재고를 다시 비교하지 않는 이유는
 * 서버가 이미 그 판단을 했기 때문이고, 두 벌이면 어느 날 갈린다.
 */
export function CartLineRow({
  item,
  selected,
  busy,
  messages,
  onToggle,
  onQuantityChange,
  onRemove,
}: CartLineRowProps) {
  const selectable = isSelectable(item)
  const limit = item.maxPurchaseQuantity
  const priceChanged =
    item.notices.includes('price_increased') || item.notices.includes('price_decreased')

  return (
    <li className="border-border flex gap-3 border-t py-4 first:border-t-0">
      <Checkbox
        aria-label={messages.selectItem.replace('{name}', item.productName)}
        checked={selected}
        className="mt-1 shrink-0"
        disabled={!selectable || busy}
        onCheckedChange={onToggle}
      />

      {/*
        이름 링크와 **같은 곳으로 가는 두 번째 링크**다. 마우스로는 사진을 누르는
        것이 편하지만 보조 기술에는 같은 목적지가 두 번 읽히고, 사진이 없는 줄에서는
        이름조차 없는 링크가 된다 — `link-name` 위반이다. 그래서 접근성 트리에서
        빼고 탭 순서에서도 뺀다.
      */}
      <Link
        aria-hidden="true"
        className="bg-surface-muted size-20 shrink-0 overflow-hidden rounded-md"
        href={`/products/${item.productId}`}
        tabIndex={-1}
      >
        {item.thumbnailUrl === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- 장바구니 줄의 작은 썸네일이다. `next/image` 로는 줄 수만큼 요청이 늘고, 얻는 것이 없다 (`product-gallery.tsx` 가 같은 이유로 같은 선택을 했다).
          <img alt="" className="size-full object-cover" src={item.thumbnailUrl} />
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link className="text-fg truncate text-sm font-medium" href={`/products/${item.productId}`}>
          {item.productName}
        </Link>

        {item.optionLabel === '' ? null : (
          <p className="text-fg-subtle truncate text-xs">{item.optionLabel}</p>
        )}

        <p className="flex items-baseline gap-2">
          <span className="text-fg text-sm font-semibold">
            {formatMoney({ amount: item.price * item.quantity, currency: CURRENCY })}
          </span>
          {priceChanged ? (
            <span className="text-fg-subtle text-xs line-through">
              {messages.priceAtAdded.replace(
                '{amount}',
                formatMoney({ amount: item.priceAtAdded * item.quantity, currency: CURRENCY }),
              )}
            </span>
          ) : null}
        </p>

        {item.notices.length === 0 ? null : (
          <ul className="flex flex-col gap-0.5">
            {item.notices.map((notice) => (
              <li
                className={
                  notice === 'sold_out' || notice === 'unavailable'
                    ? 'text-danger text-xs'
                    : 'text-fg-subtle text-xs'
                }
                key={notice}
              >
                {messages.notices[notice]}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="border-border flex items-center gap-1 rounded-md border">
            <IconButton
              disabled={busy || item.quantity <= 1}
              label={messages.decrease}
              onClick={() => {
                onQuantityChange(item.quantity - 1)
              }}
              size="sm"
              variant="ghost"
            >
              <span aria-hidden="true">−</span>
            </IconButton>
            <span aria-live="polite" className="min-w-8 text-center text-sm tabular-nums">
              {item.quantity}
            </span>
            <IconButton
              disabled={busy || (limit !== null && item.quantity >= limit)}
              label={messages.increase}
              onClick={() => {
                onQuantityChange(item.quantity + 1)
              }}
              size="sm"
              variant="ghost"
            >
              <span aria-hidden="true">+</span>
            </IconButton>
          </div>

          <IconButton
            disabled={busy}
            label={messages.removeItem.replace('{name}', item.productName)}
            onClick={onRemove}
            size="sm"
            variant="ghost"
          >
            <span aria-hidden="true">×</span>
          </IconButton>
        </div>
      </div>
    </li>
  )
}
