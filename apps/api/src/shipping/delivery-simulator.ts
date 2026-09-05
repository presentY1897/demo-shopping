import type { ShipmentStatus, TrackingEventKind } from '@shopping/shared'
import { shipmentStatuses } from '@shopping/shared'

import type { FulfillmentPace } from '../config/app-config.js'
import { isStale, lockKeyOf } from '../reservation/reservation-sweeper.js'

/**
 * 배송 진행 시뮬레이터의 순수 판단과 상수 (TASK-0062).
 *
 * **여기가 정하는 것은 두 가지뿐이다 — 다음 단계가 무엇이고, 그 때가 언제인가.**
 * 사건을 적는 일 자체는 `ShipmentService.recordTrackingEvent` 가 이미 한다
 * (TASK-0061 4.3): 이력 한 줄 · 배송 상태 · 배송완료면 주문 전이가 한 트랜잭션이다.
 * 시뮬레이터가 더하는 것은 「시간이 지나면 그 문이 저절로 두드려진다」뿐이고, 그
 * 「언제」의 전부가 이 파일에 있다.
 *
 * 구조는 `reservation/reservation-sweeper.ts` · `payment/payment-reconcile.ts` ·
 * `payment/payment-straggler.ts` 와 같다 — 상한 · 주기 · 락 열쇠 · 「건너뛴 실행은
 * 기록하지 않는다」까지 그대로다. **다른 것은 한 건의 값과, 그 값을 고르는 축이
 * 하나 더 있다는 것**이다. 아래 {@link FulfillmentPace} 가 그 축이다.
 *
 * I/O 가 없으므로 분기 전부가 단위 스펙에서 닿고, 이 TASK 의 Q5 는 **분기 커버리지
 * 100%** 다. 뒤집어 말하면 `shipment-rules.ts` 와 같은 규칙을 따른다 — **닿을 수
 * 없는 방어 분기를 쓰지 않는다.**
 */

/**
 * 사건 하나가 일어난 뒤 **다음 사건**은 무엇인가.
 *
 * 상태를 열쇠로 두는 이유는 그것이 배송 행이 들고 있는 값이기 때문이다. 사건에서
 * 사건으로 이으면 「마지막 사건이 무엇이었나」를 이력에서 다시 읽어야 하는데, 그
 * 답은 이미 `Shipment.status` 에 요약돼 있고 그 요약은 사다리를 지킨다
 * (`furthestShipmentStatus`) — 순서가 뒤집힌 사건이 하나 끼어들어도 여기서 나오는
 * 답은 뒤로 가지 않는다.
 *
 * `switch` 가 아니라 **상태 전부를 덮는 레코드**인 것은 `shipment-rules.ts` 의
 * `STATUS_AFTER` 와 같은 이유다 — `@shopping/shared` 에 상태를 하나 더 넣고 여기를
 * 안 고치면 **컴파일이 깨져야** 한다. 안 그러면 새 상태에 들어간 배송이 아무도
 * 모르게 그 자리에 영원히 멈춘다.
 *
 * **집화(`PICKED_UP`)가 여기 없는 것이 이 표의 시작점이다.** 운송장은 발송 처리와
 * 함께 나오고 그 순간 집화가 이미 남으므로(`ShipmentService.issue`), 시뮬레이터가
 * 만드는 첫 사건은 그 다음인 `IN_TRANSIT` 이다. `READY` 를 「아직 아무 일도
 * 없다」로 읽고 집화부터 다시 적으면 이력에 같은 줄이 둘 생긴다.
 */
const NEXT_EVENT: Readonly<Record<ShipmentStatus, TrackingEventKind | null>> = {
  READY: 'IN_TRANSIT',
  IN_TRANSIT: 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'DELIVERED',
  /** 사다리의 끝. 배송완료된 건은 더 진행하지 않는다. */
  DELIVERED: null,
}

export function nextTrackingEvent(status: ShipmentStatus): TrackingEventKind | null {
  return NEXT_EVENT[status]
}

/**
 * 시뮬레이터가 손댈 수 있는 상태들 — 즉 다음 단계가 있는 상태들.
 *
 * **질의의 `WHERE` 가 이 목록으로 좁힌다.** 「`DELIVERED` 가 아닌 것」이라고 따로
 * 적으면 위의 표와 이 조건이 두 벌이 되고, 상태가 하나 늘어난 날 둘이 조용히
 * 다른 말을 한다 — 표에는 `null` 인데 질의는 집어 오는 조합이 그것이고, 그때
 * 증상은 「배치가 매 주기 같은 건에서 실패한다」다.
 */
export const advanceableShipmentStatuses: readonly ShipmentStatus[] = shipmentStatuses.filter(
  (status) => NEXT_EVENT[status] !== null,
)

/**
 * 발송에서 배송완료까지 시뮬레이터가 만드는 사건의 수. 지금은 셋이다.
 *
 * 세어서 쓰는 이유는 아래 시간 예산이 「단계당 얼마 × 몇 단계」이기 때문이다. 손으로
 * 적은 3 은 상태가 하나 늘어난 날 조용히 틀리고, 그때 틀리는 것은 **데모가 시간
 * 안에 끝나는가**라는 이 TASK 의 존재 이유다.
 */
export const DELIVERY_STEPS = advanceableShipmentStatuses.length

/**
 * 한 단계 사이의 간격 — **시간 압축의 전부가 이 표다** ({@link FulfillmentPace}).
 *
 * ## 왜 축이 필요한가
 *
 * 실제 배송 시간을 쓰면 방문자가 배송완료를 보지 못하고, 그 뒤의 구매확정 · 정산 ·
 * 반품까지를 **전혀 시연하지 못한다.** 데모 계정 수명이 24시간이라 그 안에 전
 * 과정이 끝나야 한다 (TASK-0062 4장).
 *
 * ## 왜 **새 축**인가 — 있는 축을 먼저 봤다
 *
 * | 후보 | 왜 아닌가 |
 * | --- | --- |
 * | **데모 계정 판정** | `auth/demo-containment.spec.ts` 가 그 플래그를 이름 부를 수 있는 파일을 다섯 개로 못 박아 뒀고(TASK-0105 F8), 그 목록은 「정말 필요한 TASK 가 같은 커밋에서 자기 파일을 추가한다」는 **검토를 강제하려고** 있다. 여기서 그 검토의 답은 **아니오**다: 배치가 속도 하나를 정하려고 `Shipment → SellerOrder → Order → User` 를 타야 하고, 무엇보다 **한 배송의 속도가 「누가 샀는가」에 따라 갈린다** — 같은 판매자 콘솔에 뜬 두 주문이 다른 속도로 움직이고, 실계정으로 로그인해 시연하는 사람은 그 흐름을 아예 못 본다. (그 검사는 프로즈까지 훑으므로 이 문단이 플래그의 이름을 적지 않는 것도 같은 규칙이다 — 목록에 오를 자격이 없는 파일은 그 이름을 쓰지 않는다) |
 * | **`PAYMENT_SIMULATION`** | 저것이 켜는 것은 **실패**다(승인 지연 · 랜덤 거절). 운영에 있으면 안 되는 장치라 기본값이 `off` 이고, 여기에 배송 속도를 매달면 「결제가 가끔 실패해야 배송이 빨라진다」가 된다 |
 * | **`nodeEnv`** | 배포된 데모가 곧 `production` 이다. 여기 매달면 배포에서만 느려지는데, 그 배포가 정확히 이 기능이 존재하는 이유다 |
 *
 * ## 왜 「늘 압축」이 아닌가
 *
 * TASK 문서 2장이 「일반 모드 시간(단계당 수 시간)」을 범위에 넣었고 5장이 그것을
 * 환경변수로 적었다. 문서가 기준이다(CLAUDE.md 4장) — 그리고 그 편이 정직하다:
 * 도메인과 상태 전이를 실제와 같게 두는 것이 이 저장소의 배송 방침이므로
 * (CLAUDE.md 5장), 실제에 가까운 속도가 **선택 가능한 값으로도 존재하지 않는**
 * 것은 그 방침과 어긋난다.
 *
 * ## 두 값
 *
 * **`demo` 는 단계당 2분이고 총 6분이다.** TASK 문서 4장의 그림은 「(2분) 집화 →
 * (2분) 간선 → (2분) 배송출발 → (2분) 배송완료」로 넷을 세지만, 집화는 발송
 * 처리와 함께 이미 기록되므로(TASK-0061) 시뮬레이터가 만드는 것은 셋이다 — 8분이
 * 아니라 6분이고, F2 의 「10분 내 배송완료」는 그 여유까지 포함해 지켜진다.
 *
 * **`realistic` 은 단계당 4시간이고 총 12시간이다.** 단계마다 같은 간격인 것은 이
 * 값이 실제 배송을 **흉내 내려는 것이 아니기** 때문이다 — 흉내 내려면 「간선은 밤에
 * 뛰고 배송출발은 아침이다」 같은 시각대가 들어와야 하는데, 그것은 가상 운송사에
 * 없는 사실이고 지어내면 지어낸 만큼 거짓이 는다. 12시간을 고른 근거는 하나다:
 * **데모 계정 수명(24시간) 안에는 끝나야 한다** — 그러지 않으면 이 모드에서는
 * 구매확정도 정산도 영영 시연할 수 없다. 단위 스펙이 그 부등식을 단언한다.
 */
export const DELIVERY_STEP_MS: Readonly<Record<FulfillmentPace, number>> = {
  demo: 2 * 60_000,
  realistic: 4 * 60 * 60_000,
}

export function deliveryStepMs(pace: FulfillmentPace): number {
  return DELIVERY_STEP_MS[pace]
}

/**
 * 마지막 사건이 이 시각보다 앞선 배송만 다음 단계로 민다.
 *
 * **기준은 「마지막으로 기록된 사건의 시각」이다** — `Shipment.shippedAt` 도,
 * 시뮬레이터가 마지막으로 돈 시각도 아니다. 셋의 차이가 실제로 갈리는 자리가
 * 있다: 판매자가 수동 진행을 한 번 누르면 그 순간부터 다음 단계까지 온전히 한
 * 단계가 남아야 하고(발송 시각 기준이면 눌러도 다음 단계가 곧바로 따라온다),
 * 배치가 몇 주기 쉬었다가 돌아오면 밀린 단계들이 **한 주기에 하나씩** 차례로
 * 올라와야 한다(배치 실행 시각 기준이면 한 번에 하나만 올라오고 나머지는 다음
 * 실행까지 또 기다린다).
 */
export function advanceableBefore(now: Date, stepMs: number): Date {
  return new Date(now.getTime() - stepMs)
}

/**
 * 이 사건이 일어난 것으로 적을 시각 — **때가 된 시각**이지 우리가 적은 시각이 아니다.
 *
 * 주기가 1분이고 데모 단계가 2분이라, `now` 를 적으면 매 단계가 최대 1분씩 늦게
 * 기록된다. 그 자체는 작지만 **다음 단계의 기준이 그 늦은 시각**이라 오차가 단계마다
 * 쌓인다 — 세 단계면 데모의 6분이 9분이 될 수 있고, 그것은 F2 가 재는 바로 그
 * 숫자다. 기준을 「마지막 사건의 시각」으로 잡은 설계가 그것을 막고, 여기서 `now`
 * 를 적으면 그 설계가 무너진다.
 *
 * 지어낸 시각이 아니냐는 물음의 답은 「운송사가 지어낸 시각이 맞다」이다. 실제
 * 추적에서도 이 칸은 **사건이 일어난 시각**이지 우리 서버가 그 보고를 받은 시각이
 * 아니고, 이 데모의 운송사는 이 배치다.
 */
export function dueAt(lastEventAt: Date, stepMs: number): Date {
  return new Date(lastEventAt.getTime() + stepMs)
}

/**
 * 한 주기가 미는 배송의 수. 나머지는 다음 주기가 가져간다.
 *
 * **스위퍼의 200 을 그대로 쓰지 않는다.** 저쪽에서 한 건은 트랜잭션 안의 `UPDATE`
 * 한 줄이지만, 여기서 한 건은 **배송 행을 잠그고 · 사건 한 줄을 적고 · 배송을
 * 갱신하고 · 배송완료면 주문 전이까지 지나는** 트랜잭션 하나다
 * (`ShipmentService.recordTrackingEvent`). 200건이면 그동안 그 주문들의 행이 잠겨
 * 판매자 콘솔의 전이가 함께 밀린다 — 청소가 장애를 만드는 모양이고, 스위퍼가
 * 같은 문장을 자기 상한의 근거로 적어 뒀다.
 *
 * 100 은 {@link worstCycleMs} 가 {@link DELIVERY_STALE_AFTER_MS} 아래에 들어가는
 * 값이다. 넘겨 잡으면 **일하느라 늦은 배치를 헬스체크가 「멈췄다」로 읽는다** —
 * `payment-straggler.ts` 가 같은 부등식을 같은 이유로 단언한다.
 *
 * 반대쪽 걱정 — 「밀린 것이 안 줄어든다」 — 은 이 배치가 다루는 모집단이 막아
 * 준다. 후보는 **지금 배송 중인 주문**뿐이고, 한 건은 단계 사이에 최소 한 단계
 * 간격(데모에서 2분)을 쉰다. 한 주기(1분)에 100건이 동시에 때가 되려면 배송 중인
 * 주문이 200건은 있어야 하고, 그런 데모는 없다.
 */
export const DELIVERY_BATCH_LIMIT = 100

/**
 * 사건 한 건을 적는 최악의 시간.
 *
 * `payment-straggler.ts` 의 `LOCAL_STEP_BUDGET_MS` 와 같은 값이고 같은 근거다 —
 * 결제사도 운송사도 부르지 않는 트랜잭션 하나라 밀리초로 끝나지만 0 은 아니고,
 * 배송 행이나 주문 행의 잠금을 기다리는 날이 있어 1초를 잡는다. 저쪽 상수를
 * 그대로 들여오지 않은 것은 이름이 결제의 것이기 때문이다: 값이 같은 것은 우연이
 * 아니라 **같은 종류의 한 건**이라는 뜻이고, 한쪽이 바뀔 때 다른 쪽이 따라가야
 * 한다는 규칙은 없다.
 */
export const DELIVERY_STEP_BUDGET_MS = 1_000

/**
 * 도는 주기.
 *
 * 옆의 세 잡과 같은 1분이지만 근거는 다르다. 여기서 주기는 **데모 단계의
 * 해상도**다 — 단계가 2분인데 주기가 5분이면 「2분마다 한 단계」가 실제로는
 * 5분마다 한 단계가 되고, 그 순간 이 TASK 가 약속한 숫자가 거짓이 된다. 주기는
 * 가장 짧은 단계보다 넉넉히 짧아야 하고, 그 관계를 단위 스펙이 단언한다.
 */
export const DELIVERY_INTERVAL_MS = 60_000

/**
 * 이보다 오래 안 돌았으면 degraded 다.
 *
 * 주기의 다섯 배. 근거는 `reservation-sweeper.ts` · `payment-reconcile.ts` ·
 * `payment-straggler.ts` 의 같은 상수와 같다 — 한 번 걸러 뛰는 것은 재시작이나
 * 배포로도 일어나고, 그것까지 알람으로 만들면 아무도 알람을 안 본다.
 */
export const DELIVERY_STALE_AFTER_MS = 5 * DELIVERY_INTERVAL_MS

/**
 * 최악의 한 주기가 얼마나 걸리는가.
 *
 * 이 함수가 있는 이유는 상한의 근거가 되는 계산을 **스펙이 단언할 수 있게** 하기
 * 위해서다 (`payment-straggler.ts` 의 같은 함수가 선례다). 한 건의 예산이나 상한이
 * 나중에 움직이면, 임계치를 넘기는 순간 단위 스펙이 먼저 빨개진다.
 */
export function worstCycleMs(): number {
  return DELIVERY_BATCH_LIMIT * DELIVERY_STEP_BUDGET_MS
}

export const DELIVERY_LAST_RUN_KEY = 'shipping.delivery.lastRunAt'
export const DELIVERY_LAST_ADVANCED_KEY = 'shipping.delivery.lastAdvanced'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * **스위퍼의 {@link lockKeyOf} 를 그대로 쓴다.** 그 함수가 있는 이유가 「두 기능이
 * 우연히 같은 수를 고르면 하나가 영문 모른 채 건너뛴다」이므로, 네 번째 잡이 자기
 * 해시를 따로 만들면 그 보증이 바로 깨진다 — 같은 함수에 다른 문자열을 넣는 것이
 * 곧 「다르다」의 증명이다.
 */
export const DELIVERY_LOCK_KEY = lockKeyOf('shipping.delivery')

/**
 * 한 건을 민 결과.
 *
 * **`delivered` 를 따로 세는 이유는 그 한 건이 다른 일을 하기 때문이다.** 중간
 * 단계는 배송 표만 움직이지만 배송완료는 주문 전이를 함께 지나고, 그것이 구매확정
 * · 정산 · 반품이 열리는 지점이다. 한 칸에 합치면 「오늘 배송이 몇 건 끝났나」에
 * 답할 수 없다.
 */
export type DeliveryOutcome =
  /** 중간 단계 하나를 올렸다. 배송 표만 움직인다. */
  | 'advanced'
  /** 마지막 단계까지 갔다. 주문이 `DELIVERED` 가 됐다. */
  | 'delivered'
  /** 한 건이 던졌다. 이 건은 다음 주기로 넘어간다. */
  | 'failed'

/** 한 주기가 무엇을 만났나. 이름은 {@link DeliveryOutcome} 과 같다. */
export interface DeliveryTally {
  readonly advanced: number
  readonly delivered: number
  readonly failed: number
}

/** 아무것도 만나지 않은 주기. 건너뛴 주기의 값이기도 하다. */
export const NOTHING_ADVANCED: DeliveryTally = { advanced: 0, delivered: 0, failed: 0 }

/**
 * 결과 하나를 센다.
 *
 * 이름을 {@link DeliveryTally} 의 칸 이름과 같게 맞춰 둔 덕분에 분기가 없다.
 * `switch` 로 적으면 결과가 하나 늘 때 기본 갈래가 그것을 조용히 삼키는데, 이
 * 배치에서 「세지 않은 결과」는 곧 **헬스체크가 못 보는 상태**다
 * (`payment-reconcile.ts` 의 `counted` 와 같은 이유다).
 */
export function counted(tally: DeliveryTally, outcome: DeliveryOutcome): DeliveryTally {
  return { ...tally, [outcome]: tally[outcome] + 1 }
}

/**
 * 이 주기가 실제로 **민** 건수. `AppMeta` 와 헬스체크에 실리는 숫자다.
 *
 * `failed` 는 빠진다 — 아직 안 민 것이고, 더하면 계속 던지는 한 건이 「배치가
 * 일하고 있다」의 근거로 둔갑한다. 그래야 그 한 건이 「밀린 것이 안 줄어든다」로
 * 드러난다.
 */
export function advancedCount(tally: DeliveryTally): number {
  return tally.advanced + tally.delivered
}

/**
 * 이 주기를 로그로 남길 것인가.
 *
 * **아무것도 안 민 주기는 남기지 않는다.** 배송 중인 것이 없거나 아직 때가 안 된
 * 주기가 정상이고, 1분마다 「0건」을 한 줄씩 쌓으면 정작 읽어야 할 줄 — 배송
 * 하나가 도착했다 — 이 그 사이에 묻힌다. 옆의 세 잡과 같은 판단이다.
 */
export function worthLogging(tally: DeliveryTally): boolean {
  return advancedCount(tally) > 0 || tally.failed > 0
}

/**
 * 마지막 실행이 너무 오래됐는가.
 *
 * 판단은 스위퍼의 {@link isStale} 을 그대로 쓴다 — 「한 번도 안 돌았으면
 * stale」이라는 해석까지 같아야 하고, 그것을 여기서 다시 정하면 네 헬스 지표가
 * 조용히 다른 말을 하게 된다. 다른 것은 임계치뿐이다.
 */
export function isDeliveryStale(lastRunAt: Date | null, now: Date): boolean {
  return isStale(lastRunAt, now, DELIVERY_STALE_AFTER_MS)
}
