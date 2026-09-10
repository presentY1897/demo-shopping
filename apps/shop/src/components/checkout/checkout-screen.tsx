'use client'

import { ProductThumbnail } from '@/components/products/product-thumbnail'

import type { Address, AppliedCoupon, Checkout } from '@shopping/shared'
import { Button, Checkbox, EmptyState, ErrorState } from '@shopping/ui/components'
import { useMinWidth } from '@shopping/ui/layout'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cancelCheckout } from '@/lib/checkout/checkout-api'
import { useCheckoutDraft } from '@/lib/checkout/use-checkout-draft'
import { useEffect, useState } from 'react'

import { CouponSection } from '@/components/checkout/coupon-section'
import { PaymentSection } from '@/components/checkout/payment-section'
import { useAddressBook } from '@/lib/checkout/use-address-book'
import { formatRemaining } from '@/lib/checkout/remaining'
import { useCheckout } from '@/lib/checkout/use-checkout'
import { defaultMethod, methodById, methodId, paymentMethods } from '@/lib/payment/methods'
import { checkoutOrderName } from '@/lib/payment/order-name'
import { tossClientKey } from '@/lib/payment/toss'
import type { OrderRefusal } from '@/lib/payment/use-payment'
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
  const {
    restoreSelection,
    chooseCoupon,
    chooseRecommended,
    coupons,
    placed,
    rejected,
    remaining,
    repricing,
    selection,
    state,
  } = useCheckout(id)
  const addresses = useAddressBook()
  const router = useRouter()
  const draft = useCheckoutDraft(id, restoreSelection)
  const draftReady = draft.ready
  const updateDraft = draft.update
  useEffect(() => {
    if (draftReady) updateDraft({ userCouponIds: [...selection] })
  }, [draftReady, selection, updateDraft])
  // 주문이 생기는 순간 주문서 훅에게 알린다 — 그때부터 이 화면은 그 예약의 주인이
  // 아니고, 떠날 때 풀어서도 안 된다 (TASK-0054 4.3).
  const payment = usePayment(placed, id)
  const chosen = draft.draft.addressId
  const setChosen = (addressId: string) => draft.update({ addressId })
  const [chosenMethod, setChosenMethod] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)
  const [cancelFailed, setCancelFailed] = useState(false)
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
        orderId={payment.ordered?.id}
        amount={payment.ordered?.paidAmount}
      />
    )
  }

  if (draft.loadFailed)
    return (
      <ErrorState
        title={messages.failedTitle}
        description={messages.draftFailed}
        action={<Button onClick={draft.retry}>{messages.retryDraft}</Button>}
      />
    )

  if (state.status === 'loading' || payment.restoring || !draft.ready || addresses.loading) {
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

  const checkout =
    payment.ordered === null ? state.checkout : { ...state.checkout, ...payment.ordered }
  const address = addresses.rows.find((row) => row.id === (chosen ?? defaultOf(addresses.rows)))
  // 4.1 — 키가 없으면 토스는 목록에 **없다.** 지금 이 저장소가 그 상태다.
  const methods = paymentMethods(payment.cards, tossClientKey() !== null)
  const method = methodById(methods, chosenMethod) ?? defaultMethod(methods)
  // 결제창으로 넘어가는 중에도 누를 수 없다 — 그 사이에 또 누르면 결제가 두 벌 열린다.
  const awaiting = payment.state.status === 'failed' && payment.state.refusal === 'awaiting_result'
  const paying =
    payment.state.status === 'running' || payment.state.status === 'leaving' || awaiting
  // 쿠폰을 반영한 금액을 기다리는 동안에도 누를 수 없다 (TASK-0075). 주문에 실리는
  // 선택은 **화면이 보여 준 금액을 만든 그 선택**이어야 하는데, 다시 읽는 중에는
  // 그 둘이 같다고 말할 수 없다 — 여기서 열어 두면 앞의 금액을 보면서 뒤의 선택으로
  // 주문하는 순간이 생긴다.
  const ready =
    address !== undefined && method !== null && agreed && !paying && !repricing && !canceling

  /**
   * 결제를 건다. 주문이 없으면 만들고, 있으면 그 주문에 다시 건다.
   *
   * 「주문하기」와 실패 뒤의 「다시 결제하기」가 **같은 함수**를 부른다. 두 번째가
   * 주문을 다시 만들지 않는 것은 `usePayment` 가 만든 주문을 들고 있기 때문이고,
   * 그 판단은 화면이 아니라 그쪽에 있다 — 여기서 나누면 같은 규칙이 두 곳에 산다.
   */
  const start = (): void => {
    if (!ready || address === undefined || method === null) return

    payment.pay({
      deliveryNote: draft.draft.deliveryNote,
      addressId: address.id,
      amount: checkout.paidAmount,
      checkoutId: checkout.id,
      method,
      // 주문서를 읽을 때 넘긴 것과 **같은 선택**이다 (계약). 「주문하기」가
      // 눌리는 순간 `repricing` 이 거짓이므로, 이 배열은 위의 금액을 만든 바로
      // 그 배열이다.
      userCouponIds: selection,
      // 결제창에 뜰 한 줄. 토스만 쓰지만 무엇으로 결제할지가 **누르는 순간**
      // 정해지므로, 문구를 아는 이 화면이 미리 만들어 넘긴다.
      orderName: checkoutOrderName(checkout, {
        more: messages.payment.toss.orderNameMore,
        single: messages.payment.toss.orderNameSingle,
      }),
    })
  }

  return (
    <div
      className="flex flex-col gap-4 pb-28 lg:flex-row lg:items-start lg:pb-0"
      onFocusCapture={(event) => {
        const target = event.target
        requestAnimationFrame(() => {
          const bar = document.querySelector<HTMLElement>('[data-checkout-cta]')
          if (
            bar === null ||
            bar.contains(target) ||
            getComputedStyle(bar).position !== 'fixed' ||
            !target.isConnected
          )
            return
          const bottom = target.getBoundingClientRect().bottom
          const top = bar.getBoundingClientRect().top
          if (bottom > top)
            window.scrollBy({
              top: bottom - top + parseFloat(getComputedStyle(bar).paddingTop),
              behavior: 'instant',
            })
        })
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Timer messages={messages} remaining={remaining} />
        {payment.ordered === null ? (
          <Button
            disabled={canceling || paying}
            variant="ghost"
            onClick={() => {
              setCanceling(true)
              setCancelFailed(false)
              void cancelCheckout(id)
                .then(() => router.push('/cart'))
                .catch(() => {
                  setCancelFailed(true)
                  setCanceling(false)
                })
            }}
          >
            {messages.cancelCheckout}
          </Button>
        ) : null}
        {cancelFailed ? (
          <p role="alert" className="text-danger text-sm">
            {messages.cancelFailed}
          </p>
        ) : null}
        {draft.failed ? (
          <div role="alert">
            {messages.draftFailed}
            <Button
              onClick={() => {
                void draft.flush().catch(() => undefined)
              }}
            >
              {messages.retryDraft}
            </Button>
          </div>
        ) : null}
        <Items checkout={checkout} messages={messages} />

        <fieldset disabled={payment.ordered !== null || paying}>
          {payment.ordered !== null ? (
            <p className="text-sm">
              {payment.ordered.recipient.name} · {payment.ordered.recipient.addressLine1}{' '}
              {payment.ordered.recipient.addressLine2}
            </p>
          ) : addresses.failed ? (
            <ErrorState
              title={messages.failedTitle}
              description={messages.failedBody}
              action={<Button onClick={addresses.retry}>{messages.retryDraft}</Button>}
            />
          ) : (
            <Recipients
              chosen={address?.id ?? null}
              messages={messages}
              onChoose={setChosen}
              rows={addresses.rows}
              note={draft.draft.deliveryNote}
              onNote={(deliveryNote) => draft.update({ deliveryNote })}
              onAdd={async () => {
                await draft.flush()
                router.push('/mypage/addresses')
              }}
            />
          )}

          <CouponSection
            appliedCount={checkout.appliedCoupons.length}
            coupons={coupons}
            discount={checkout.totalCouponDiscountAmount}
            messages={messages.coupon}
            onChoose={chooseCoupon}
            onRecommend={chooseRecommended}
            rejected={rejected}
            repricing={repricing}
            selection={selection}
          />
        </fieldset>

        <PaymentSection
          chosen={method === null ? null : methodId(method)}
          loading={payment.loadingCards}
          failed={payment.cardsFailed}
          onReload={payment.reloadCards}
          messages={messages.payment}
          methods={methods}
          onChoose={setChosenMethod}
          onRetry={start}
          retryAllowed={ready}
          state={payment.state}
        />
        {awaiting ? (
          <div className="flex gap-3">
            <Button onClick={payment.recover}>{messages.payment.checkResult}</Button>
            <Link href="/mypage/orders">{messages.payment.viewOrders}</Link>
          </div>
        ) : null}
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
          placing={paying}
          ready={ready}
          refusal={payment.orderRefusal}
          repricing={repricing}
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
  orderId,
  amount,
}: {
  readonly orderId?: string | undefined
  readonly amount?: number | undefined
  readonly title: string
  readonly body: string
  readonly orderNumber: string
  readonly messages: CheckoutMessages
}) {
  return (
    <EmptyState
      action={
        <Link
          className="text-accent text-sm font-medium underline"
          href={orderId === undefined ? '/mypage/orders' : `/mypage/orders/${orderId}`}
        >
          {messages.payment.viewOrders}
        </Link>
      }
      description={`${body} ${messages.placedOrderNumber.replace('{number}', orderNumber)} ${amount === undefined ? '' : formatMoney({ amount, currency: CURRENCY })}`}
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
              <li className="flex items-center justify-between gap-2 text-sm" key={item.variantId}>
                <ProductThumbnail
                  src={item.snapshot.thumbnailUrl}
                  className="size-14 shrink-0 rounded"
                />
                <span className="text-fg-muted min-w-0 flex-1">
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
  note,
  onNote,
  onAdd,
}: {
  readonly rows: readonly Address[]
  readonly chosen: string | null
  readonly messages: CheckoutMessages
  readonly note: string
  readonly onNote: (value: string) => void
  readonly onAdd: () => Promise<void>
  readonly onChoose: (id: string) => void
}) {
  return (
    <section aria-label={messages.recipientTitle} className="border-border rounded-lg border p-4">
      <h2 className="text-fg pb-2 text-sm font-semibold">{messages.recipientTitle}</h2>

      {rows.length === 0 ? (
        <p className="text-fg-muted text-sm">
          {messages.recipientNone}{' '}
          <Link
            className="text-accent underline"
            href="/mypage/addresses"
            onClick={(event) => {
              event.preventDefault()
              void onAdd().catch(() => undefined)
            }}
          >
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
            <Link
              className="text-accent text-sm underline"
              href="/mypage/addresses"
              onClick={(event) => {
                event.preventDefault()
                void onAdd().catch(() => undefined)
              }}
            >
              {messages.recipientAdd}
            </Link>
          </p>
        </>
      )}

      <label className="mt-3 flex flex-col gap-1 text-sm">
        <span className="text-fg-muted">{messages.noteLabel}</span>
        <input
          className="border-border h-control-md text-fg rounded-md border px-3"
          value={note}
          onChange={(event) => onNote(event.target.value)}
          maxLength={100}
          placeholder={messages.notePlaceholder}
          type="text"
        />
      </label>
    </section>
  )
}

/** 버튼과 그 이유를 묶는 id. 주문서는 한 쪽에 하나라 고정값으로 충분하다. */
const REASON_ID = 'checkout-place-reason'

function Summary({
  checkout,
  messages,
  agreed,
  onAgree,
  onPlace,
  ready,
  placing,
  refusal,
  repricing,
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
  readonly refusal: OrderRefusal | null
  readonly repricing: boolean
  readonly missingRecipient: boolean
  readonly missingMethod: boolean
}) {
  const desktop = useMinWidth(1024)
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
        {/*
          적용된 쿠폰을 **장별로** 적는다 (TASK-0075). 합계 한 줄로 끝내면 두 장이
          같은 항목을 겹쳐 덮어 뒤엣것이 잘린 사정이 어디에도 드러나지 않는다 —
          계약이 `appliedCoupons` 를 장별로 싣는 이유가 그것이고, 여기가 그 값이
          쓰이는 자리다.
        */}
        {checkout.appliedCoupons.map((applied) => (
          <AppliedCouponLine applied={applied} key={applied.userCouponId} messages={messages} />
        ))}
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

      <div
        data-checkout-cta
        className="bg-surface border-border fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t p-4 pb-[max(calc(var(--spacing)*4),env(safe-area-inset-bottom))] lg:static lg:flex-col lg:items-stretch lg:border-0 lg:p-0"
      >
        {!desktop ? (
          <span className="text-fg font-bold tabular-nums">
            {formatMoney({ amount: checkout.paidAmount, currency: CURRENCY })}
          </span>
        ) : null}
        <Button
          // 아직 누를 수 없을 때는 `aria-disabled` 다 (`disabled` 가 아니다). 진짜
          // `disabled` 는 **탭 순서에서 사라져** 마우스를 쓰지 않는 사람이 버튼에도
          // 그 아래 이유에도 닿지 못한다 — TASK-0099 의 키보드 완주가 여기서 막혔다.
          // 담기 버튼이 먼저 같은 판단을 했다(`purchase-controls.tsx`).
          //
          // 요청이 도는 동안은 진짜 `disabled` 다: 그때는 읽을 이유가 없고, 두 번
          // 눌리면 주문이 두 번 나간다.
          aria-describedby={ready ? undefined : REASON_ID}
          aria-disabled={!ready}
          disabled={placing}
          loading={placing}
          onClick={() => {
            // `aria-disabled` 는 클릭을 막지 않는다 — 막는 것은 여기다.
            if (!ready) return

            onPlace()
          }}
          type="button"
        >
          {placing ? messages.placing : messages.placeOrder}
        </Button>
      </div>

      {/*
        누를 수 없는 이유를 그 아래 적는다. 이유 없는 비활성 컨트롤을 보면 사람은
        자기 화면이 고장 났다고 생각한다. `aria-describedby` 로 버튼에 묶여 있어
        **버튼에 초점이 갔을 때 함께 읽힌다** — 화면을 못 보는 사람에게는 「아래」가
        없다.
      */}
      {ready ? null : (
        <p className="text-fg-subtle text-xs" id={REASON_ID}>
          {reasonOf({ messages, missingMethod, missingRecipient, repricing })}
        </p>
      )}

      {refusal === null ? null : (
        <p aria-live="polite" className="text-danger text-xs">
          {messages.placeFailures[refusal]}
        </p>
      )}
    </aside>
  )
}

/**
 * 쿠폰 한 장이 **실제로** 깎은 금액.
 *
 * 이름과 금액이 나란히 붙는다. 이름이 없으면 두 장을 고른 사람은 어느 쪽이 얼마를
 * 깎았는지 알 수 없고, 그 둘은 부담 주체가 다를 수도 있는 서로 다른 쿠폰이다.
 */
function AppliedCouponLine({
  applied,
  messages,
}: {
  readonly applied: AppliedCoupon
  readonly messages: CheckoutMessages
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 pl-2">
      <dt className="text-fg-subtle min-w-0 truncate text-xs">{applied.name}</dt>
      <dd className="text-fg-subtle shrink-0 text-xs tabular-nums">
        {messages.appliedCouponAmount.replace(
          '{amount}',
          formatMoney({ amount: applied.discountAmount, currency: CURRENCY }),
        )}
      </dd>
    </div>
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
  repricing,
  messages,
}: {
  readonly missingRecipient: boolean
  readonly missingMethod: boolean
  readonly repricing: boolean
  readonly messages: CheckoutMessages
}): string {
  if (missingRecipient) return messages.recipientRequired
  if (missingMethod) return messages.payment.methodRequired
  // 쿠폰은 **가장 마지막**이다. 곧 끝나는 기다림이라 다른 이유들보다 덜 급하고,
  // 배송지도 안 고른 사람에게 「쿠폰을 적용하는 중」이라고 말하면 그 사람은 자기가
  // 무엇을 해야 하는지 여전히 모른다.
  if (repricing) return messages.couponRepricing

  return messages.termsRequired
}
