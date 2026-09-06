'use client'

import type { CouponLifecycle } from '@shopping/shared'
import { couponLifecycles } from '@shopping/shared'
import { Button, Input, Select } from '@shopping/ui/components'
import { useId } from 'react'

import type { PlatformCouponFilters } from '@/lib/coupons/platform-coupons'
import { EMPTY_PLATFORM_COUPON_FILTERS } from '@/lib/coupons/platform-coupons'
import type { CouponListMessages, PlatformCouponMessages } from '@/messages'

/**
 * 상태와 기간으로 목록을 좁힌다.
 *
 * **다섯 개짜리 목록을 손으로 적지 않는다.** 상태가 하나 늘면 이 셀렉트는 저절로
 * 자라고, 문장이 없으면 `Record<CouponLifecycle, string>` 이 컴파일로 잡는다
 * (`claim-filters.tsx` 와 같은 규약).
 *
 * ## 기간은 「걸쳐 있는가」이지 「시작했는가」가 아니다
 *
 * 계약이 그렇게 정했고(`couponListQueryParamsSchema` 의 `from`·`to`), 그것이 발행자가
 * 실제로 묻는 질문이기 때문이다 — 「9월에 돌던 쿠폰」을 찾는 사람에게 8월에 시작해
 * 9월까지 가는 쿠폰은 **찾는 그 쿠폰**이고, 시작일로 거르면 그것이 목록에서 사라진다.
 * 그 규칙을 필터 아래 한 줄이 말한다: 감추면 「9월 1일부터」로 좁힌 사람이 8월에 시작한
 * 쿠폰을 보고 필터가 고장 났다고 여긴다.
 *
 * 날짜 칸이 받는 것은 **하루**이고 계약이 받는 것은 **순간**이다. 그 사이는
 * `queryOf` 가 한국 시간의 하루로 메운다 (`platform-coupons.ts`).
 */

export interface CouponFiltersProps {
  readonly value: PlatformCouponFilters
  readonly onChange: (filters: PlatformCouponFilters) => void
  readonly messages: CouponListMessages
  readonly lifecycleLabels: PlatformCouponMessages['lifecycleLabels']
  readonly disabled?: boolean
}

/**
 * 「전체」를 셀렉트의 값으로 나타내는 문자열.
 *
 * 빈 문자열을 쓸 수 없다 — 라딕스의 셀렉트는 그것을 「고르지 않음」으로 읽어 자리
 * 표시자로 되돌아간다. 열거형 어느 값과도 겹치지 않는 이름이면 된다.
 */
const ALL = 'ALL_LIFECYCLES'

export function CouponFilters({
  value,
  onChange,
  messages,
  lifecycleLabels,
  disabled = false,
}: CouponFiltersProps) {
  const lifecycleId = useId()
  const fromId = useId()
  const toId = useId()
  const { filters } = messages

  return (
    <form
      className="border-border bg-surface-muted flex flex-wrap items-end gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
      }}
      role="search"
    >
      <fieldset className="contents">
        <legend className="sr-only">{filters.legend}</legend>

        <div className="flex min-w-48 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={lifecycleId}>
            {filters.lifecycleLabel}
          </label>
          <Select
            disabled={disabled}
            id={lifecycleId}
            onValueChange={(next) => {
              onChange({ ...value, lifecycle: next === ALL ? null : (next as CouponLifecycle) })
            }}
            options={[
              { value: ALL, label: filters.lifecycleAll },
              ...couponLifecycles.map((lifecycle) => ({
                value: lifecycle,
                label: lifecycleLabels[lifecycle],
              })),
            ]}
            value={value.lifecycle ?? ALL}
          />
        </div>

        {/*
          날짜 입력 둘. 어느 한쪽만 채워도 뜻이 있다 — 「9월 1일부터 살아 있던 것」과
          「9월 30일까지 살아 있던 것」은 각각 완결된 질문이다.
        */}
        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={fromId}>
            {filters.fromLabel}
          </label>
          <Input
            disabled={disabled}
            id={fromId}
            onChange={(event) => {
              onChange({ ...value, from: event.target.value === '' ? null : event.target.value })
            }}
            type="date"
            value={value.from ?? ''}
          />
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={toId}>
            {filters.toLabel}
          </label>
          <Input
            disabled={disabled}
            id={toId}
            onChange={(event) => {
              onChange({ ...value, to: event.target.value === '' ? null : event.target.value })
            }}
            type="date"
            value={value.to ?? ''}
          />
        </div>

        <Button
          onClick={() => {
            onChange(EMPTY_PLATFORM_COUPON_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {filters.reset}
        </Button>
      </fieldset>

      <p className="text-fg-subtle basis-full text-xs">{filters.periodHint}</p>
    </form>
  )
}
