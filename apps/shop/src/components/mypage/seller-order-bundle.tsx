'use client'

import type { OrderStatus, SellerOrder } from '@shopping/shared'
import { Button, ShipmentTracking } from '@shopping/ui/components'
import type { DensityLevel } from '@shopping/ui/density'
import { formatMoney } from '@shopping/ui/format'
import { useId, useState } from 'react'

import type { BundleActions } from '@/lib/orders/use-order-detail'
import type { OrderDetailMessages } from '@/messages'

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
  density,
  messages,
  busy,
  onConfirm,
  onRepurchase,
  repurchasing,
}: {
  readonly sellerOrder: SellerOrder
  readonly actions: BundleActions
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
            {item.snapshot.thumbnailUrl === null ? (
              <span aria-hidden="true" className="bg-surface-muted size-14 shrink-0 rounded" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- 주문 스냅샷의 URL 이다. 지금 카탈로그에 없을 수도 있는 값이라 `next/image` 의 도메인 허용목록으로 관리할 수 없고, 줄마다 작은 썸네일이라 최적화로 얻는 것도 없다 (`cart-line-row.tsx` 가 같은 이유로 같은 선택을 했다).
              <img
                alt=""
                className="size-14 shrink-0 rounded object-cover"
                src={item.snapshot.thumbnailUrl}
              />
            )}

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
        아직 없는 화면 둘. 링크도 비활성 버튼도 아닌 이유는 `upcoming-entry.tsx` 에
        적혀 있다.

        - 취소·반품 신청: **TASK-0066**(취소) · **TASK-0067**(반품). 그 화면이
          생기면 이 자리가 `/mypage/orders/[id]/claim` 으로 가는 버튼이 되고,
          「지금 신청할 수 있는가」는 클레임 쪽 API 가 답하게 된다.
        - 리뷰 작성: **TASK-0083**. 「쓸 수 있는가」는 리뷰 API 가 답한다.

        지금 상태로 가르는 것은 **임시**다. 서버가 답해 줄 것이 없어서 화면이
        어림잡는 것이고, 위 TASK 가 닫히면 그 어림이 통째로 지워진다.
      */}
      {CLAIMABLE.includes(sellerOrder.status) ? (
        <UpcomingEntry body={messages.upcoming.claimBody} title={messages.upcoming.claimTitle} />
      ) : null}

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

/** 취소·반품이 아직 말이 되는 상태들 (M10 이 오면 이 배열은 사라진다). */
const CLAIMABLE: readonly OrderStatus[] = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED']

/** 리뷰를 쓸 만한 상태들 (M13 이 오면 이 배열은 사라진다). */
const REVIEWABLE: readonly OrderStatus[] = ['DELIVERED', 'CONFIRMED']
