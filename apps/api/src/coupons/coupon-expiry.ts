import { isStale, lockKeyOf } from '../reservation/reservation-sweeper.js'

/**
 * 쿠폰 만료 배치의 순수 판단과 상수 (TASK-0072 4장 · F7).
 *
 * **이 배치가 멈추면 아무것도 실패하지 않는다.** 기간이 지난 쿠폰이 `ISSUED` 인
 * 채로 쿠폰함에 남고, 화면은 그것을 쓸 수 있는 쿠폰처럼 그린다. 사용자가 그것을
 * 골라 주문서에 넣었을 때에야 적용(TASK-0075)이 기간을 보고 거절하고, 그때 사람이
 * 받는 문장은 「이 쿠폰은 사용할 수 없습니다」다 — 방금 쿠폰함이 쓸 수 있다고
 * 말해 준 그 쿠폰에 대해서.
 *
 * 구조는 `reservation/reservation-sweeper.ts` 와 같고, **다른 것은 한 건의 값**
 * 이다. 저쪽에서 한 건은 `ProductVariant` 를 잠그고 되돌리고 예약을 닫는 세
 * 문장이지만, 여기서 한 건은 **한 표의 상태 한 칸**이다 — 다른 표를 건드리지
 * 않으므로 잠금 순서를 걱정할 일도, 청소가 장애를 만들 일도 없다. 아래 숫자들은
 * 전부 그 차이에서 나온다.
 */

/**
 * 한 주기가 옮기는 장수. 나머지는 다음 주기가 가져간다.
 *
 * **스위퍼의 200 보다 큰 이유는 한 건이 훨씬 싸기 때문이다.** 저쪽은 건마다 다른
 * 표의 행을 잠그므로 한 주기가 길어지면 담기와 주문이 함께 멈추지만, 여기서 한
 * 주기는 인덱스(`UserCoupon_status_expiresAt_idx`)로 고른 행들의 상태를 바꾸는
 * `UPDATE` 하나이고, 그 행들을 동시에 읽는 것은 **그 쿠폰 주인의 쿠폰함**뿐이다.
 *
 * 상한을 두는 이유는 남아 있다. 쿠폰은 **한꺼번에 만료된다** — 캠페인 하나가
 * 같은 `validUntil` 로 10만 장을 뿌리면 그 순간 10만 행이 동시에 대상이 되고,
 * 상한이 없으면 그 한 문장이 표 전체를 훑는 동안 쿠폰함 조회가 그 뒤에 선다.
 * 1,000장 × 분당 1주기면 10만 장이 100분 안에 사라지고, 그동안 밀린 쿠폰이
 * 잘못 쓰이는 일은 없다 — 적용은 상태가 아니라 기간을 본다.
 */
export const COUPON_EXPIRY_BATCH_LIMIT = 1_000

/**
 * 도는 주기.
 *
 * 스위퍼·대사와 같은 1분이지만 이유가 또 다르다. 저쪽 둘은 각각 「재고가 1분 내
 * 풀린다」와 「사람이 화면 앞에서 막혀 있는 시간」이었고, 여기서는 **쿠폰함이
 * 거짓말을 하는 시간**이다. 만료된 쿠폰이 쓸 수 있는 것처럼 보이는 창이 곧 이
 * 값이고, 1분이면 사람이 그 사이를 지나가기 어렵다.
 */
export const COUPON_EXPIRY_INTERVAL_MS = 60_000

/**
 * 한 장을 옮기는 데 넉넉하게 잡은 상한. **실측이 아니라 상한이다.**
 *
 * 아래 부등식을 재기 위한 값이고, 실제 비용(인덱스로 고른 행의 `status` 한 칸)은
 * 이보다 훨씬 작다. 넉넉히 잡아 두면 부등식이 참인 것이 더 강한 말이 된다.
 */
export const COUPON_EXPIRY_ROW_BUDGET_MS = 1

/**
 * 이보다 오래 안 돌았으면 degraded 다.
 *
 * 주기의 다섯 배. 근거는 `reservation-sweeper.ts` 의 같은 상수와 같다 — 한 번
 * 걸러 뛰는 것은 재시작이나 배포로도 일어나고, 그것까지 알람으로 만들면 아무도
 * 알람을 안 본다.
 */
export const COUPON_EXPIRY_STALE_AFTER_MS = 5 * COUPON_EXPIRY_INTERVAL_MS

export const COUPON_EXPIRY_LAST_RUN_KEY = 'coupon.expiry.lastRunAt'
export const COUPON_EXPIRY_LAST_EXPIRED_KEY = 'coupon.expiry.lastExpired'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * **스위퍼의 {@link lockKeyOf} 를 그대로 쓴다.** 그 함수가 있는 이유가 「두 기능이
 * 우연히 같은 수를 고르면 하나가 영문 모른 채 건너뛴다」이므로, 세 번째 잡이 자기
 * 해시를 따로 만들면 그 보증이 바로 깨진다.
 */
export const COUPON_EXPIRY_LOCK_KEY = lockKeyOf('coupon.expiry')

/**
 * 최악의 한 주기가 걸리는 시간.
 *
 * 이 값이 **주기보다 짧아야** 한 주기가 다음 주기를 밀지 않고, **stale 보다
 * 짧아야** 일하느라 늦은 배치를 헬스체크가 「멈췄다」로 읽지 않는다. 두 부등식은
 * `coupon-expiry.spec.ts` 가 단언한다 — 상한을 올리는 사람이 부등식을 함께 보게
 * 하는 것이 이 함수의 존재 이유이고, `payment-straggler.ts` 가 같은 이유로 같은
 * 모양을 갖는다.
 */
export function worstCaseExpiryCycleMs(
  limit: number = COUPON_EXPIRY_BATCH_LIMIT,
  rowBudgetMs: number = COUPON_EXPIRY_ROW_BUDGET_MS,
): number {
  return limit * rowBudgetMs
}

/**
 * 마지막 만료 배치가 너무 오래됐는가.
 *
 * 판단은 스위퍼의 {@link isStale} 을 그대로 쓴다 — 「한 번도 안 돌았으면 stale」
 * 이라는 해석까지 같아야 하고, 그것을 여기서 다시 정하면 세 지표가 조용히 다른
 * 말을 하게 된다. 다른 것은 임계치뿐이다.
 */
export function isCouponExpiryStale(lastRunAt: Date | null, now: Date): boolean {
  return isStale(lastRunAt, now, COUPON_EXPIRY_STALE_AFTER_MS)
}

/**
 * 이 주기를 로그로 남길 것인가.
 *
 * **0건인 주기는 남기지 않는다.** 만료는 캠페인이 끝나는 날에만 몰리므로 평소
 * 주기는 전부 0건이고, 1분마다 「0장 만료」를 한 줄씩 쌓으면 정작 읽어야 할 줄 —
 * 어느 날 5만 장이 한꺼번에 만료됐다 — 이 그 사이에 묻힌다.
 * `payment-reconcile.ts` 의 `worthLogging` 과 같은 판단이다.
 */
export function worthLoggingExpiry(expired: number): boolean {
  return expired > 0
}
