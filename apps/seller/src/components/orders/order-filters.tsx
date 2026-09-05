'use client'

import { Button, Input } from '@shopping/ui/components'
import { useId } from 'react'

import type { SellerOrderFilters } from '@/lib/orders/use-seller-orders'
import { EMPTY_ORDER_FILTERS } from '@/lib/orders/use-seller-orders'
import type { OrderListMessages } from '@/messages'

/**
 * 기간과 검색어.
 *
 * 상태는 위의 탭이 맡으므로 여기 없다 — 한 조건을 두 자리에서 고를 수 있게 만들면
 * 어느 쪽이 이기는지를 정해야 하고, 그 규칙은 아무도 기억하지 못한다.
 *
 * **기간이 거꾸로면 그 자리에서 말한다** (U2). 서버는 그 질의에 0건으로 답하고 그것은
 * 틀린 답이 아니지만, 판매자가 보는 것은 「주문이 없다」이지 「날짜를 거꾸로 골랐다」가
 * 아니다. 입력을 막지 않는 것은 고치는 방법이 그 입력뿐이기 때문이고, 대신 오류가
 * **그 필드에** 붙어 어느 칸을 고쳐야 하는지 말한다.
 */
export interface OrderFiltersProps {
  readonly value: SellerOrderFilters
  readonly onChange: (filters: SellerOrderFilters) => void
  readonly messages: OrderListMessages
  readonly disabled?: boolean
}

export function OrderFilters({ value, onChange, messages, disabled = false }: OrderFiltersProps) {
  const fromId = useId()
  const toId = useId()
  const searchId = useId()
  const errorId = useId()

  const reversed = value.from !== '' && value.to !== '' && value.to < value.from

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

        <div className="flex flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={fromId}>
            {messages.filters.fromLabel}
          </label>
          <Input
            disabled={disabled}
            id={fromId}
            invalid={reversed}
            onChange={(event) => {
              onChange({ ...value, from: event.target.value })
            }}
            type="date"
            value={value.from}
            {...(reversed ? { 'aria-describedby': errorId } : {})}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={toId}>
            {messages.filters.toLabel}
          </label>
          <Input
            disabled={disabled}
            id={toId}
            invalid={reversed}
            onChange={(event) => {
              onChange({ ...value, to: event.target.value })
            }}
            type="date"
            value={value.to}
            {...(reversed ? { 'aria-describedby': errorId } : {})}
          />
        </div>

        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <label className="text-fg-muted text-sm" htmlFor={searchId}>
            {messages.filters.searchLabel}
          </label>
          <Input
            disabled={disabled}
            id={searchId}
            onChange={(event) => {
              onChange({ ...value, q: event.target.value })
            }}
            placeholder={messages.filters.searchPlaceholder}
            type="search"
            value={value.q}
          />
        </div>

        <Button
          onClick={() => {
            // 탭은 남긴다. 「조건 지우기」가 탭까지 되돌리면 판매자는 보고 있던
            // 목록을 잃고, 그것은 지우려던 것이 아니다.
            onChange({ ...EMPTY_ORDER_FILTERS, tab: value.tab })
          }}
          type="button"
          variant="ghost"
        >
          {messages.filters.reset}
        </Button>
      </fieldset>

      {reversed ? (
        <p className="text-danger w-full text-sm" id={errorId} role="alert">
          {messages.filters.rangeReversed}
        </p>
      ) : null}
    </form>
  )
}
