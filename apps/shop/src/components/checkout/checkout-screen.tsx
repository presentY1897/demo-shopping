'use client'

import type { Address, Checkout } from '@shopping/shared'
import { Button, Checkbox, EmptyState, ErrorState } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import { useState } from 'react'

import { useAddressBook } from '@/lib/checkout/use-address-book'
import { formatRemaining } from '@/lib/checkout/remaining'
import { useCheckout } from '@/lib/checkout/use-checkout'
import type { CheckoutMessages } from '@/messages'

const CURRENCY = 'KRW'

export interface CheckoutScreenProps {
  readonly id: string
  readonly messages: CheckoutMessages
}

/**
 * 주문서 (TASK-0050).
 *
 * **진입이 재고를 잡지 않는다** (4.1). 잡은 것은 장바구니의 「주문하기」이고 이
 * 화면은 그 결과를 id 로 읽는다 — 그래서 새로고침은 예약을 한 벌 더 만들지 않고
 * 같은 주문서를 다시 읽는다.
 *
 * 만료는 **화면 전체가 바뀌는 사건**이다. 잡아 둔 재고가 풀렸으므로 여기 적힌
 * 금액도 수량도 더는 보장되지 않는다 — 일부만 회색으로 만들면 사람은 남은 것을
 * 살 수 있다고 믿는다.
 */
export function CheckoutScreen({ id, messages }: CheckoutScreenProps) {
  const { state, remaining, placing, placeFailed, place } = useCheckout(id)
  const addresses = useAddressBook()
  const [chosen, setChosen] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)

  if (state.status === 'loading') {
    return (
      <p aria-live="polite" className="text-fg-muted py-16 text-center text-sm">
        {messages.loading}
      </p>
    )
  }

  if (state.status === 'placed') {
    return (
      <EmptyState
        action={
          <Link className="text-accent text-sm font-medium underline" href="/">
            {messages.backToCart}
          </Link>
        }
        description={`${messages.placedBody} ${messages.placedOrderNumber.replace('{number}', state.orderNumber)}`}
        title={messages.placedTitle}
      />
    )
  }

  if (state.status === 'gone' || remaining?.expired === true) {
    return (
      <EmptyState
        action={
          <Link className="text-accent text-sm font-medium underline" href="/cart">
            {messages.backToCart}
          </Link>
        }
        description={messages.expiredBody}
        title={messages.expiredTitle}
      />
    )
  }

  if (state.status === 'failed') {
    return <ErrorState description={messages.failedBody} title={messages.failedTitle} />
  }

  const { checkout } = state
  const address = addresses.rows.find((row) => row.id === (chosen ?? defaultOf(addresses.rows)))
  const ready = address !== undefined && agreed && !placing

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Timer messages={messages} remaining={remaining} />
        <Items checkout={checkout} messages={messages} />

        <Recipients
          chosen={address?.id ?? null}
          messages={messages}
          onChoose={setChosen}
          rows={addresses.rows}
        />

        <Placeholder body={messages.couponBody} title={messages.couponTitle} />
        <Placeholder body={messages.paymentBody} title={messages.paymentTitle} />
      </div>

      <div className="lg:w-80 lg:shrink-0">
        <Summary
          agreed={agreed}
          checkout={checkout}
          messages={messages}
          missingRecipient={address === undefined}
          onAgree={setAgreed}
          onPlace={() => {
            if (address !== undefined) place(address.id)
          }}
          placeFailed={placeFailed}
          placing={placing}
          ready={ready}
        />
      </div>
    </div>
  )
}

/** 기본 배송지가 맨 앞이다 (TASK-0111). 아무것도 없으면 고를 것이 없다. */
function defaultOf(rows: readonly Address[]): string | null {
  return rows[0]?.id ?? null
}

function Timer({
  remaining,
  messages,
}: {
  readonly remaining: ReturnType<typeof formatRemaining> extends string
    ? Parameters<typeof formatRemaining>[0] | null
    : never
  readonly messages: CheckoutMessages
}) {
  if (remaining === null) return null

  const text = (remaining.urgent ? messages.remainingUrgent : messages.remaining).replace(
    '{time}',
    formatRemaining(remaining),
  )

  return (
    // `aria-live` 지만 `polite` 다. 매초 읽어 주면 화면을 보지 않는 사람이 아무것도
    // 할 수 없고, 그것이 R1 이 걱정하는 압박의 가장 심한 형태다.
    <p
      aria-live="polite"
      className={
        remaining.urgent
          ? 'text-danger border-danger rounded-md border px-3 py-2 text-sm font-medium'
          : 'text-fg-muted border-border rounded-md border px-3 py-2 text-sm'
      }
    >
      {text}
    </p>
  )
}

function Items({
  checkout,
  messages,
}: {
  readonly checkout: Checkout
  readonly messages: CheckoutMessages
}) {
  return (
    <section aria-label={messages.itemsTitle} className="border-border rounded-lg border p-4">
      <h2 className="text-fg pb-2 text-sm font-semibold">{messages.itemsTitle}</h2>

      {checkout.sellerOrders.map((group) => (
        <div className="border-border border-t py-3 first:border-t-0" key={group.sellerId}>
          <p className="text-fg flex items-baseline justify-between gap-2 text-sm font-medium">
            <span className="truncate">{group.brandName}</span>
            <span className="text-fg-subtle shrink-0 text-xs">
              {formatMoney({ amount: group.shippingFee, currency: CURRENCY })}
            </span>
          </p>

          <ul className="flex flex-col gap-1 pt-2">
            {group.items.map((item) => (
              <li
                className="flex items-baseline justify-between gap-2 text-sm"
                key={item.variantId}
              >
                <span className="text-fg-muted min-w-0 truncate">
                  {item.snapshot.productName}
                  {item.snapshot.optionLabel === '' ? '' : ` · ${item.snapshot.optionLabel}`}
                  {` × ${String(item.quantity)}`}
                </span>
                <span className="text-fg shrink-0 tabular-nums">
                  {formatMoney({ amount: item.productAmount, currency: CURRENCY })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function Recipients({
  rows,
  chosen,
  messages,
  onChoose,
}: {
  readonly rows: readonly Address[]
  readonly chosen: string | null
  readonly messages: CheckoutMessages
  readonly onChoose: (id: string) => void
}) {
  return (
    <section aria-label={messages.recipientTitle} className="border-border rounded-lg border p-4">
      <h2 className="text-fg pb-2 text-sm font-semibold">{messages.recipientTitle}</h2>

      {rows.length === 0 ? (
        <p className="text-fg-muted text-sm">
          {messages.recipientNone}{' '}
          <Link className="text-accent underline" href="/mypage/addresses">
            {messages.recipientAdd}
          </Link>
        </p>
      ) : (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{messages.recipientChoose}</legend>
            {rows.map((row) => (
              <label className="flex items-start gap-2 text-sm" key={row.id}>
                <input
                  checked={chosen === row.id}
                  className="accent-accent mt-1 size-4"
                  name="recipient"
                  onChange={() => {
                    onChoose(row.id)
                  }}
                  type="radio"
                  value={row.id}
                />
                <span className="min-w-0">
                  <span className="text-fg block font-medium">
                    {row.recipientName} · {row.phone}
                  </span>
                  <span className="text-fg-subtle block">
                    ({row.postalCode}) {row.addressLine1}
                    {row.addressLine2 === null ? '' : ` ${row.addressLine2}`}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <p className="pt-2">
            <Link className="text-accent text-sm underline" href="/mypage/addresses">
              {messages.recipientAdd}
            </Link>
          </p>
        </>
      )}

      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="text-fg-muted">{messages.noteLabel}</span>
        <input
          className="border-border h-control-md text-fg rounded-md border px-3"
          maxLength={100}
          placeholder={messages.notePlaceholder}
          type="text"
        />
      </label>
    </section>
  )
}

/**
 * 아직 안 온 것의 자리 (4.5).
 *
 * 「준비 중」이 아니라 **무엇이 들어올지**를 적는다. 빈 상자는 만들다 만 화면으로
 * 보이고, 이름이 붙은 빈 상자는 아직 안 온 기능으로 보인다.
 */
function Placeholder({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <section aria-label={title} className="border-border bg-surface-muted rounded-lg border p-4">
      <h2 className="text-fg text-sm font-semibold">{title}</h2>
      <p className="text-fg-muted pt-1 text-sm">{body}</p>
    </section>
  )
}

function Summary({
  checkout,
  messages,
  agreed,
  onAgree,
  onPlace,
  ready,
  placing,
  placeFailed,
  missingRecipient,
}: {
  readonly checkout: Checkout
  readonly messages: CheckoutMessages
  readonly agreed: boolean
  readonly onAgree: (next: boolean) => void
  readonly onPlace: () => void
  readonly ready: boolean
  readonly placing: boolean
  readonly placeFailed: boolean
  readonly missingRecipient: boolean
}) {
  const discount = checkout.totalCouponDiscountAmount + checkout.totalPointDiscountAmount

  return (
    <aside
      aria-label={messages.summaryTitle}
      className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4"
    >
      <h2 className="text-fg text-sm font-semibold">{messages.summaryTitle}</h2>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">{messages.productAmountLabel}</dt>
          <dd className="text-fg tabular-nums">
            {formatMoney({ amount: checkout.totalProductAmount, currency: CURRENCY })}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">{messages.discountLabel}</dt>
          <dd className="text-fg tabular-nums">
            {formatMoney({ amount: discount, currency: CURRENCY })}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">{messages.shippingLabel}</dt>
          <dd className="text-fg tabular-nums">
            {formatMoney({ amount: checkout.totalShippingFee, currency: CURRENCY })}
          </dd>
        </div>
        <div className="border-border flex items-baseline justify-between gap-2 border-t pt-2">
          <dt className="text-fg font-semibold">{messages.totalLabel}</dt>
          <dd className="text-fg text-lg font-bold tabular-nums">
            {formatMoney({ amount: checkout.paidAmount, currency: CURRENCY })}
          </dd>
        </div>
      </dl>

      <Checkbox
        checked={agreed}
        label={messages.termsLabel}
        onCheckedChange={(next) => {
          onAgree(next === true)
        }}
      />

      <Button disabled={!ready} loading={placing} onClick={onPlace} type="button">
        {placing ? messages.placing : messages.placeOrder}
      </Button>

      {/*
        누를 수 없는 이유를 그 아래 적는다. 이유 없는 비활성 컨트롤을 보면 사람은
        자기 화면이 고장 났다고 생각한다.
      */}
      {ready ? null : (
        <p className="text-fg-subtle text-xs">
          {missingRecipient ? messages.recipientRequired : messages.termsRequired}
        </p>
      )}

      {placeFailed ? (
        <p aria-live="polite" className="text-danger text-xs">
          {messages.placeFailed}
        </p>
      ) : null}
    </aside>
  )
}
