import { LOCAL_STEP_BUDGET_MS, PROVIDER_DEADLINE_MS } from '../payment/payment-straggler.js'
import { isStale, lockKeyOf } from '../reservation/reservation-sweeper.js'
import type { ClaimStatus } from './claim-rules.js'
import { claimRuleFor, claimStatuses } from './claim-rules.js'

/**
 * 환불 재시도 배치의 순수 판단과 상수 (TASK-0068 F8 · R3).
 *
 * **이 배치가 찾는 것은 「돈이 안 나간 채 멈춰 선 클레임」 하나뿐이다.**
 * `payment-reconcile.ts` · `payment-straggler.ts` 와 구조가 같고 — 상한 · 유예 ·
 * 락을 쥐는 구간 · 「건너뛴 실행은 기록하지 않는다」까지 그대로다 — 다른 것은 무엇을
 * 찾느냐뿐이다.
 *
 * **이 잡이 멈추면 아무것도 실패하지 않는다.** 승인된 취소가 `CANCEL_APPROVED` 로,
 * 검수를 통과한 반품이 `RETURN_COMPLETED` 로 앉아 있을 뿐이고, 그 두 상태는 정상
 * 흐름에서도 잠깐 지나는 자리라 목록만 봐서는 구분되지 않는다. 구매자에게는 「돈이
 * 안 들어온다」로만 보이고, 그때 그 사람이 할 수 있는 일은 문의뿐이다.
 */

/**
 * 환불로 갈 수 있는 자리 — **전이표에서 뽑는다.**
 *
 * 목록을 손으로 적지 않는 이유는 `cancelSettledStatuses` 와 같다. 나중에 세 번째
 * 경로가 `REFUNDED` 로 가는 화살표를 얻는 날, 손으로 적은 목록은 그 경로를 **조용히
 * 빠뜨린 채** 계속 초록이다 — 재시도되지 않는 환불은 아무 오류도 내지 않는다.
 */
export const refundableStatuses: readonly ClaimStatus[] = claimStatuses.filter(
  (status) => claimRuleFor(status, 'REFUNDED') !== null,
)

/**
 * 한 주기가 다시 시도할 클레임의 수.
 *
 * **한 건이 결제사와의 왕복이고 그것도 하나씩 차례로 한다.** 대사(`payment-reconcile`)
 * 와 낙오 배치의 「뒤로」가 같은 수를 쓰고 같은 근거를 갖는다 — 저쪽이 죽은 날에는
 * 한 건이 마감을 통째로 쓰므로, 10 × 16초가 곧 {@link worstCycleMs} 다.
 *
 * 밀린 것이 안 줄어들 걱정은 이 상태의 성질이 막는다. 정상 흐름에서 환불은 승인·검수
 * 그 자리에서 곧바로 나가고(`ClaimService.publishCancel` · `ReturnService`), 여기
 * 남는 것은 그 한 번이 실패한 건뿐이다 — 평소에는 0건이다.
 */
export const CLAIM_REFUND_LIMIT = 10

/**
 * 도는 주기.
 *
 * 옆의 세 잡과 같은 1분이고, 근거는 **기다리는 사람이 있다**는 것이다. 취소가
 * 승인됐는데 돈이 안 돌아온 상태는 구매자가 실제로 화면을 새로고침하는 상태이고,
 * 주기가 곧 「첫 시도가 실패했을 때 다음 시도까지 걸리는 시간」이다.
 */
export const CLAIM_REFUND_INTERVAL_MS = 60_000

/**
 * 상태가 옮겨진 지 이만큼 지난 것만 다시 시도한다.
 *
 * **정상 흐름도 반드시 이 창을 지난다.** 승인·검수는 커밋한 **뒤에** 환불을 부르므로
 * (`publishCancel` 이 그 자리에 있는 이유가 「롤백된 승인의 환불은 되돌릴 수 없다」
 * 이다), 그 사이의 한순간은 모든 클레임이 정확히 이 배치가 찾는 모양이다. 유예 없이
 * 집으면 배치가 방금 승인된 취소의 환불과 겹치고, 그때 둘 중 하나는 클레임 행 잠금
 * 앞에서 기다렸다가 「이미 `REFUNDED`」를 보고 물러난다 — 결과는 옳지만 결제사에
 * 붙은 연결 하나가 그동안 헛돈다.
 *
 * 인라인 시도 하나의 최악은 결제사 마감({@link PROVIDER_DEADLINE_MS}, 15초)이고
 * 1분은 그 네 배다. 동시에 주기와 같아서, 진짜 실패한 건은 **최악에도 유예 + 주기,
 * 2분** 안에 다시 시도된다 — `payment-straggler.ts` 의 앞쪽 유예와 같은 값이고 같은
 * 셈이다.
 *
 * 기준 컬럼은 `ClaimRequest.updatedAt` 이다. 승인·검수가 상태를 옮기며 적은 시각이고,
 * 실패한 환불은 트랜잭션째 롤백되므로 그 행을 건드리지 않는다 — 즉 이 값은 **다시
 * 시도해야 할 클레임에 대해서는** 곧 「환불을 기다리기 시작한 시각」이다.
 */
export const CLAIM_REFUND_GRACE_MS = 60_000

/**
 * 이보다 오래 안 돌았으면 멈춘 것으로 본다.
 *
 * 주기의 다섯 배. 근거는 옆의 세 잡과 같다 — 한 번 걸러 뛰는 것은 재시작이나
 * 배포로도 일어나고, 그것까지 알람으로 만들면 아무도 알람을 안 본다.
 *
 * {@link worstCycleMs} 가 이 값 아래여야 한다. 넘겨 잡으면 **일하느라 늦은 배치를
 * 「멈췄다」로 읽는다.**
 */
export const CLAIM_REFUND_STALE_AFTER_MS = 5 * CLAIM_REFUND_INTERVAL_MS

/**
 * 최악의 한 주기가 얼마나 걸리는가.
 *
 * 한 건은 **결제사 왕복 하나 + 우리 쪽 트랜잭션 하나**다. 앞은
 * {@link PROVIDER_DEADLINE_MS}(토스의 요청 마감), 뒤는 {@link LOCAL_STEP_BUDGET_MS}
 * — 항목 몇 줄과 결제 행 하나를 잠그고 쓰는 일이라 밀리초로 끝나지만 0 이 아니다.
 *
 * 두 값을 결제 쪽에서 **가져다 쓰는** 이유는, 그것이 늘어나면 이 배치의 상한도 같이
 * 움직여야 한다는 사실이 스펙 한 줄로 남기 때문이다. 여기 숫자를 옮겨 적으면 저쪽
 * 마감이 바뀌는 날 이 부등식은 조용히 거짓이 된다.
 */
export function worstCycleMs(): number {
  return CLAIM_REFUND_LIMIT * (PROVIDER_DEADLINE_MS + LOCAL_STEP_BUDGET_MS)
}

export const CLAIM_REFUND_LAST_RUN_KEY = 'claims.refund.lastRunAt'
export const CLAIM_REFUND_LAST_FIXED_KEY = 'claims.refund.lastFixed'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * 스위퍼의 {@link lockKeyOf} 를 그대로 쓴다 — 그 함수가 있는 이유가 「두 기능이
 * 우연히 같은 수를 고르면 하나가 영문 모른 채 건너뛴다」이므로, 네 번째 잡이 자기
 * 해시를 따로 만들면 그 보증이 바로 깨진다.
 */
export const CLAIM_REFUND_LOCK_KEY = lockKeyOf('claims.refund')

/** `Refund.reason` 에 남는 문장. 상담원이 배치와 사람을 구분하는 유일한 자리다. */
export const CANCEL_REFUND_REASON = '취소가 승인되어 환불했습니다.'

export const RETURN_REFUND_REASON = '반품 검수를 통과하여 환불했습니다.'

/**
 * 클레임 하나를 환불하려 한 결과.
 *
 * **`refunded` 와 `settled` 를 나눈다.** 둘 다 「지금은 끝나 있다」로 같지만, 앞은
 * 이번에 돈이 나간 것이고 뒤는 이미 나가 있던 것이다 — 한 칸에 세면 「배치가 몇 건을
 * 구했나」에 멱등이 막아 준 재호출이 섞여 들어온다.
 */
export type RefundOutcome =
  /** 이번에 돈이 나갔다. */
  | 'refunded'
  /** 이미 환불이 끝나 있었다. 멱등이 막은 자리다. */
  | 'settled'
  /**
   * 환불로 갈 수 있는 자리가 아니다 — 거절된 클레임 등. 손댈 것이 없다.
   *
   * 이름이 `skipped` 가 아닌 이유는 {@link RefundRetryResult} 가 그 이름을 **락을 못
   * 잡아 주기를 통째로 건너뛴 것**에 이미 쓰기 때문이다. 둘이 같은 이름이면 「한 건을
   * 안 건드렸다」와 「이번 주기가 아예 안 돌았다」가 한 칸에 섞인다.
   */
  | 'ignored'
  /** 실패했다. 이 건은 다음 주기로 넘어간다. */
  | 'failed'

/** 한 주기가 무엇을 만났나. 이름은 {@link RefundOutcome} 과 같다. */
export interface RefundTally {
  readonly refunded: number
  readonly settled: number
  readonly ignored: number
  readonly failed: number
}

/** 아무것도 만나지 않은 주기. 건너뛴 주기의 값이기도 하다. */
export const NOTHING_REFUNDED: RefundTally = {
  refunded: 0,
  settled: 0,
  ignored: 0,
  failed: 0,
}

/**
 * 이 시각보다 앞서 상태가 옮겨진 것만 다시 시도한다 ({@link CLAIM_REFUND_GRACE_MS}).
 *
 * 유예를 인자로도 받는 이유는 스펙이 1분을 기다릴 수 없기 때문이다 —
 * `capturedBefore` 가 같은 이유로 같은 모양이다.
 */
export function stuckBefore(now: Date, graceMs: number = CLAIM_REFUND_GRACE_MS): Date {
  return new Date(now.getTime() - graceMs)
}

/**
 * 결과 하나를 센다.
 *
 * 이름을 {@link RefundTally} 의 칸 이름과 같게 맞춰 둔 덕분에 분기가 없다. `switch`
 * 로 적으면 결과가 하나 늘 때 기본 갈래가 그것을 조용히 삼키고, 이 배치에서 「세지
 * 않은 결과」는 곧 **아무도 못 보는 실패**다.
 */
export function counted(tally: RefundTally, outcome: RefundOutcome): RefundTally {
  return { ...tally, [outcome]: tally[outcome] + 1 }
}

/**
 * 이 주기가 실제로 **구한** 건수. `AppMeta` 에 실리는 숫자다.
 *
 * `settled` 와 `ignored` 와 `failed` 는 빠진다. 앞의 둘은 배치가 한 일이 없는
 * 것이고 마지막은 아직 못 한 것이다 — 셋 중 하나라도 더하면 「배치가 몇 건을
 * 끝냈나」라는 물음에 한 적 없는 일이 섞여 들어온다.
 */
export function fixedCount(tally: RefundTally): number {
  return tally.refunded
}

/**
 * 이 주기를 로그로 남길 것인가.
 *
 * **아무것도 안 만난 주기와 이미 끝나 있던 것만 만난 주기는 남기지 않는다.** 1분마다
 * 한 줄씩 쌓으면 정작 읽어야 할 줄 — 환불 하나를 구했고 하나를 못 구했다 — 이 그
 * 사이에 묻힌다.
 */
export function worthLogging(tally: RefundTally): boolean {
  return tally.refunded > 0 || tally.failed > 0
}

/**
 * 마지막 실행이 너무 오래됐는가.
 *
 * 판단은 스위퍼의 {@link isStale} 을 그대로 쓴다 — 「한 번도 안 돌았으면 stale」
 * 이라는 해석까지 같아야 하고, 그것을 여기서 다시 정하면 지표들이 조용히 다른 말을
 * 한다. 다른 것은 임계치뿐이다.
 */
export function isClaimRefundStale(lastRunAt: Date | null, now: Date): boolean {
  return isStale(lastRunAt, now, CLAIM_REFUND_STALE_AFTER_MS)
}
