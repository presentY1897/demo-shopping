'use client'

import type { Address, Checkout } from '@shopping/shared'
import { Button, Checkbox, EmptyState, ErrorState } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import { useState } from 'react'

import { PaymentSection } from '@/components/checkout/payment-section'
import { useAddressBook } from '@/lib/checkout/use-address-book'
import { formatRemaining } from '@/lib/checkout/remaining'
import { useCheckout } from '@/lib/checkout/use-checkout'
import { defaultMethod, methodById, methodId, paymentMethods } from '@/lib/payment/methods'
import { checkoutOrderName } from '@/lib/payment/order-name'
import { tossClientKey } from '@/lib/payment/toss'
import { usePayment } from '@/lib/payment/use-payment'
import type { CheckoutMessages } from '@/messages'

const CURRENCY = 'KRW'

export interface CheckoutScreenProps {
  readonly id: string
  readonly messages: CheckoutMessages
}

/**
 * 주문서 (TASK-0050 · TASK-0054).
 *
 * **진입이 재고를 잡지 않는다** (4.1). 잡은 것은 장바구니의 「주문하기」이고 이
 * 화면은 그 결과를 id 로 읽는다 — 그래서 새로고침은 예약을 한 벌 더 만들지 않고
 * 같은 주문서를 다시 읽는다.
 *
 * 만료는 **화면 전체가 바뀌는 사건**이다. 잡아 둔 재고가 풀렸으므로 여기 적힌
 * 금액도 수량도 더는 보장되지 않는다 — 일부만 회색으로 만들면 사람은 남은 것을
 * 살 수 있다고 믿는다.
 *
 * ## 「주문하기」가 결제까지 한다 (TASK-0054)
 *
 * 4.6 이 M08 에 남겨 둔 자리를 채우면서 이 버튼의 뜻이 정해졌다. **결제는 주문에
 * 붙는다** — `POST /payments` 가 `orderId` 를 받으므로 결제하려면 주문이 먼저
 * 있어야 한다. 그래서 고를 수 있는 순서는 둘뿐이었다.
 *
 * 1. 「주문하기」로 주문을 만들고, 그다음 「결제」를 한 번 더 누르게 한다.
 * 2. 「주문하기」가 주문을 만든 다음 그 주문에 결제를 건다.
 *
 * **2를 골랐다.** 사는 사람에게 「주문」과 「결제」는 한 가지 마음이고, 1은 주문만
 * 만들어 두고 결제하지 않은 사람을 화면이 만들어 낸다 — 그 사람의 재고는 잡혀 있고
 * 주문은 미결이며, 그 상태를 치우는 일이 곧 TASK-0057 이 떠안는 몫이다.
 *
 * **다시 눌러야 하는 것은 결제뿐이다.** 거절당했을 때 주문을 한 번 더 만들면 한
 * 사람이 같은 물건을 두 몫 잠근다. 그래서 재시도 버튼은 결제수단 영역 안에 있고
 * (`payment-section.tsx`), 이미 만든 주문을 그대로 쓴다 (`use-payment.ts`). 예약이
 * 유지되는 것이 그 재시도의 전제다 (TASK-0054 4.3).
 *
 * **주문을 만드는 자리는 `usePayment` 다.** 결제가 주문 id 를 필요로 하고, 주문
 * 생성과 결제가 한 흐름이어야 재시도가 「결제만 다시」가 된다. `useCheckout` 은
 * 그것을 만들지 않고 **알림만 받는다**(`placed`) — 주문이 생긴 순간부터 그 훅은
 * 떠날 때 예약을 풀지 않는다. 그 알림이 없으면 거절당하고 다른 카드로 다시 하려는
 * 사람의 재고를 우리 손으로 풀어 버린다.
 *
 * ## 토스를 골랐으면 이 화면은 **끝나지 않고 떠난다** (TASK-0055 4.2)
 *
 * 완료 화면으로 갈아 끼우는 조건은 `paid` 하나 그대로다. 결제창으로 넘어간 상태
 * (`leaving`)에서는 주문서가 그대로 남아 있고 문장만 하나 바뀐다 — 여기서 완료를
 * 그리면 창을 닫고 돌아온 사람이 「결제 완료」를 본 채로 결제되지 않은 주문을 갖고,
 * 그 착각을 막는 것이 이 TASK 의 값이다.
 *
 * 승인은 돌아온 화면(`app/checkout/toss/success`)이 한다. 그 화면이 이 주문서로
 * 돌아오는 길을 갖는 것은 우리가 `successUrl`·`failUrl` 에 주문서 id 를 실어
 * 보내기 때문이다(`tossReturnUrls`) — 토스가 돌려주는 셋 중 어느 것도 주문서를
 * 가리키지 않는다.
 */
export function CheckoutScreen({ id, messages }: CheckoutScreenProps) {
  const { state, remaining, placed } = useCheckout(id)
  const addresses = useAddressBook()
  // 주문이 생기는 순간 주문서 훅에게 알린다 — 그때부터 이 화면은 그 예약의 주인이
  // 아니고, 떠날 때 풀어서도 안 된다 (TASK-0054 4.3).
  const payment = usePayment(placed)
  const [chosen, setChosen] = useState<string | null>(null)
  const [chosenMethod, setChosenMethod] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)

  // 결제까지 끝났다. 이 주문서가 할 일은 여기서 끝나므로 화면 전체가 바뀐다 —
  // 예약은 이제 주문의 것이고, 확정한 것은 방금의 매입이다 (TASK-0054 4.2).
  if (payment.state.status === 'paid') {
    return (
      <Completed
        body={messages.payment.paidBody}
        messages={messages}
        orderNumber={payment.state.orderNumber}
        title={messages.payment.paidTitle}
      />
    )
  }

  if (state.status === 'loading') {
    return (
      <p aria-live="polite" className="text-fg-muted py-16 text-center text-sm">
        {messages.loading}
      </p>
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
  // 4.1 — 키가 없으면 토스는 목록에 **없다.** 지금 이 저장소가 그 상태다.
  const methods = paymentMethods(payment.cards, tossClientKey() !== null)
  const method = methodById(methods, chosenMethod) ?? defaultMethod(methods)
  // 결제창으로 넘어가는 중에도 누를 수 없다 — 그 사이에 또 누르면 결제가 두 벌 열린다.
  const paying = payment.state.status === 'running' || payment.state.status === 'leaving'
  const ready = address !== undefined && method !== null && agreed && !paying

  /**
   * 결제를 건다. 주문이 없으면 만들고, 있으면 그 주문에 다시 건다.
   *
   * 「주문하기」와 실패 뒤의 「다시 결제하기」가 **같은 함수**를 부른다. 두 번째가
   * 주문을 다시 만들지 않는 것은 `usePayment` 가 만든 주문을 들고 있기 때문이고,
   * 그 판단은 화면이 아니라 그쪽에 있다 — 여기서 나누면 같은 규칙이 두 곳에 산다.
   */
  const start = (): void => {
    if (address === undefined || method === null) return

    payment.pay({
      addressId: address.id,
      amount: checkout.paidAmount,
      checkoutId: checkout.id,
      method,
      // 결제창에 뜰 한 줄. 토스만 쓰지만 무엇으로 결제할지가 **누르는 순간**
      // 정해지므로, 문구를 아는 이 화면이 미리 만들어 넘긴다.
      orderName: checkoutOrderName(checkout, {
        more: messages.payment.toss.orderNameMore,
        single: messages.payment.toss.orderNameSingle,
      }),
    })
  }

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

        <PaymentSection
          chosen={method === null ? null : methodId(method)}
          loading={payment.loadingCards}
          messages={messages.payment}
          methods={methods}
          onChoose={setChosenMethod}
          onRetry={start}
          state={payment.state}
        />
      </div>

      <div className="lg:w-80 lg:shrink-0">
        <Summary
          agreed={agreed}
          checkout={checkout}
          messages={messages}
          missingMethod={method === null}
          missingRecipient={address === undefined}
          onAgree={setAgreed}
          onPlace={start}
          placeFailed={payment.orderFailed}
          placing={paying}
          ready={ready}
        />
      </div>
    </div>
  )
}

/**
 * 이 주문서의 끝 — 주문번호가 적힌 화면.
 *
 * 결제까지 끝난 경우와 주문만 접수된 경우가 같은 모양인 이유는 **사람이 여기서 하는
 * 일이 같기** 때문이다: 주문번호를 확인하고 나간다. 다른 것은 문장 둘뿐이라 그것만
 * 받는다.
 */
function Completed({
  title,
  body,
  orderNumber,
  messages,
}: {
  readonly title: string
  readonly body: string
  readonly orderNumber: string
  readonly messages: CheckoutMessages
}) {
  return (
    <EmptyState
      action={
        <Link className="text-accent text-sm font-medium underline" href="/">
          {messages.backToCart}
        </Link>
      }
      description={`${body} ${messages.placedOrderNumber.replace('{number}', orderNumber)}`}
      title={title}
    />
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
  missingMethod,
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
  readonly missingMethod: boolean
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
          {reasonOf({ messages, missingMethod, missingRecipient })}
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

/**
 * 왜 아직 주문할 수 없는가.
 *
 * 순서가 곧 「무엇을 먼저 말해 줄 것인가」다. 배송지가 먼저인 이유는 그것이 화면
 * 위쪽에 있어서이고, 동의가 마지막인 이유는 나머지가 다 채워진 사람에게 남는 것이
 * 그것 하나이기 때문이다.
 */
function reasonOf({
  missingRecipient,
  missingMethod,
  messages,
}: {
  readonly missingRecipient: boolean
  readonly missingMethod: boolean
  readonly messages: CheckoutMessages
}): string {
  if (missingRecipient) return messages.recipientRequired
  if (missingMethod) return messages.payment.methodRequired

  return messages.termsRequired
}
