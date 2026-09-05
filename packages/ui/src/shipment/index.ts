/**
 * 배송 추적 (TASK-0061).
 *
 * 구매자 화면(TASK-0063)과 판매자 콘솔(TASK-0060)이 **같은 컴포넌트**를 쓰고,
 * 두 곳의 다른 필요는 props 로 갈린다. `src/catalog` 와 같은 규약으로,
 * `@shopping/shared` 를 알지 못한다 — 앱이 자기 응답을 여기 타입으로 옮겨 담는다.
 *
 * 진입점은 `@shopping/ui/components` 다. 이 패키지의 공개 표면 중 `test/
 * story-coverage.spec.ts` 가 읽는 것이 그 배럴이고, 거기 실린 컴포넌트는
 * 스토리가 없으면 테스트가 깨진다 — 즉 접근성 게이트(axe)를 지나치지 못한다.
 */

export { ShipmentTracking } from './shipment-tracking'
export type { ShipmentTrackingLabels, ShipmentTrackingProps } from './shipment-tracking'

export { ShipmentProgress } from './shipment-progress'
export type { ShipmentProgressLabels, ShipmentProgressProps } from './shipment-progress'

export { TrackingTimeline } from './tracking-timeline'
export type { TrackingTimelineLabels, TrackingTimelineProps } from './tracking-timeline'

export {
  latestTrackingEvent,
  SHIPMENT_STATUSES,
  SHIPMENT_STEP_STATES,
  shipmentStepIndex,
  sortTrackingEvents,
  stepStateAt,
  TRACKING_EVENT_KINDS,
} from './shipment'
export type {
  Shipment,
  ShipmentStatus,
  ShipmentStepState,
  TrackingEvent,
  TrackingEventKind,
} from './shipment'
