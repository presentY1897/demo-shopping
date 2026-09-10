'use client'

import { ProductThumbnail } from '@/components/products/product-thumbnail'

import type { OrderStatus, SellerOrder } from '@shopping/shared'
import { Button, ShipmentTracking } from '@shopping/ui/components'
import type { DensityLevel } from '@shopping/ui/density'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import { useId, useState } from 'react'

import { refusalSentence } from '@/lib/claims/claim-refusal'
import type { BundleActions, BundleClaimable } from '@/lib/orders/use-order-detail'
import type { OrderClaimEntryMessages, OrderDetailMessages } from '@/messages'

import { AutoConfirmNotice } from './auto-confirm-notice'
import { OrderStatusBadge } from './order-status-badge'
import { OrderTimeline } from './order-timeline'
import { UpcomingEntry } from './upcoming-entry'

const CURRENCY = 'KRW'
const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * 한 판매자 몫 (TASK-0063 F1 · F2).
 *
 * **이 컴포넌트가 이 TASK 의 요점이다.** 하나의 주문번호 아래에서 판매자마다 상태가
 * 다르고, 배송도 액션도 각자다 (D-023). 그것을 대표 상태 하나로 뭉치면 화면이
 * 거짓말을 하므로, 상태 배지 · 타임라인 · 배송 · 버튼이 **전부 이 안에** 있다.
 *
 * ## 액션은 서버가 정한다
 *
 * 버튼이 있는지 없는지는 `GET /seller-orders/:id/actions` 가 답한 목록이 정한다 —
 * 화면이 「배송완료면 구매확정」이라고 적으면 그 판단이 세 앱에 흩어지고 규칙이 바뀔
 * 때 한 곳만 고쳐진다 (`state-machines.md` 1장). 화면이 갖는 것은 **그 전이의
 * 문구**뿐이다.
 *
 * 목록을 못 읽었을 때 「할 수 있는 것이 없다」로 그리지 않는다. 그 둘은 다른
 * 사실이고, 뒤쪽으로 잘못 말하면 사람은 구매확정 버튼을 **찾다가** 포기한다.
 *
 * ## 배송조회는 접힌다, 「발송 전」은 접히지 않는다
 *
 * 운송장이 있으면 추적을 토글 뒤에 둔다 — 묶음이 셋이고 각각 사건이 네 줄이면
 * 화면이 스크롤로만 읽히는 것이 된다. 반대로 `shipment === null` 은 **감출 수
 * 없다**: 「아직 발송되지 않았다」는 사람이 이 화면에 온 이유일 수 있고, 그것을 클릭
 * 뒤에 두면 없는 것처럼 보인다 (`ShipmentTracking` 이 `null` 을 직접 받는 이유와
 * 같다).
 */
export function SellerOrderBundle({
  sellerOrder,
  actions,
  claimable,
  orderId,
  density,
  messages,
  busy,
  onConfirm,
  onRepurchase,
  repurchasing,
}: {
  readonly sellerOrder: SellerOrder
  readonly actions: BundleActions
  /** 「지금 취소·반품을 신청할 수 있나」. 서버가 답한다 (TASK-0066). */
  readonly claimable: BundleClaimable
  /** 신청 화면의 주소를 만드는 데 쓴다. 묶음은 자기 주문 id 를 들고 있지 않다. */
  readonly orderId: string
  readonly density: DensityLevel
  readonly messages: OrderDetailMessages
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onRepurchase: () => void
  readonly repurchasing: boolean
}) {
  const [trackingOpen, setTrackingOpen] = useState(false)
  const trackingId = useId()
  const brand = sellerOrder.brandName
  const named = (template: string): string => template.replace('{brand}', brand)

  return (
    <li className="border-border bg-surface flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-fg text-base font-semibold">{brand}</h3>
        <OrderStatusBadge labels={messages.statuses} status={sellerOrder.status} />
      </div>

      <ul aria-label={`${brand} ${messages.itemsLabel}`} className="flex flex-col gap-3">
        {sellerOrder.items.map((item) => (
          <li className="flex items-start gap-3" key={item.id}>
            {/*
              스냅샷의 이미지다 (F4). 상품이 지워졌으면 `null` 이고, 그때는 자리만
              남긴다 — 「사진이 없었다」도 주문 당시의 사실이다.
            */}
            <ProductThumbnail
              src={item.snapshot.thumbnailUrl}
              className="size-14 shrink-0 rounded"
            />

            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-fg text-sm font-medium">{item.snapshot.productName}</span>
              <span className="text-fg-muted text-xs">
                {item.snapshot.optionLabel === '' ? messages.noOption : item.snapshot.optionLabel}
              </span>
              <span className="text-fg-muted text-xs tabular-nums">
                {messages.quantityLabel.replace('{count}', String(item.quantity))} ·{' '}
                {messages.unitPriceLabel}{' '}
                {formatMoney({ amount: item.unitPrice, currency: CURRENCY })}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <OrderTimeline
        density={density}
        labels={messages.timeline}
        sellerOrder={sellerOrder}
        statuses={messages.statuses}
      />

      {sellerOrder.shipment === null ? (
        <ShipmentTracking
          density={density}
          labels={messages.tracking}
          locale={LOCALE}
          shipment={null}
          timeZone={TIME_ZONE}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Button
            aria-controls={trackingOpen ? trackingId : undefined}
            aria-expanded={trackingOpen}
            className="self-start"
            onClick={() => {
              setTrackingOpen((open) => !open)
            }}
            size="sm"
            variant="outline"
          >
            {named(trackingOpen ? messages.tracking.close : messages.tracking.open)}
          </Button>

          {trackingOpen ? (
            <div id={trackingId}>
              <ShipmentTracking
                density={density}
                labels={messages.tracking}
                locale={LOCALE}
                shipment={sellerOrder.shipment}
                timeZone={TIME_ZONE}
              />
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {actions.status === 'loading' ? (
          <p className="text-fg-muted text-sm" role="status">
            {messages.actionsLoading}
          </p>
        ) : null}

        {actions.status === 'failed' ? (
          <p className="text-fg-muted text-sm" role="status">
            {messages.actionsFailed}
          </p>
        ) : null}

        {actions.status === 'ready'
          ? actions.actions.map((action) =>
              // 구매확정이 구매자에게 열려 있는 유일한 전이다. 서버가 언젠가 두 번째
              // 전이를 열면 여기 문구가 없어 버튼이 그려지지 않고, 그때 이 자리에
              // 문구를 더한다 — 목록을 화면이 좁히는 것이 아니라 아직 말할 줄
              // 모르는 것이다.
              action.to === 'CONFIRMED' ? (
                <Button
                  aria-label={`${messages.confirm.action} ${brand}`}
                  key={action.to}
                  loading={busy}
                  onClick={onConfirm}
                  variant="primary"
                >
                  {busy ? messages.confirm.busy : messages.confirm.action}
                </Button>
              ) : null,
            )
          : null}

        <Button
          aria-label={`${messages.repurchase.action} ${brand}`}
          loading={repurchasing}
          onClick={onRepurchase}
          variant="outline"
        >
          {repurchasing ? messages.repurchase.busy : messages.repurchase.action}
        </Button>
      </div>

      {/*
        확정이 언제 일어나는지, 또는 이미 일어났으면 그 뒤에 무엇이 닫혔는지
        (TASK-0064 F5 · F8). **버튼 아래에 있는 것이 자리다** — 서버가 답한 액션
        목록이 위에서 버튼을 그리고, 이 문단이 그 버튼을 지금 누르지 않아도 되는
        이유(자동 확정)와 누른 뒤에 닫히는 것(반품)을 말한다.
      */}
      <AutoConfirmNotice messages={messages} sellerOrder={sellerOrder} />

      {/*
        취소·반품으로 가는 자리 (TASK-0066). **화면이 상태로 가르지 않는다** — 위의
        어림잡던 배열이 사라진 것이 이 TASK 가 한 일의 절반이고, 지금 그 자리에는
        서버가 답한 것만 있다.
      */}
      <ClaimEntry
        brand={brand}
        claimable={claimable}
        messages={messages.claim}
        orderId={orderId}
        sellerOrderId={sellerOrder.id}
      />

      {/*
        아직 없는 화면 하나. 링크도 비활성 버튼도 아닌 이유는 `upcoming-entry.tsx` 에
        적혀 있다 — 리뷰 작성은 **TASK-0083** 이고, 「쓸 수 있는가」는 리뷰 API 가
        답하게 된다. 지금 상태로 가르는 것은 그때까지의 **임시**다.
      */}
      {REVIEWABLE.includes(sellerOrder.status) ? (
        <UpcomingEntry body={messages.upcoming.reviewBody} title={messages.upcoming.reviewTitle} />
      ) : null}

      <dl className="text-fg-muted flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <dt>{messages.payment.shippingFee}</dt>
        <dd className="text-fg tabular-nums">
          {formatMoney({ amount: sellerOrder.shippingFee, currency: CURRENCY })}
        </dd>
        <dt>{messages.payment.paidAmount}</dt>
        <dd className="text-fg font-semibold tabular-nums">
          {formatMoney({ amount: sellerOrder.paidAmount, currency: CURRENCY })}
        </dd>
      </dl>
    </li>
  )
}

/** 리뷰를 쓸 만한 상태들 (M13 이 오면 이 배열은 사라진다). */
const REVIEWABLE: readonly OrderStatus[] = ['DELIVERED', 'CONFIRMED']

/**
 * 취소·반품으로 가는 자리 — **버튼이거나 문장이다** (TASK-0066).
 *
 * 「지금 신청할 수 있는가」는 `GET /seller-orders/:id/claimable` 이 답하고, 화면은
 * 그것을 그리기만 한다. 액션 목록과 같은 규약이다 (`state-machines.md` 1장).
 *
 * **못 하는 경우를 감추지 않는다.** 버튼이 없으면 사람은 그것을 찾다가 포기하고,
 * 「신청할 수 없습니다」 하나로 끝내면 배송이 끝나기를 기다리면 되는 사람과
 * 고객센터를 찾아야 하는 사람이 구분되지 않는다 — 서버의 거절 여섯이 저마다 다른
 * 코드를 갖는 이유가 그것이고, 여기가 그 여섯을 문장으로 옮기는 자리다.
 *
 * **「물어보지 못했다」는 「신청할 수 없다」가 아니다.** 액션 목록이 같은 이유로
 * 같은 구분을 갖는다.
 */
function ClaimEntry({
  brand,
  claimable,
  messages,
  orderId,
  sellerOrderId,
}: {
  readonly brand: string
  readonly claimable: BundleClaimable
  readonly messages: OrderClaimEntryMessages
  readonly orderId: string
  readonly sellerOrderId: string
}) {
  if (claimable.status === 'loading') {
    return (
      <p className="text-fg-muted text-sm" role="status">
        {messages.loading}
      </p>
    )
  }

  if (claimable.status === 'failed') {
    return (
      <p className="text-fg-muted text-sm" role="status">
        {messages.failed}
      </p>
    )
  }

  const { type, refusal } = claimable.claimable

  if (type === null) {
    return (
      <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3">
        <p className="text-fg text-sm font-medium">{messages.title}</p>
        <p className="text-fg-muted text-sm">
          {refusal === null
            ? messages.failed
            : refusalSentence({ reason: refusal, remaining: null }, messages.refusals)}
        </p>
      </div>
    )
  }

  // 같은 이름의 링크가 묶음마다 있으므로 브랜드로 가른다 — 「취소 신청」 셋 중
  // 어느 것을 눌렀는지가 접근성 이름에 없으면 링크 목록이 세 번 같은 말을 한다.
  const label = (type === 'CANCEL' ? messages.cancel : messages.returns).replace('{brand}', brand)

  return (
    <Link
      className="border-border text-fg hover:bg-surface-muted h-control-md inline-flex items-center justify-center self-start rounded-md border px-4 text-sm font-medium"
      href={`/mypage/orders/${orderId}/claim?bundle=${sellerOrderId}`}
    >
      {label}
    </Link>
  )
}
