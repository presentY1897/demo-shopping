'use client'

import type { CouponStats } from '@shopping/shared'

import { couponCount, couponMoney } from '@/lib/coupons/format'
import type { CouponListMessages } from '@/messages'

/**
 * 플랫폼이 쿠폰으로 지금까지 쓴 것 (F6) — **줄들의 합이 아니다.**
 *
 * 서버가 페이지·필터와 무관한 집계로 따로 답하고
 * (`couponListResponseSchema.totals` · `CouponConsoleService.totalsOf`), 화면은 그것을
 * 그대로 그린다. 보이는 줄을 더해 만들면 다음 장을 넘길 때마다 누계가 달라지고,
 * 「지금까지 얼마를 부담했나」라는 질문에는 그런 답이 있을 수 없다.
 *
 * 그래서 **그 사실을 한 줄로 적어 둔다.** 상태를 좁힌 사람이 합계가 그대로인 것을
 * 보면, 적혀 있지 않은 한 그것은 버그로 읽힌다.
 */

export interface CouponTotalsProps {
  readonly totals: CouponStats
  readonly messages: CouponListMessages['totals']
}

export function CouponTotals({ totals, messages }: CouponTotalsProps) {
  return (
    <section
      aria-label={messages.title}
      className="border-border bg-surface-muted flex flex-col gap-2 rounded-md border p-3"
    >
      <h2 className="text-fg text-sm font-medium">{messages.title}</h2>

      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="text-fg-muted">{messages.usedLabel}</dt>
          <dd className="text-fg font-medium">{couponCount(totals.usedCount)}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-fg-muted">{messages.discountLabel}</dt>
          <dd className="text-fg font-medium">{couponMoney(totals.discountTotal)}</dd>
        </div>
      </dl>

      <p className="text-fg-subtle text-xs">{messages.scopeNote}</p>
    </section>
  )
}
