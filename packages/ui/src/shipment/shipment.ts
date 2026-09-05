/**
 * 배송 추적이 화면에 그려지기 전에 결정되는 것들 (TASK-0061).
 *
 * **`packages/shared` 를 향하지 않는 이유.** `packages/ui` 는 `@shopping/shared`
 * 에 의존하지 않는다 — `src/catalog/index.ts` 가 같은 이유를 이미 적어 두었고,
 * 그 덕분에 구매자 화면(TASK-0063)과 판매자 콘솔(TASK-0060)이 서로 다른 응답을
 * 각자 이 모양으로 옮겨 담아 **한 벌의 컴포넌트**를 함께 쓴다. 그래서 여기 있는
 * 타입은 서버 계약의 **복사본이 아니라 props 의 계약**이다.
 *
 * 서버 쪽 계약은 `@shopping/shared` 의 `api/shipments.ts` 가 zod 로 갖고 있다.
 * 여기 있는 것은 그 응답을 화면이 받아 쓰는 모양이고, 필드 이름과 열거값이 같아서
 * 앱은 옮겨 담기만 하면 된다. **좁히지는 않는다** — 예컨대 `carrierCode` 를 운송사
 * 목록으로 좁히면 운송사가 하나 늘 때마다 이 패키지가 따라 바뀌어야 한다.
 *
 * React 도 DOM 도 없다. 입력 → 출력이라 렌더 없이 검증된다.
 */

import { toDate } from '../format/date'

/**
 * 배송의 진행 단계. **순서가 곧 의미**다 — 화면의 4단계 표시가 이 배열의 순서를
 * 그대로 쓰고, `shipmentStepIndex` 가 「지금 몇 번째인가」를 이 순서에서 읽는다.
 */
export const SHIPMENT_STATUSES = ['READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number]

/**
 * 추적 이벤트의 종류.
 *
 * 상태와 이름이 겹치지만 같은 것이 아니다. 상태는 **지금의 요약**이고 이벤트는
 * **일어난 사실**이다.
 *
 * 그래서 이름이 한 칸 어긋나 보인다 — 집화(`PICKED_UP`)가 일어난 배송의 상태가
 * `READY` 다. 운송장은 **발송 처리와 함께** 나오고 그 순간 집화가 기록되므로,
 * `READY` 는 「아직 아무 일도 없다」가 아니라 **「받아 갔고 아직 안 움직였다」**다.
 * 서버가 같은 대응표를 갖는다 (`apps/api/src/shipping/shipment-rules.ts`).
 *
 * 배송 자체가 없는 주문(발송 전)은 `shipment === null` 이지 `READY` 가 아니다.
 */
export const TRACKING_EVENT_KINDS = [
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const
export type TrackingEventKind = (typeof TRACKING_EVENT_KINDS)[number]

export interface TrackingEvent {
  readonly id: string
  readonly kind: TrackingEventKind
  /** 가상 지명 (TASK-0061 4장). */
  readonly location: string
  /** ISO 8601. 표기는 `@shopping/ui/format` 이 맡는다. */
  readonly occurredAt: string
  readonly description: string
}

export interface Shipment {
  readonly id: string
  readonly sellerOrderId: string
  readonly carrierCode: string
  readonly carrierName: string
  readonly trackingNumber: string
  readonly status: ShipmentStatus
  readonly shippedAt: string | null
  readonly deliveredAt: string | null
  readonly events: readonly TrackingEvent[]
}

/** 4단계 표시에서 한 단계가 놓인 자리. */
export const SHIPMENT_STEP_STATES = ['done', 'current', 'upcoming'] as const
export type ShipmentStepState = (typeof SHIPMENT_STEP_STATES)[number]

/** 상태가 몇 번째 단계인가. `SHIPMENT_STATUSES` 의 순서가 답이다. */
export function shipmentStepIndex(status: ShipmentStatus): number {
  return SHIPMENT_STATUSES.indexOf(status)
}

/**
 * 단계 하나의 자리.
 *
 * 「지난 단계 / 지금 단계 / 남은 단계」 셋뿐이다. 화면은 이 값으로 **모양과
 * 문구**를 고르고, 색은 그 위에 얹힐 뿐이다 (WCAG 1.4.1).
 */
export function stepStateAt(index: number, currentIndex: number): ShipmentStepState {
  if (index < currentIndex) return 'done'
  if (index === currentIndex) return 'current'
  return 'upcoming'
}

/**
 * 시간순 정렬 — 오래된 것이 먼저.
 *
 * **서버가 정렬해 준다고 믿지 않는다.** 목록의 순서가 곧 `<ol>` 의 번호이고,
 * 마지막 항목이 「지금 여기」이므로, 순서가 틀리면 화면이 거짓말을 한다. 정렬을
 * 컴포넌트가 아니라 여기서 하는 이유는 그것이 렌더 없이 검증되는 규칙이기
 * 때문이다.
 *
 * 같은 시각의 두 이벤트는 받은 순서를 지킨다(`Array.prototype.sort` 는 안정).
 * `toDate` 를 거치므로 ISO 가 아닌 값은 조용히 뒤로 밀리는 대신 즉시 터진다 —
 * 그 편이 「왜 순서가 이상하지」로 하루를 쓰는 것보다 낫다.
 */
export function sortTrackingEvents(events: readonly TrackingEvent[]): readonly TrackingEvent[] {
  // 시각을 **먼저 전부 읽는다.** 비교 함수 안에서 읽으면 항목이 하나뿐일 때
  // 비교가 한 번도 일어나지 않아 잘못된 값이 그대로 통과한다 — 그러면 검증이
  // 목록의 길이에 따라 되기도 하고 안 되기도 한다.
  const keyed = events.map((event, index) => ({
    event,
    index,
    time: toDate(event.occurredAt).getTime(),
  }))

  // 같은 시각이면 받은 순서. `sort` 의 안정성에 기대는 대신 적어 둔다.
  keyed.sort((left, right) => left.time - right.time || left.index - right.index)

  return keyed.map((item) => item.event)
}

/**
 * 「지금 여기」에 해당하는 이벤트 — 정렬된 목록의 마지막.
 *
 * `shipment.status` 가 아니라 **마지막 이벤트**를 쓴다. 상태는 요약이고 이벤트는
 * 사실이며, 사용자가 타임라인에서 찾는 것은 「내 물건이 마지막으로 목격된 곳」이다.
 * 둘이 어긋난 데이터가 와도 화면은 사실 쪽을 가리킨다.
 */
export function latestTrackingEvent(events: readonly TrackingEvent[]): TrackingEvent | null {
  // `at(-1)` 하나로 끝나는 것이 중요하다. 길이를 먼저 재고 인덱스로 꺼내면
  // `?? null` 이 **어떤 입력으로도 닿을 수 없는 갈래**가 되고, 그것은 이 파일에
  // 걸린 분기 100% 를 영원히 채울 수 없게 만든다 — 방어를 쓰지 말고 표현이
  // 그것을 필요 없게 한다.
  return events.at(-1) ?? null
}
