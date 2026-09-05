'use client'

import { Badge, type BadgeVariant } from '../components/badge'
import { Button } from '../components/button'
import { EmptyState } from '../components/empty-state'
import { cx } from '../lib/cx'
import type { DensityLevel } from '../density/density'
import { formatDate } from '../format/date'
import { ShipmentProgress, type ShipmentProgressLabels } from './shipment-progress'
import { TrackingTimeline, type TrackingTimelineLabels } from './tracking-timeline'
import type { Shipment, ShipmentStatus } from './shipment'

/**
 * 배송 추적 — 구매자 화면(TASK-0063)과 판매자 콘솔(TASK-0060)이 함께 쓰는 한 벌.
 *
 * **왜 `packages/ui` 인가.** 두 화면이 같은 것을 보여 준다. 각자 그리면 「배송
 * 출발」이 한쪽에서만 굵어지고, 접근성 결정도 두 벌이 되며, 그중 하나만 고쳐진다.
 *
 * **두 화면의 다른 필요는 props 로 가른다.**
 *
 * | | 구매자 | 판매자 |
 * | --- | --- | --- |
 * | 관심사 | 내 물건이 어디까지 왔나 | 이 건이 정상 진행 중인가, 문의가 오면 무엇을 읽어 주나 |
 * | `onCopyTrackingNumber` | 넘기지 않는다 — 복사할 곳이 없다 | 넘긴다. 상담·조회에 번호를 그대로 옮긴다 |
 * | 밀도 | 방문자가 고른 값 | `CONSOLE_DENSITY` 고정 |
 *
 * 복사 **동작**은 여기 없다. `navigator.clipboard` 는 권한·보안 컨텍스트·실패
 * 안내가 따라붙는 앱의 문제이고, 그것을 컴포넌트에 넣으면 토스트 문구까지 이
 * 패키지가 갖게 된다. 여기서는 「눌렸다」만 알린다 — `ProductCard` 의
 * `onWishlist` 와 같은 규약이고, 넘기지 않으면 버튼 자체가 없다.
 *
 * 이 파일만 `'use client'` 다. 핸들러를 받는 것은 여기뿐이고, 타임라인과 4단계
 * 표시는 서버에서도 그려진다.
 */

export interface ShipmentTrackingLabels extends ShipmentProgressLabels, TrackingTimelineLabels {
  readonly carrier: string
  readonly trackingNumber: string
  /**
   * 「이 배송 정보는 가상입니다」 (TASK-0061 R1).
   *
   * **선택이 아니라 필수 문구다.** 운송장 번호는 실제와 구분되는 `DEMO-` 접두어를
   * 달고 나오지만, 그것을 알아채기를 기대하는 것은 방문자에게 우리 규칙을 읽으라고
   * 하는 것과 같다. `DataList` 가 빈 상태를 필수 prop 으로 둔 것과 같은 이유로
   * 여기 있다 — 빠뜨리면 컴파일되지 않는다.
   */
  readonly virtualNotice: string
  /** 맥시멀에서만 보이는 발송·완료 시각의 이름. */
  readonly shippedAt: string
  readonly deliveredAt: string
  /** 판매자 콘솔에서만 보이는 버튼의 글자. 무엇을 복사하는지까지 말해야 한다. */
  readonly copyTrackingNumber: string
  /** 배송이 아직 없는 주문 — 발송 전이라 운송장 자체가 없다. */
  readonly notShippedTitle: string
  readonly notShippedDescription: string
  /** 배송은 있는데 추적 이벤트가 아직 없다. */
  readonly noEventsTitle: string
  readonly noEventsDescription: string
}

export interface ShipmentTrackingProps {
  /**
   * `null` 은 **아직 발송되지 않은 주문**이다.
   *
   * 「데이터가 없다」와 「보낸 적이 없다」는 다른 말이고, 사용자가 알아야 할 것은
   * 뒤쪽이다. 그래서 호출하는 쪽이 이 컴포넌트를 조건부로 감추게 두지 않고 `null`
   * 을 받아 직접 그린다 — 감추는 선택지를 주면 주문 상세에 아무것도 없는 자리가
   * 남는다.
   */
  readonly shipment: Shipment | null
  readonly density: DensityLevel
  readonly labels: ShipmentTrackingLabels
  /** 판매자 콘솔이 넘긴다. 없으면 복사 버튼이 그려지지 않는다. */
  readonly onCopyTrackingNumber?: (trackingNumber: string) => void
  readonly locale?: string
  /** IANA 시간대. 서버 렌더와 브라우저 렌더가 같은 시각을 그리게 하는 값이다. */
  readonly timeZone?: string
  readonly className?: string
}

/**
 * 상태의 색. **색은 거들 뿐**이고 배지 안의 글자가 본문이다 — 배지를 회색으로
 * 만들어도 화면이 말하는 내용은 줄지 않아야 한다.
 */
const STATUS_VARIANT: Readonly<Record<ShipmentStatus, BadgeVariant>> = {
  READY: 'neutral',
  IN_TRANSIT: 'primary',
  OUT_FOR_DELIVERY: 'warning',
  DELIVERED: 'success',
}

/** 블록 사이 여백. 미니멀이 가장 넓다. */
const SECTION_GAP: Readonly<Record<DensityLevel, string>> = {
  1: 'gap-5',
  2: 'gap-4',
  3: 'gap-3',
}

export function ShipmentTracking({
  shipment,
  density,
  labels,
  onCopyTrackingNumber,
  locale,
  timeZone,
  className,
}: ShipmentTrackingProps) {
  if (shipment === null) {
    return (
      <div className={cx('w-full', className)} data-density={density}>
        <EmptyState description={labels.notShippedDescription} title={labels.notShippedTitle} />
      </div>
    )
  }

  const at = (value: string): string => formatDate(value, { locale, style: 'dateTime', timeZone })

  return (
    <div
      className={cx('text-fg flex w-full flex-col', SECTION_GAP[density], className)}
      data-density={density}
      data-status={shipment.status}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge variant={STATUS_VARIANT[shipment.status]}>{labels.status[shipment.status]}</Badge>

        <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <dt className="text-fg-muted">{labels.carrier}</dt>
          <dd className="text-fg mr-2 font-medium">
            {shipment.carrierName}
            {/* 운송사 코드는 사람이 아니라 운영이 쓰는 값이라 맥시멀에만 나온다. */}
            {density >= 3 ? (
              <span className="text-fg-subtle ml-1 font-mono text-2xs">{shipment.carrierCode}</span>
            ) : null}
          </dd>

          <dt className="text-fg-muted">{labels.trackingNumber}</dt>
          <dd className="text-fg font-mono break-all">{shipment.trackingNumber}</dd>

          {density >= 3 && shipment.shippedAt !== null ? (
            <>
              <dt className="text-fg-muted ml-2">{labels.shippedAt}</dt>
              <dd className="text-fg">
                <time dateTime={shipment.shippedAt}>{at(shipment.shippedAt)}</time>
              </dd>
            </>
          ) : null}

          {density >= 3 && shipment.deliveredAt !== null ? (
            <>
              <dt className="text-fg-muted ml-2">{labels.deliveredAt}</dt>
              <dd className="text-fg">
                <time dateTime={shipment.deliveredAt}>{at(shipment.deliveredAt)}</time>
              </dd>
            </>
          ) : null}
        </dl>

        {onCopyTrackingNumber === undefined ? null : (
          <Button
            onClick={() => {
              onCopyTrackingNumber(shipment.trackingNumber)
            }}
            size="sm"
            variant="outline"
          >
            {labels.copyTrackingNumber}
          </Button>
        )}
      </div>

      {/* 가상 배송임을 화면이 직접 말한다 (TASK-0061 R1). */}
      <p className="text-fg-subtle text-xs">{labels.virtualNotice}</p>

      <ShipmentProgress density={density} labels={labels} status={shipment.status} />

      {shipment.events.length === 0 ? (
        <EmptyState description={labels.noEventsDescription} title={labels.noEventsTitle} />
      ) : (
        <TrackingTimeline
          density={density}
          events={shipment.events}
          labels={labels}
          locale={locale}
          timeZone={timeZone}
        />
      )}
    </div>
  )
}
