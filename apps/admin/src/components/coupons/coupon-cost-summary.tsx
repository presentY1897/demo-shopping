'use client'

import { couponCount, couponMoney } from '@/lib/coupons/format'
import type { CouponCostEstimate } from '@/lib/coupons/platform-coupons'
import type { CouponCostMessages } from '@/messages'

/**
 * 발급 수량 × 최대 할인액 (F3) — **쿠폰이 존재하기 전에.**
 *
 * 이 화면에서 가장 중요한 갈래는 숫자가 아니라 **숫자가 없는 쪽**이다. 상한이 없는
 * 정률 쿠폰의 최대 비용은 무한대이고, 그 자리에 「10 × 1,000」 같은 그럴듯한 값을
 * 적으면 그것은 계산이 아니라 거짓말이다 — 퍼센트와 원을 곱한 수에는 아무 뜻이 없다.
 * 그래서 계산할 수 없을 때는 **계산할 수 없다는 사실과 그 이유**를 적는다. 이유가
 * 둘인 것은 사람이 할 일이 다르기 때문이다: 상한을 채우거나, 수량을 채우거나.
 *
 * 판정은 `lib/coupons/platform-coupons.ts` 의 순수 함수가 쥔다. 여기 있는 것은 그
 * 답을 그리는 일뿐이고, 그래서 이 컴포넌트에는 산수가 없다.
 *
 * 확인 다이얼로그(R1)가 같은 컴포넌트를 다시 그린다 — 발행 직전에 보는 숫자와 폼에서
 * 보던 숫자가 다르면 확인은 확인이 아니다.
 */

export interface CouponCostSummaryProps {
  readonly estimate: CouponCostEstimate
  readonly messages: CouponCostMessages
}

export function CouponCostSummary({ estimate, messages }: CouponCostSummaryProps) {
  return (
    <section
      aria-label={messages.title}
      className="border-border bg-surface-muted flex flex-col gap-2 rounded-md border p-3"
    >
      {/*
        `h2` 다. 이 화면의 `h1` 은 `PageHeader` 의 것이고, 한 단계를 건너뛴 제목은
        화면을 제목으로 훑는 사람에게 **없는 절**을 만든다 (axe `heading-order`).
      */}
      <h2 className="text-fg text-sm font-medium">{messages.title}</h2>

      {estimate.kind === 'incomplete' ? (
        <p className="text-fg-muted text-sm">{messages.incomplete}</p>
      ) : null}

      {estimate.kind === 'unbounded' ? (
        <div className="flex flex-col gap-1">
          <p className="text-fg text-sm font-medium">{messages.unboundedTitle}</p>
          <ul className="text-fg-muted flex list-disc flex-col gap-1 ps-5 text-sm">
            {estimate.gaps.map((gap) => (
              <li key={gap}>{messages.gaps[gap]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {estimate.kind === 'estimated' ? (
        <div className="flex flex-col gap-1">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-fg-muted">{messages.perCouponLabel}</dt>
            <dd className="text-fg">{couponMoney(estimate.perCoupon)}</dd>
            <dt className="text-fg-muted">{messages.totalLabel}</dt>
            {/*
              합계와 함께 **곱셈을 보여 준다.** 숫자 하나만 남기면 그것이 어디서 나온
              값인지 알 수 없고, 발행자가 고쳐야 할 것은 그 두 값 중 하나다.
            */}
            <dd className="text-fg font-medium">
              {couponMoney(estimate.total)}
              <span className="text-fg-subtle ms-2 text-xs">
                {messages.formula
                  .replace('{count}', couponCount(estimate.count))
                  .replace('{amount}', couponMoney(estimate.perCoupon))}
              </span>
            </dd>
          </dl>
          <p className="text-fg-subtle text-xs">{messages.caveat}</p>
        </div>
      ) : null}
    </section>
  )
}
