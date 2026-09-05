'use client'

import type { ApiFailure, Order, SellerOrder } from '@shopping/shared'
import { DataList } from '@shopping/ui/components'
import { ConfirmDialog, useConfirm } from '@shopping/ui/form'
import { useDensity } from '@shopping/ui/density'
import { formatDate, formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import { useState } from 'react'

import { AUTO_CONFIRM_DAYS } from '@/lib/orders/auto-confirm'
import { useOrderDetail } from '@/lib/orders/use-order-detail'
import { useRepurchase } from '@/lib/orders/use-repurchase'
import type { MyPageMessages } from '@/messages'

import {
  AccountLoadFailure,
  AccountLoading,
  AccountNotice,
  AccountWriteFailure,
} from './account-notices'
import { SellerOrderBundle } from './seller-order-bundle'

const CURRENCY = 'KRW'
const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * `/mypage/orders/[id]` — 주문 하나 (TASK-0063).
 *
 * ## 이 화면의 주어는 묶음이다
 *
 * 주문번호와 결제금액은 위에 한 번 나오고, 그 아래는 **판매자별 배송** 목록이다.
 * 묶음이 둘 이상이면 그 사실을 문장으로 먼저 말한다 (R1) — 「주문번호는 하나이고
 * 배송은 판매자마다 다르다」를 사람이 배지 색에서 유추하게 두면, 처음 보는 사람은
 * 화면이 고장난 줄 안다.
 *
 * ## 구매확정은 확인을 거친다
 *
 * 되돌릴 수 없고 정산과 적립금 지급의 방아쇠다 (`state-machines.md` 1장). 카드
 * 삭제가 확인을 거치는 것과 같은 기준이고 — 되돌릴 수 있는 일에는 확인을 붙이지
 * 않는다 — 다이얼로그는 **어느 묶음인지**를 적는다. 대상을 말하지 않는 확인은 믿고
 * 누르는 확인이다.
 *
 * 확정 뒤에 주문을 다시 읽지 않는다. 전이 응답이 새 상태와 새 액션 목록을 함께
 * 싣기 때문이고, 그 이유는 `use-order-detail.ts` 에 있다.
 *
 * ## 결제 정보에 「수단」이 없다
 *
 * `GET /orders/:id` 가 그것을 싣지 않고, 주문에서 결제로 가는 길이 계약에 없다
 * (TASK-0063 — 보고된 빈자리). 지어내는 대신 답을 실제로 갖고 있는 화면
 * (`/mypage/cards`)을 가리킨다.
 */
export function OrderDetailScreen({
  id,
  messages,
}: {
  readonly id: string
  readonly messages: MyPageMessages
}) {
  const detail = useOrderDetail(id)
  const repurchase = useRepurchase()
  const { density } = useDensity()
  const copy = messages.orderDetail

  const gate = useConfirm()
  const [pending, setPending] = useState<SellerOrder | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  const order = detail.state.status === 'ready' ? detail.state.order : null

  async function confirmReceipt(bundle: SellerOrder): Promise<void> {
    setPending(bundle)
    const agreed = await gate.request()
    setPending(null)

    if (!agreed) return

    const result = await detail.transition(bundle.id, 'CONFIRMED')

    if (!result.ok) {
      setNotice(null)
      setFailure(result.failure)

      return
    }

    setFailure(null)
    // 「처리했습니다」와 「이미 처리돼 있었습니다」는 다른 말이다. 계약이 `changed`
    // 를 싣는 이유가 이것이고, 화면이 그것을 쓰지 않으면 그 필드는 장식이 된다.
    setNotice(
      (result.changed ? copy.confirm.done : copy.confirm.alreadyDone).replace(
        '{brand}',
        bundle.brandName,
      ),
    )
  }

  async function repurchaseBundle(bundle: SellerOrder): Promise<void> {
    const outcome = await repurchase.run(bundle.id, bundle.items)
    const names = outcome.rejected.join(', ')

    setFailure(null)
    // 담긴 것과 못 담은 것을 **둘 다** 말한다 (F7). 하나만 말하면 나머지는 사람이
    // 장바구니에 가서 세어 봐야 안다.
    if (outcome.rejected.length === 0) {
      setNotice(copy.repurchase.added.replace('{count}', String(outcome.added)))
    } else if (outcome.added === 0) {
      setNotice(copy.repurchase.none.replace('{names}', names))
    } else {
      setNotice(
        copy.repurchase.partial.replace('{count}', String(outcome.added)).replace('{names}', names),
      )
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <DataList
        empty={null}
        error={
          detail.state.status === 'error' ? (
            <AccountLoadFailure
              failure={detail.state.failure}
              messages={messages}
              onRetry={detail.reload}
            />
          ) : null
        }
        loading={<AccountLoading label={copy.loadingLabel} />}
        state={detail.state.status === 'ready' ? 'ready' : detail.state.status}
      >
        {order === null ? null : (
          <div className="flex flex-col gap-6">
            <OrderHeading messages={messages} order={order} />

            {notice === null ? null : <AccountNotice>{notice}</AccountNotice>}

            {failure === null ? null : (
              <AccountWriteFailure
                failure={failure}
                messages={messages}
                title={copy.confirm.failedTitle}
              />
            )}

            {/*
              R1 — 묶음이 여럿이라는 사실을 목록보다 **먼저** 말한다. 하나뿐인
              주문에는 나오지 않는다: 나뉘지 않은 것을 두고 나뉜다고 하면 그 문장이
              소음이 되고, 진짜로 나뉜 주문에서 읽히지 않게 된다.
            */}
            {order.sellerOrders.length > 1 ? (
              <p
                className="border-border bg-surface-muted text-fg rounded-md border p-3 text-sm"
                role="note"
              >
                {copy.splitNotice.replace('{count}', String(order.sellerOrders.length))}
              </p>
            ) : null}

            <section className="flex flex-col gap-3">
              <h2 className="text-fg text-lg font-semibold">{copy.bundlesLabel}</h2>

              <ul aria-label={copy.bundlesLabel} className="flex flex-col gap-4">
                {order.sellerOrders.map((bundle) => (
                  <SellerOrderBundle
                    actions={detail.actionsOf(bundle.id)}
                    busy={detail.busyId === bundle.id}
                    density={density}
                    key={bundle.id}
                    messages={copy}
                    onConfirm={() => {
                      void confirmReceipt(bundle)
                    }}
                    onRepurchase={() => {
                      void repurchaseBundle(bundle)
                    }}
                    repurchasing={repurchase.busyId === bundle.id}
                    sellerOrder={bundle}
                  />
                ))}
              </ul>
            </section>

            <OrderPaymentSummary messages={messages} order={order} />
            <OrderRecipientPanel messages={messages} order={order} />
          </div>
        )}
      </DataList>

      <ConfirmDialog
        cancelLabel={copy.confirm.cancelLabel}
        closeLabel={copy.confirm.closeLabel}
        confirmLabel={copy.confirm.confirmLabel}
        description={copy.confirm.description}
        onConfirm={gate.confirm}
        onOpenChange={gate.onOpenChange}
        open={gate.open}
        title={copy.confirm.title}
      >
        <div className="flex flex-col gap-2 text-sm">
          {/* 어느 묶음인지 적는다. 대상을 말하지 않는 확인은 믿고 누르는 확인이다. */}
          {pending === null ? null : (
            <p className="text-fg font-medium">
              {copy.bundleLabel.replace('{brand}', pending.brandName)}
            </p>
          )}
          <p className="text-fg">{copy.confirm.consequences}</p>
          <p className="text-fg font-semibold">{copy.confirm.irreversible}</p>
          {/*
            **확인창도 같은 시각을 말한다** — 카드의 안내와 다른 말을 하면 사람은
            어느 쪽이 맞는지 모른다. 「배송완료 7일 뒤」를 여기 박아 두지 않는
            이유는 시간을 압축한 배포에서 그 문장이 거짓이 되기 때문이고, 이
            데모가 바로 그 배포다.
          */}
          <p className="text-fg-muted">
            {pending?.autoConfirmAt === undefined || pending.autoConfirmAt === null
              ? copy.confirm.automaticUnknown
              : copy.confirm.automatic.replace(
                  '{date}',
                  formatDate(pending.autoConfirmAt, {
                    locale: LOCALE,
                    style: 'dateTime',
                    timeZone: TIME_ZONE,
                  }),
                )}
          </p>
          <p className="text-fg-muted">
            {copy.autoConfirm.rule.replace('{days}', String(AUTO_CONFIRM_DAYS))}
          </p>
        </div>
      </ConfirmDialog>
    </div>
  )
}

/** 주문번호 · 주문일시 · 목록으로 돌아가는 길. */
function OrderHeading({
  order,
  messages,
}: {
  readonly order: Order
  readonly messages: MyPageMessages
}) {
  const copy = messages.orderDetail

  return (
    <header className="flex flex-col gap-2">
      <Link className="text-primary self-start text-sm underline" href="/mypage/orders">
        {copy.backToList}
      </Link>

      <h1 className="text-fg text-xl font-bold">
        {copy.title.replace('{number}', order.orderNumber)}
      </h1>

      <dl className="text-fg-muted flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <dt>{copy.orderNumberLabel}</dt>
        <dd className="text-fg font-mono">{order.orderNumber}</dd>
        <dt>{copy.orderedAtLabel}</dt>
        <dd className="text-fg">
          <time dateTime={order.createdAt}>
            {formatDate(order.createdAt, {
              locale: LOCALE,
              style: 'dateTime',
              timeZone: TIME_ZONE,
            })}
          </time>
        </dd>
      </dl>
    </header>
  )
}

/**
 * 결제 정보 — 금액과 할인 (TASK-0063 2장).
 *
 * **0인 줄도 그린다.** 「쿠폰할인 0원」은 「쿠폰을 안 썼다」이고, 그 줄이 없으면
 * 사람은 쿠폰이 어디 갔는지 찾는다. 합계가 어떻게 그 숫자가 됐는지는 줄이 전부
 * 보여야 읽힌다.
 */
function OrderPaymentSummary({
  order,
  messages,
}: {
  readonly order: Order
  readonly messages: MyPageMessages
}) {
  const copy = messages.orderDetail.payment
  /** 배송비에 쓴 적립금은 항목에 안분되지 않는 몫이라 따로 더한다 (TASK-0047). */
  const shippingPoint = order.sellerOrders.reduce(
    (total, bundle) => total + bundle.shippingPointAmount,
    0,
  )

  const rows: readonly (readonly [string, number])[] = [
    [copy.productAmount, order.totalProductAmount],
    [copy.couponDiscount, -order.totalCouponDiscountAmount],
    [copy.pointDiscount, -order.totalPointDiscountAmount],
    [copy.shippingFee, order.totalShippingFee],
    [copy.shippingPoint, -shippingPoint],
  ]

  return (
    <section className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-fg text-lg font-semibold">{copy.title}</h2>

      <dl className="flex flex-col gap-2 text-sm">
        {rows.map(([label, amount]) => (
          <div className="flex items-baseline justify-between gap-4" key={label}>
            <dt className="text-fg-muted">{label}</dt>
            <dd className="text-fg tabular-nums">{formatMoney({ amount, currency: CURRENCY })}</dd>
          </div>
        ))}

        <div className="border-border flex items-baseline justify-between gap-4 border-t pt-2">
          <dt className="text-fg font-semibold">{copy.paidAmount}</dt>
          <dd className="text-fg text-lg font-bold tabular-nums">
            {formatMoney({ amount: order.paidAmount, currency: CURRENCY })}
          </dd>
        </div>
      </dl>

      {/*
        결제수단은 이 응답에 없다. 없는 것을 지어내는 대신, 그 답을 실제로 갖고 있는
        화면을 가리킨다 — 가상 카드 사용 내역의 각 줄이 주문번호를 들고 있어
        「이 결제가 이 주문」이 이어진다 (TASK-0058 4.2).
      */}
      <p className="text-fg-muted text-sm">
        {copy.methodHint}{' '}
        <Link className="text-primary underline" href="/mypage/cards">
          {copy.methodLink}
        </Link>
      </p>
    </section>
  )
}

/** 배송지 — 주문한 때 배송지에서 **복사된** 값이다 (TASK-0049 4.6). */
function OrderRecipientPanel({
  order,
  messages,
}: {
  readonly order: Order
  readonly messages: MyPageMessages
}) {
  const copy = messages.orderDetail.recipient
  const { recipient } = order

  return (
    <section className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-fg text-lg font-semibold">{copy.title}</h2>

      <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-fg-muted">{copy.name}</dt>
        <dd className="text-fg">{recipient.name}</dd>
        <dt className="text-fg-muted">{copy.phone}</dt>
        <dd className="text-fg tabular-nums">{recipient.phone}</dd>
        <dt className="text-fg-muted">{copy.address}</dt>
        <dd className="text-fg">
          ({recipient.postalCode}) {recipient.addressLine1}
          {recipient.addressLine2 === null ? '' : ` ${recipient.addressLine2}`}
        </dd>
      </dl>
    </section>
  )
}
