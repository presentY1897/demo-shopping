import { isStale, lockKeyOf } from '../reservation/reservation-sweeper.js'

/**
 * 정산 배치의 상수와 순수 판단 (TASK-0080).
 *
 * 예약 만료 청소기 · 결제 대사 · 자동 구매확정과 구조가 같다
 * (`reservation/reservation-sweeper.ts` · `payment/payment-reconcile.ts` ·
 * `orders/order-confirm.ts`). **다른 것은 주기의 뜻이다.** 저 셋은 「지금 처리할 일이
 * 있는가」를 묻는 잡이지만, 정산은 **주 단위의 회차**를 만든다 — 그래서 주기가
 * 짧아도 답이 달라지지 않고, 자주 도는 것은 「놓친 회차를 빨리 따라잡기 위해서」다.
 *
 * 데이터베이스도 시계도 보지 않는다.
 */

/**
 * 주기 — 한 시간.
 *
 * 회차는 주 단위인데 한 시간마다 도는 이유는 **회차를 만드는 것이 아니라 따라잡는
 * 것**이 이 잡의 일이기 때문이다. 회차의 경계는 시계에서 계산되므로
 * (`settlement-calc.ts` 의 `weekBefore`) 언제 돌아도 같은 회차를 집고, 자주 돌수록
 * 「배포가 월요일 새벽에 잠깐 죽어 있었다」가 정산을 일주일 늦추지 않는다.
 *
 * 반대로 이 주기가 짧아서 손해 볼 것은 거의 없다 — 할 일이 없으면 조회 두 번으로
 * 끝난다.
 */
export const SETTLEMENT_INTERVAL_MS = 60 * 60_000

/**
 * 이만큼 소식이 없으면 멈춘 것으로 본다 — 주기의 다섯 배.
 *
 * 근거는 `reservation-sweeper.ts` 의 같은 상수와 같다. 한 번 걸러도 놀라지 않고,
 * 다섯 번을 내리 거르면 그것은 사고다.
 */
export const SETTLEMENT_STALE_AFTER_MS = SETTLEMENT_INTERVAL_MS * 5

export const SETTLEMENT_LAST_RUN_KEY = 'settlement.batch.lastRunAt'
export const SETTLEMENT_LAST_SETTLED_KEY = 'settlement.batch.lastSettled'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * 스위퍼의 {@link lockKeyOf} 를 그대로 쓴다 — 그 함수가 있는 이유가 「두 기능이
 * 우연히 같은 수를 고르면 하나가 영문 모른 채 건너뛴다」이므로, 다섯 번째 잡이 자기
 * 해시를 따로 만들면 그 보증이 바로 깨진다.
 *
 * 여기서는 **더 중요하다.** 두 인스턴스가 같은 회차를 동시에 만들면 유니크 인덱스가
 * 하나를 거절하는데, 거절되는 쪽이 중간까지 쓴 뒤 롤백되는 것은 낭비이고 로그가
 * 시끄러워진다.
 */
export const SETTLEMENT_LOCK_KEY = lockKeyOf('settlement.batch')

/**
 * 한 번에 만드는 판매 줄의 상한.
 *
 * 한 주의 구매확정이 이보다 많으면 다음 주기가 이어서 집는다 — 회차의 경계가
 * 시계에서 나오므로 나눠 집어도 같은 정산서에 들어간다.
 */
export const SETTLEMENT_BATCH_LIMIT = 500

/** 한 주기가 무엇을 했나. */
export interface SettlementTally {
  /** 새로 만든 판매 줄. */
  readonly settled: number
  /** 승인 전이라 **고쳐 쓴** 판매 줄 (재생성). */
  readonly amended: number
  /** 이미 승인·지급된 회차 뒤에 온 반품이라 **차감 줄로 적은** 몫 (F7). */
  readonly adjusted: number
  /** 손댄 정산서의 수. */
  readonly settlements: number
}

/** 아무것도 하지 않은 주기. 건너뛴 주기의 값이기도 하다. */
export const NOTHING_SETTLED: SettlementTally = {
  settled: 0,
  amended: 0,
  adjusted: 0,
  settlements: 0,
}

/** 마지막 실행이 너무 오래됐는가. **한 번도 안 돌았으면 stale 이다.** */
export function isSettlementStale(lastRunAt: Date | null, now: Date): boolean {
  return isStale(lastRunAt, now, SETTLEMENT_STALE_AFTER_MS)
}
