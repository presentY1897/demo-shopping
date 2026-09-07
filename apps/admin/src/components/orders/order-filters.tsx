'use client'

import { Button, Input, Select } from '@shopping/ui/components'
import { useId, useState } from 'react'

import type { OrderFilters as Filters } from '@/lib/catalog/order-console'
import { EMPTY_ORDER_FILTERS, ORDER_NUMBER_MAX, orderIssuesOf } from '@/lib/catalog/order-console'
import type { StoreChoicesState } from '@/lib/stores/use-stores'
import type { AdminOrderListMessages } from '@/messages'

/**
 * CS 가 손에 쥐는 조건들 (F4).
 *
 * ## 검색은 **누른 뒤에** 나간다
 *
 * 다섯 칸 중 넷이 자유 입력이라, 고르는 즉시 보내는 셀렉트의 규약을 쓸 수 없다 —
 * 「20260906」까지 치는 사이에 요청이 여덟 번 나가고 그중 일곱은 아무도 보지 않을
 * 답이다. 그래서 이 컴포넌트는 **초안**을 들고 있고 제출이 그것을 필터로 옮긴다
 * (`user-filters.tsx` 의 검색 칸과 같은 판단, 여기서는 스토어까지 초안이다).
 *
 * ## 보내기 전에 되돌려보내는 것이 둘 있다
 *
 * 잘못된 uuid 와 뒤집힌 기간이다. 앞엣것은 400 을 받고, 뒤엣것은 **200 과 빈 목록**을
 * 받는다 — 그리고 그 빈 목록은 조건 탓이라고 말해 주지 않는다. 판정은 순수 함수의
 * 것이다 (`lib/catalog/order-console.ts` 의 `orderIssuesOf`).
 *
 * ## 주문번호는 정확히 일치다
 *
 * 부분 일치로 두면 비슷한 번호가 섞여 나오고, CS 는 그중 어느 것이 그 주문인지 알
 * 방법이 없다 (4.3). 화면이 그 사실을 미리 말하지 않으면 앞 몇 글자만 치고 「없다」를
 * 받는다.
 */

const ALL = 'ALL'

export interface OrderFiltersProps {
  readonly value: Filters
  readonly onChange: (filters: Filters) => void
  readonly messages: AdminOrderListMessages
  readonly stores: StoreChoicesState
  readonly disabled?: boolean
}

export function OrderFilters({
  value,
  onChange,
  messages,
  stores,
  disabled = false,
}: OrderFiltersProps) {
  const orderNumberId = useId()
  const orderNumberHintId = useId()
  const buyerId = useId()
  const buyerHintId = useId()
  const sellerId = useId()
  const fromId = useId()
  const toId = useId()

  /**
   * 아직 보내지 않은 조건.
   *
   * 밖에서 들어온 값을 효과로 따라가지 **않는다.** `value` 를 바꾸는 길이 이
   * 컴포넌트의 제출과 「조건 지우기」 둘뿐이고 둘 다 여기서 초안을 함께 손보므로,
   * 동기화 효과는 할 일이 없는 채로 렌더를 한 번 더 돌게 만들 뿐이다.
   */
  const [draft, setDraft] = useState<Filters>(value)

  /** 제출을 눌러 본 뒤에만 문장을 세운다. 치는 동안 빨간 줄이 따라다니지 않게. */
  const [attempted, setAttempted] = useState(false)

  const { filters } = messages
  const issues = orderIssuesOf(draft)
  const shown = attempted ? issues : []

  const storeOptions = [
    { value: ALL, label: filters.sellerAll },
    ...(stores.status === 'ready'
      ? stores.choices.map((store) => ({ value: store.id, label: store.name }))
      : []),
  ]

  return (
    <form
      className="border-border bg-surface-muted flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        setAttempted(true)

        // 되돌려보낼 것이 있으면 아무것도 보내지 않는다. 문장은 바로 아래에 선다.
        if (issues.length > 0) return

        onChange(draft)
      }}
      role="search"
    >
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="sr-only">{filters.legend}</legend>

        <div className="flex min-w-56 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={orderNumberId}>
            {filters.orderNumberLabel}
          </label>
          <Input
            aria-describedby={orderNumberHintId}
            disabled={disabled}
            id={orderNumberId}
            maxLength={ORDER_NUMBER_MAX}
            onChange={(event) => {
              setDraft({ ...draft, orderNumber: event.target.value })
            }}
            placeholder={filters.orderNumberPlaceholder}
            type="search"
            value={draft.orderNumber}
          />
          <p className="text-fg-subtle text-xs" id={orderNumberHintId}>
            {filters.orderNumberHint}
          </p>
        </div>

        <div className="flex min-w-56 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={buyerId}>
            {filters.buyerIdLabel}
          </label>
          <Input
            aria-describedby={buyerHintId}
            disabled={disabled}
            id={buyerId}
            invalid={shown.includes('buyerId')}
            onChange={(event) => {
              setDraft({ ...draft, buyerId: event.target.value })
            }}
            placeholder={filters.buyerIdPlaceholder}
            type="search"
            value={draft.buyerId}
          />
          <p className="text-fg-subtle text-xs" id={buyerHintId}>
            {filters.buyerIdHint}
          </p>
        </div>

        <div className="flex min-w-56 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={sellerId}>
            {filters.sellerLabel}
          </label>
          <Select
            disabled={disabled || stores.status === 'loading'}
            id={sellerId}
            onValueChange={(next) => {
              setDraft({ ...draft, sellerId: next === ALL ? null : next })
            }}
            options={storeOptions}
            value={draft.sellerId ?? ALL}
          />
          {stores.status === 'loading' ? (
            <p className="text-fg-subtle text-xs">{filters.sellerLoading}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={fromId}>
            {filters.fromLabel}
          </label>
          <Input
            disabled={disabled}
            id={fromId}
            invalid={shown.includes('range')}
            onChange={(event) => {
              setDraft({ ...draft, from: event.target.value })
            }}
            type="date"
            value={draft.from}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={toId}>
            {filters.toLabel}
          </label>
          <Input
            disabled={disabled}
            id={toId}
            invalid={shown.includes('range')}
            onChange={(event) => {
              setDraft({ ...draft, to: event.target.value })
            }}
            type="date"
            value={draft.to}
          />
        </div>

        <Button disabled={disabled} type="submit" variant="primary">
          {filters.submit}
        </Button>

        <Button
          onClick={() => {
            setAttempted(false)
            setDraft(EMPTY_ORDER_FILTERS)
            onChange(EMPTY_ORDER_FILTERS)
          }}
          type="button"
          variant="ghost"
        >
          {filters.reset}
        </Button>
      </fieldset>

      {shown.length === 0 ? null : (
        <ul className="text-danger flex flex-col gap-1 text-sm" role="alert">
          {shown.map((issue) => (
            <li key={issue}>{filters.issues[issue]}</li>
          ))}
        </ul>
      )}
    </form>
  )
}
