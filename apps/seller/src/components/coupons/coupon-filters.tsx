'use client'

import type { CouponLifecycle } from '@shopping/shared'
import { couponLifecycles } from '@shopping/shared'
import { Button, Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { SellerCouponFilters } from '@/lib/coupons/use-seller-coupons'
import { EMPTY_COUPON_FILTERS } from '@/lib/coupons/use-seller-coupons'
import type { CouponListMessages, CouponVocabularyMessages } from '@/messages'
import { messagesFor } from '@/messages'

/**
 * 상태 하나로 좁혀 보기.
 *
 * **축이 하나뿐이다.** 쿠폰 목록에서 판매자가 실제로 묻는 것은 「지금 나가고 있는
 * 것」과 「멈춘 것」과 「끝난 것」이고, 그 셋이 전부 `lifecycle` 한 축 위에 있다.
 * 두 번째 축을 만들면 어느 쪽이 이기는지를 정해야 하고 그 규칙은 아무도 기억하지
 * 못한다 (`claim-filters.tsx` 가 같은 문장을 적어 두었다).
 *
 * 다섯 개를 손으로 적지 않는다. 계약에 상태가 하나 늘면 이 목록은 저절로 자라고,
 * 문장이 없으면 `Record<CouponLifecycle, string>` 이 컴파일로 잡는다.
 */
export interface CouponFiltersProps {
  readonly value: SellerCouponFilters
  readonly onChange: (filters: SellerCouponFilters) => void
  readonly messages: CouponListMessages
  readonly vocabulary?: CouponVocabularyMessages
  readonly disabled?: boolean
}

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다. 열거형 어느 값과도 겹치지 않는 이름이면 된다.
 */
const ALL = 'ALL'

export function CouponFilters({
  value,
  onChange,
  messages,
  vocabulary = messagesFor().coupons,
  disabled = false,
}: CouponFiltersProps) {
  const lifecycleId = useId()

  return (
    <form
      className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
      }}
      role="search"
    >
      <fieldset className="contents">
        <legend className="sr-only">{messages.filters.legend}</legend>

        <div className="flex min-w-48 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={lifecycleId}>
            {messages.filters.lifecycleLabel}
          </label>
          <Select
            disabled={disabled}
            id={lifecycleId}
            onValueChange={(next) => {
              onChange({ lifecycle: next === ALL ? null : (next as CouponLifecycle) })
            }}
            options={[
              { value: ALL, label: messages.filters.lifecycleAll },
              ...couponLifecycles.map((lifecycle) => ({
                value: lifecycle,
                label: vocabulary.lifecycleLabels[lifecycle],
              })),
            ]}
            value={value.lifecycle ?? ALL}
          />
        </div>

        <Button
          onClick={() => {
            onChange(EMPTY_COUPON_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {messages.filters.reset}
        </Button>
      </fieldset>
    </form>
  )
}
