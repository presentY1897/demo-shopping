import type { OrderStatus, SellerOrderHistoryEntry } from '@shopping/shared'

import type { AppConfig, FulfillmentPace } from '../config/app-config.js'
import { isStale, lockKeyOf } from '../reservation/reservation-sweeper.js'

/**
 * 자동 구매확정의 순수 판단과 상수 (TASK-0064 F2 · F3 · F7).
 *
 * **구매확정은 정산(M12)과 적립금(M11)의 방아쇠다.** 그래서 이 잡이 멈추면 확정되지
 * 않은 몫이 쌓이고, 판매자는 배송이 끝난 물건의 돈을 영영 못 받는다 — 그런데
 * **아무것도 실패하지 않는다.** 주문도 결제도 배송도 에러를 내지 않고, 구매자
 * 화면에는 「배송완료」가 그대로 떠 있다. 그 침묵을 밖으로 꺼낼 자리가 헬스체크이고,
 * 이 파일이 그 판단을 쥔다 (`health/order-confirm.health-indicator.ts`).
 *
 * 예약 만료 청소기·결제 대사 배치와 구조가 같은 것은 우연이 아니다
 * (`reservation/reservation-sweeper.ts` · `payment/payment-reconcile.ts`). 다른
 * 것은 **한 건의 값**이다: 한 건이 곧 「상태를 옮기는 문을 한 번 지나는 것」이고,
 * 그 문은 자기 트랜잭션을 요구한다. 아래 숫자와 배치 구조가 전부 그 차이에서 나온다.
 *
 * 데이터베이스도 시계도 보지 않는다. 그래서 분기 전부가 단위 테스트에서 닿고, 이
 * TASK 의 Q5 는 **분기 커버리지 100%** 다.
 */

/**
 * 실제 서비스의 자동 확정 기간 — 배송완료 D+7.
 *
 * 국내 커머스의 표준이고 (`docs/tasks/M09-fulfillment/TASK-0064-order-confirm.md`
 * 4장), 구매자가 반품을 결정하기까지 주는 시간이다. 이 값이 짧아지면 「확정은
 * 되돌릴 수 없다」가 사람에게 불리한 쪽으로 기울고, 길어지면 판매자의 정산이 늦는다.
 */
export const AUTO_CONFIRM_AFTER_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * 시간을 압축한 데모의 자동 확정 기간 — 배송완료 후 5분.
 *
 * **데모의 방문자는 7일을 기다리지 않는다.** 구매확정이 정산과 적립금의 방아쇠인데
 * 그것이 실제 기간을 지키면 데모에서는 그 뒤의 마일스톤이 통째로 보이지 않는다.
 * 데모 계정 수명이 24시간이므로 (TASK-0025), 그 안에 배송과 확정이 함께 끝나야
 * 한다 — 압축된 배송이 6분이고 (`shipping/delivery-simulator.ts`) 여기 5분이 붙어
 * 발송에서 확정까지 11분이다.
 *
 * 그래도 **화면은 압축된 시간을 실제라고 말하지 않는다** — 구매자 화면이 「실제
 * 서비스에서는 배송완료 7일 뒤」를 함께 적는 이유가 이것이다
 * (`apps/shop/src/lib/orders/auto-confirm.ts`).
 */
export const AUTO_CONFIRM_DEMO_AFTER_MS = 5 * 60_000

/**
 * 이 프로세스가 쓰는 자동 확정 기간 — **압축 여부를 판단하는 유일한 자리**.
 *
 * ## 축을 새로 만들지 않는다
 *
 * 시간 압축은 이 TASK 혼자 정할 수 없다. **배송 시뮬레이터(TASK-0062)가 같은 것을
 * 정한다** — 저쪽이 배송을 6분으로 압축하는데 확정이 7일을 지키면 데모의 흐름은
 * 배송완료에서 끊기고, 반대로 축이 둘이면 「데모 모드」가 두 벌이 되어 **둘 중
 * 하나만 켠 배포**가 생긴다. 그때 증상은 「배송은 8분인데 확정은 7일」이고, 아무것도
 * 실패하지 않는다.
 *
 * 그래서 축은 저쪽이 세운 {@link FulfillmentPace}(`FULFILLMENT_PACE`) **하나**를 그대로
 * 읽는다. 왜 데모 계정 판정도 `PAYMENT_SIMULATION` 도 `nodeEnv` 도 아닌지는
 * `shipping/delivery-simulator.ts` 의 `DELIVERY_STEP_MS` 에 표로 적혀 있고, 그
 * 판단을 여기서 다시 내리지 않는다 — 다시 내리는 순간 두 벌이 된다.
 *
 * ## 그래도 함수가 하나 있는 이유
 *
 * 두 기능이 같은 축을 읽되 **같은 숫자를 쓰지는 않는다.** 배송의 단계 간격과
 * 확정의 대기 기간은 다른 사실이고, 저쪽의 2분이 바뀌었다고 여기 5분이 따라 바뀔
 * 이유는 없다. 판단(「압축인가」)은 한 곳에서 오고 값(「그러면 얼마인가」)은 각자
 * 갖는 것이 그 둘을 함께 지키는 모양이다.
 *
 * 부르는 쪽이 아는 것은 **밀리초 하나**다. 축이 바뀌면 이 함수의 본문만 바뀌고
 * 스케줄러도 검사도 손대지 않는다.
 */
export function autoConfirmWindowMsOf(config: Pick<AppConfig, 'fulfillmentPace'>): number {
  return autoConfirmWindowMs(config.fulfillmentPace)
}

/**
 * 이 속도의 기간.
 *
 * `Record` 가 아니라 삼항인 것은 값이 둘뿐이고 **둘의 관계가 표가 아니기** 때문이다 —
 * `DELIVERY_STEP_MS` 는 「속도마다 간격」이라는 표지만, 여기서는 「압축인가 아닌가」
 * 라는 갈래 하나다. 속도가 셋이 되면 컴파일은 통과하고 새 값이 조용히 실제 기간을
 * 받는데, 그것이 바로 압축이 필요한 쪽이 압축되지 않는 경우다 — 그래서 그날 이
 * 함수를 표로 바꾸는 것을 잊지 않도록 아래 스펙이 두 값을 모두 이름으로 단언한다.
 */
export function autoConfirmWindowMs(pace: FulfillmentPace): number {
  return pace === 'realistic' ? AUTO_CONFIRM_AFTER_MS : AUTO_CONFIRM_DEMO_AFTER_MS
}

/**
 * 이 시각보다 앞서 배송완료된 몫만 확정한다.
 *
 * 배치가 「지금 − 기간」을 한 번 계산해 두고 그것과 비교하는 이유는, 몫마다 「이
 * 줄의 시각 + 기간 ≤ 지금」을 계산하면 그 덧셈이 **행 수만큼** 일어나고 그중 하나만
 * 틀려도 한 주문이 조용히 안 넘어가기 때문이다. 비교의 기준을 하나로 만들어 두면
 * 그 하나만 재면 된다 (`payment-reconcile.ts` 의 `askableBefore` 와 같은 모양).
 */
export function confirmableBefore(now: Date, windowMs: number): Date {
  return new Date(now.getTime() - windowMs)
}

/**
 * 이 몫이 자동 확정될 시각, 또는 예정이 없으면 `null` (F8 · 계약의 `autoConfirmAt`).
 *
 * **배치는 이것을 쓰지 않는다** — 그쪽은 {@link confirmableBefore} 로 한 번 걸러
 * 내는 편이 싸다. 이 함수가 있는 이유는 **사람에게 날짜를 말하기 위해서**이고,
 * 그래서 계산의 주어가 「지금」이 아니라 「이 주문」이다.
 *
 * 화면이 직접 더하지 않고 서버가 주는 이유는 계약에 적혀 있다: 압축 여부는 배포
 * 설정이고 어떤 응답에도 실리지 않으므로, 화면이 D+7 을 더하면 압축된 배포에서
 * **틀린 날짜**를 자신 있게 적게 된다.
 *
 * 기준은 **이력의 첫 `DELIVERED` 줄**이다. 배치가 보는 것과 같은 사실이어야
 * 화면이 말한 시각에 실제로 확정된다 — 둘이 다른 것을 보면 「예정일이 지났는데
 * 그대로인 주문」이 생기고, 그것은 아무 오류도 내지 않는다.
 */
export function autoConfirmAtOf(
  status: OrderStatus,
  history: readonly SellerOrderHistoryEntry[],
  windowMs: number,
): string | null {
  if (status !== 'DELIVERED') return null

  const delivered = history.find((entry) => entry.toStatus === 'DELIVERED')

  if (delivered === undefined) return null

  return new Date(Date.parse(delivered.occurredAt) + windowMs).toISOString()
}

/**
 * 도는 주기. 스위퍼·대사와 같은 1분이지만 이유가 다르다.
 *
 * 저 둘은 「1분 안에 풀린다」가 요구사항이거나 사람이 기다리는 시간이라서고,
 * 여기서는 **압축된 데모의 5분이 이 주기로 나뉘기 때문**이다. 주기가 5분이면
 * 「5분 뒤 자동 확정」이 최악에 10분이 되고, 그러면 데모를 보는 사람은 압축이
 * 동작하는지 알 수 없다.
 */
export const CONFIRM_INTERVAL_MS = 60_000

/**
 * 이보다 오래 안 돌았으면 degraded 다.
 *
 * 주기의 다섯 배. 근거는 `reservation-sweeper.ts` 의 같은 상수와 같다 — 한 번 걸러
 * 뛰는 것은 재시작이나 배포로도 일어나고, 그것까지 알람으로 만들면 아무도 알람을
 * 안 본다.
 */
export const CONFIRM_STALE_AFTER_MS = 5 * CONFIRM_INTERVAL_MS

/**
 * 한 주기가 확정할 몫의 수. 나머지는 다음 주기가 가져간다.
 *
 * **대사의 10이 아니라 스위퍼의 200이다.** 저쪽에서 한 건은 결제사와의 왕복이지만
 * 여기서 한 건은 짧은 트랜잭션 하나(잠그고 · 갱신하고 · 이력 한 줄)이고, 바깥으로
 * 나가지 않는다. 200건이라도 한 주기가 초 단위로 끝나므로
 * {@link CONFIRM_STALE_AFTER_MS} 를 넘길 수 없다 — 넘겨 잡으면 **일하느라 늦은
 * 배치를 헬스체크가 「멈췄다」로 읽는다.**
 */
export const CONFIRM_BATCH_LIMIT = 200

export const CONFIRM_LAST_RUN_KEY = 'order.confirm.lastRunAt'
export const CONFIRM_LAST_CONFIRMED_KEY = 'order.confirm.lastConfirmed'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * **스위퍼의 {@link lockKeyOf} 를 그대로 쓴다.** 그 함수가 있는 이유가 「두 기능이
 * 우연히 같은 수를 고르면 하나가 영문 모른 채 건너뛴다」이므로, 세 번째 잡이 자기
 * 해시를 따로 만들면 그 보증이 바로 깨진다.
 */
export const CONFIRM_LOCK_KEY = lockKeyOf('order.confirm')

/** 한 주기가 무엇을 만났나. */
export interface ConfirmTally {
  /** 이 주기가 실제로 `CONFIRMED` 로 옮긴 몫의 수. */
  readonly confirmed: number
  /**
   * 고른 뒤에 보니 이미 옮겨져 있던 몫.
   *
   * **정상이다.** 구매자가 먼저 눌렀거나 다른 인스턴스가 먼저 집은 것이고, 문이
   * 멱등이라 아무 일도 일어나지 않았다는 뜻이다 (F7).
   */
  readonly noop: number
  /**
   * 옮기려다 던진 몫. 이 한 건은 다음 주기로 넘어간다.
   *
   * 나머지 둘이 늘어나는 것은 배치가 일하고 있다는 뜻이지만, 이것이 늘어나는 것은
   * 배치가 **한 건에 걸려 있다**는 뜻이다.
   */
  readonly failed: number
}

/** 아무것도 만나지 않은 주기. 건너뛴 주기의 값이기도 하다. */
export const NOTHING_CONFIRMED: ConfirmTally = { confirmed: 0, noop: 0, failed: 0 }

/** 답 하나를 센다. 이름을 칸 이름과 같게 맞춰 둔 덕분에 분기가 없다. */
export function counted(tally: ConfirmTally, outcome: keyof ConfirmTally): ConfirmTally {
  return { ...tally, [outcome]: tally[outcome] + 1 }
}

/**
 * 이 주기를 로그로 남길 것인가.
 *
 * **`noop` 만 있는 주기는 남기지 않는다.** 멱등이 동작했다는 뜻이라 배치가 고칠
 * 것이 없고, 1분마다 「0건 확정」을 쌓으면 정작 읽어야 할 줄 — 자동 확정이 실제로
 * 일어났고 한 건은 실패했다 — 이 그 사이에 묻힌다 (`payment-reconcile.ts` 의 같은
 * 함수와 같은 판단).
 */
export function worthLogging(tally: ConfirmTally): boolean {
  return tally.confirmed > 0 || tally.failed > 0
}

/**
 * 마지막 실행이 너무 오래됐는가.
 *
 * 판단은 스위퍼의 {@link isStale} 을 그대로 쓴다 — 「한 번도 안 돌았으면 stale」
 * 이라는 해석까지 같아야 하고, 그것을 여기서 다시 정하면 세 헬스 지표가 조용히 다른
 * 말을 하게 된다. 다른 것은 임계치뿐이다.
 */
export function isConfirmStale(lastRunAt: Date | null, now: Date): boolean {
  return isStale(lastRunAt, now, CONFIRM_STALE_AFTER_MS)
}
