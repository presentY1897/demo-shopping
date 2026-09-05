import type { SellerOrder } from '@shopping/shared'
import { CheckIcon } from '@shopping/ui/components'
import type { DensityLevel } from '@shopping/ui/density'
import { formatDate } from '@shopping/ui/format'

import type { OrderStageState } from '@/lib/orders/order-stages'
import { orderStages } from '@/lib/orders/order-stages'
import type { OrderStatusMessages, OrderTimelineMessages } from '@/messages'

const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * 이 묶음이 어디까지 왔나 (TASK-0063).
 *
 * ## 「사다리」와 「이력」의 차이가 이 컴포넌트의 전부다
 *
 * 구매자 응답에는 상태 이력이 없다 (`order-stages.ts`). 그래서 이것은 **지나온
 * 사건의 목록이 아니라 갈 길의 다섯 칸**이고, 시각은 우리가 실제로 아는 두 칸에만
 * 붙는다. 나머지 칸에는 「시각 정보 없음」이 적힌다 — 빈칸으로 두면 「그런 일이 없었다」로
 * 읽히고, 접수 시각을 결제 시각 자리에 놓으면 그냥 거짓말이다.
 *
 * ## 색이 유일한 단서가 아니다
 *
 * 점 세 종류의 **모양**이 다르고(채움+체크 / 굵은 테두리 / 빈 원), 각 칸에 「완료 ·
 * 현재 · 예정」이 글자로 붙으며, 현재 칸에는 `aria-current="step"` 이 있다. 셋이
 * 같은 사실을 다른 경로로 나른다 — `ShipmentProgress` 가 이미 정한 규약이고, 여기서
 * 그것을 다시 쓰지 않고 **같은 결로** 만든 이유는 이 사다리가 배송이 아니라 주문의
 * 것이기 때문이다 (단계 이름도 개수도 다르다).
 *
 * 서버 렌더 가능 — 상태도 핸들러도 없다.
 */

const MARKER_STYLES: Readonly<Record<OrderStageState, string>> = {
  done: 'size-4 border-primary bg-primary text-primary-fg',
  current: 'size-5 border-primary bg-surface text-primary',
  upcoming: 'size-4 border-border-strong bg-surface text-fg-subtle',
}

/** 항목 사이 여백만 밀도를 탄다. 무엇이 보이는가는 밀도로 줄이지 않는다. */
const ITEM_GAP: Readonly<Record<DensityLevel, string>> = {
  1: 'gap-4',
  2: 'gap-3',
  3: 'gap-2',
}

export function OrderTimeline({
  sellerOrder,
  density,
  labels,
  statuses,
}: {
  readonly sellerOrder: SellerOrder
  readonly density: DensityLevel
  readonly labels: OrderTimelineMessages
  readonly statuses: OrderStatusMessages
}) {
  const steps = orderStages(sellerOrder)

  // 사다리를 벗어난 상태 — 취소·반품·결제실패·결제대기. 회색 사다리를 남겨 두면
  // 화면이 아직 그리로 갈 것처럼 말한다.
  if (steps === null) {
    return (
      <p className="text-fg-muted text-sm">
        {labels.offLadder.replace('{status}', statuses[sellerOrder.status])}
      </p>
    )
  }

  return (
    <ol aria-label={labels.label} className={`flex flex-col ${ITEM_GAP[density]}`}>
      {steps.map((step) => (
        <li
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="flex items-start gap-3"
          key={step.stage}
        >
          <span
            aria-hidden="true"
            className={`mt-0.5 flex shrink-0 items-center justify-center rounded-full border-2 ${MARKER_STYLES[step.state]}`}
          >
            {step.state === 'done' ? <CheckIcon className="size-3" /> : null}
          </span>

          <span className="flex flex-col gap-0.5">
            <span
              className={
                step.state === 'upcoming' ? 'text-fg-subtle text-sm' : 'text-fg text-sm font-medium'
              }
            >
              {labels.stages[step.stage]}
              {/* 자리를 말로 옮긴 것. 색을 못 보는 사람에게 정보를 나르는 쪽이다. */}
              <span className="sr-only"> {labels.stageState[step.state]}</span>
            </span>

            <span className="text-fg-subtle text-xs">
              {step.at === null ? (
                labels.unknownAt
              ) : (
                <time dateTime={step.at}>
                  {formatDate(step.at, { locale: LOCALE, style: 'dateTime', timeZone: TIME_ZONE })}
                </time>
              )}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}
