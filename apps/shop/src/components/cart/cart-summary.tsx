'use client'

import { Button } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'

import type { CartTotals } from '@/lib/cart/totals'
import type { CartMessages } from '@/messages'

const CURRENCY = 'KRW'

export interface CartSummaryProps {
  readonly totals: CartTotals
  readonly busy: boolean
  readonly messages: CartMessages
  /** 주문서를 연다 — 그 요청이 재고를 잡는다 (TASK-0050 4.1). */
  readonly onCheckout: () => void
  readonly opening: boolean
  /** 주문서를 열지 못했다. 대부분 품절이다. */
  readonly openFailed: boolean
}

/**
 * 합계와 주문 버튼 (TASK-0046 F2 · F4).
 *
 * 세 줄이 전부다 — 상품금액 · 배송비 · 결제예정금액. 할인 줄은 M11 이 붙인다.
 *
 * 아무것도 고르지 않았으면 버튼이 **비활성이고 이유가 그 아래 있다.** 누를 수 없는
 * 컨트롤을 이유 없이 두면 사람은 자기 화면이 고장 났다고 생각한다.
 */
export function CartSummary({
  totals,
  busy,
  messages,
  onCheckout,
  opening,
  openFailed,
}: CartSummaryProps) {
  // 쓰기가 도는 동안에는 합계가 곧 달라진다. 그 순간의 숫자를 들고 주문서로
  // 넘어가면 주문서가 보여 주는 금액과 방금 본 금액이 다르다.
  const ready = totals.selectedCount > 0 && !busy && !opening

  return (
    <aside
      aria-label={messages.totalLabel}
      className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4"
    >
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">{messages.productAmountLabel}</dt>
          <dd className="text-fg tabular-nums">
            {formatMoney({ amount: totals.productAmount, currency: CURRENCY })}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">{messages.shippingLabel}</dt>
          <dd className="text-fg tabular-nums">
            {formatMoney({ amount: totals.shippingFee, currency: CURRENCY })}
          </dd>
        </div>
        <div className="border-border flex items-baseline justify-between gap-2 border-t pt-2">
          <dt className="text-fg font-semibold">{messages.totalLabel}</dt>
          <dd className="text-fg text-lg font-bold tabular-nums">
            {formatMoney({ amount: totals.paidAmount, currency: CURRENCY })}
          </dd>
        </div>
      </dl>

      {ready ? (
        // 버튼이다. **주문서를 여는 일이 곧 재고를 잡는 일**이라(TASK-0050 4.1)
        // 이동이 아니라 요청이고, 링크로 두면 새 탭마다 예약이 한 벌씩 잡힌다.
        <Button loading={opening} onClick={onCheckout} type="button">
          {messages.checkout.replace('{count}', String(totals.selectedCount))}
        </Button>
      ) : (
        <>
          <Button aria-disabled className="w-full" type="button">
            {messages.checkout.replace('{count}', '0')}
          </Button>
          <p className="text-fg-subtle text-xs">{messages.nothingSelected}</p>
        </>
      )}

      {openFailed ? (
        <p aria-live="polite" className="text-danger text-xs">
          {messages.checkoutFailed}
        </p>
      ) : null}
    </aside>
  )
}
