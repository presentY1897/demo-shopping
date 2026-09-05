import { RESERVATION_TTL_MS } from '../reservation/reservation-rules.js'
import { isStale, lockKeyOf, SWEEP_INTERVAL_MS } from '../reservation/reservation-sweeper.js'

/**
 * 낙오된 결제 배치의 순수 판단과 상수 (TASK-0057 F2 · F6 · D-221).
 *
 * **찾는 것이 둘이고 방향이 반대다.** 그 대비가 이 배치의 전부다.
 *
 * | | 무엇이 남았나 | 무엇을 하나 | 결제사를 부르나 |
 * | --- | --- | --- | --- |
 * | **앞으로** | 매입은 끝났는데(`PAID`) 주문이 `PAYMENT_PENDING` | `markPaid` 재실행 | **아니오** |
 * | **뒤로** | 매입 없이 남은 `AUTHORIZED` | 승인 취소 | **예** |
 *
 * 보상이 늘 되감기라는 생각이 이 자리에서 틀린다 (D-221). **되감을지 마저
 * 끝낼지는 「돈이 어디까지 왔는가」가 정한다** — 앞쪽은 돈이 이미 우리 쪽으로
 * 왔고 사람은 물건을 기다리므로 취소하는 것은 사고를 두 번째로 만드는 일이고,
 * 뒤쪽은 돈이 아직 카드사에 잡혀만 있는데 그 결제로 살 수 있는 물건이 이미
 * 없다.
 *
 * 구조는 `payment-reconcile.ts` 와 같다 — 상한 · 유예 · 락을 쥐는 구간 ·
 * 「건너뛴 실행은 기록하지 않는다」까지 그대로다. **다른 것은 무엇을 찾고 무엇을
 * 하느냐뿐이고**, 아래 숫자들은 그 차이에서만 갈라진다.
 */

/**
 * 결제사 왕복 한 번의 최악.
 *
 * `toss.client.ts` 의 `REQUEST_TIMEOUT_MS` 다. 그 파일이 내보내지 않으므로 값을
 * 옮겨 적었고, 옮겨 적은 값이 상한의 근거가 되는 이상 **아래 부등식을 단위
 * 스펙이 단언한다** — 저쪽 마감이 늘어나면 이 배치의 상한도 같이 움직여야 한다는
 * 사실이 그 한 줄로 남는다.
 */
export const PROVIDER_DEADLINE_MS = 15_000

/**
 * 결제사를 부르지 않는 한 건의 최악.
 *
 * 「앞으로」의 한 건은 `markPaid` 트랜잭션 하나 — 예약 몇 줄을 확정하고 재고
 * 원장에 몇 줄을 적는다. 밀리초로 끝나지만 0 이 아니고, 잠금을 기다리는 날이
 * 있어 1초를 잡는다. **이 값이 {@link PROVIDER_DEADLINE_MS} 의 15분의 1인 것이
 * 두 방향의 상한이 다른 이유 전부다.**
 */
export const LOCAL_STEP_BUDGET_MS = 1_000

/**
 * 한 주기가 마저 끝낼 결제의 수 (**앞으로**).
 *
 * 결제사를 부르지 않으므로 대사의 10 보다 훨씬 넉넉해도 된다. 스위퍼의 200 을
 * 그대로 쓰지 않는 것은 이 한 건이 `UPDATE` 한 줄이 아니라 **주문 완료 트랜잭션
 * 전체**이기 때문이다 — 예약 확정과 재고 원장이 그 안에 있고, 200건이면 그동안
 * 그 조합들의 행이 잠겨 담기와 주문이 함께 밀린다.
 *
 * 50 은 {@link worstCycleMs} 의 다른 항과 함께 임계치 아래에 들어가는 값이다.
 * 밀린 것이 안 줄어들 걱정은 이 상태의 성질이 막는다 — 매입과 주문 완료 사이에서
 * 프로세스가 죽어야 생기므로 평소에는 0건이다.
 */
export const STRAGGLER_COMPLETE_LIMIT = 50

/**
 * 한 주기가 취소할 승인의 수 (**뒤로**).
 *
 * **대사의 10 과 같은 수이고 같은 근거다.** 한 건이 결제사와의 왕복이고 그것도
 * 하나씩 차례로 하므로, 저쪽이 죽은 날에는 한 건이 마감을 통째로 쓴다. 10 ×
 * 15초 = 150초이고 그것이 {@link worstCycleMs} 의 지배항이다.
 */
export const STRAGGLER_CANCEL_LIMIT = 10

/**
 * 도는 주기.
 *
 * 옆의 두 잡과 같은 1분이지만 근거는 **앞쪽 방향**이 준다. 돈은 이미 우리 쪽으로
 * 왔고 사람은 물건을 기다린다 — 주기가 곧 「매입 직후에 프로세스가 죽었을 때
 * 주문이 늦게 완료되는 시간」이다. 뒤쪽은 이미 15분을 기다린 뒤라 1분이 급하지
 * 않고, 그래서 이 값은 앞쪽이 정한다.
 */
export const STRAGGLER_INTERVAL_MS = 60_000

/**
 * 매입이 끝난 지 이만큼 지난 것만 마저 끝낸다 (**앞으로**).
 *
 * **`PAID` + `PAYMENT_PENDING` 은 정상 결제도 반드시 지나는 창이다.**
 * `PaymentService.settle` 은 매입을 `PAID` 로 커밋한 **뒤에** `markPaid` 를
 * 부르므로, 그 사이의 짧은 순간에 모든 결제가 정확히 이 모양이다. 유예 없이
 * 집으면 배치가 방금 매입한 결제의 `markPaid` 와 겹쳐 같은 예약을 두 곳에서
 * 확정하려 들고, 그것은 「가끔 결제가 실패한다」로 나타난다.
 *
 * 창은 밀리초지만 0 이 아니다. 1분은 그 창의 몇 만 배이고 — 즉 정상 결제가 여기
 * 걸릴 일이 없고 — 동시에 주기와 같아서, 진짜 낙오된 건은 죽은 뒤 **최악에도
 * 유예 + 주기, 2분** 안에 끝난다. 사람이 물건을 기다리는 시간에 2분은 값이 없다.
 *
 * 기준 컬럼은 `Payment.updatedAt` 이다. 매입이 그 행을 `PAID` 로 옮기며 적은
 * 시각이고, `PAID` 인 동안 그 행을 건드리는 것은 환불뿐인데 환불은 상태를 옮겨
 * 이 조건에서 빠진다 — 즉 이 값은 곧 「매입이 끝난 시각」이다.
 */
export const STRAGGLER_COMPLETE_GRACE_MS = 60_000

/**
 * 승인된 지 이만큼 지난 것만 취소한다 (**뒤로**).
 *
 * **예약 TTL 이 이 값의 하한이다.** 이 결제로 물건을 살 수 있게 하는 것은
 * 예약이고, 예약이 살아 있을 수 있는 동안은 사람이 돌아와 결제를 마칠 수 있다.
 * 승인은 주문서가 예약을 잡은 **뒤에** 일어나므로, `approvedAt` 에서 TTL 을 통째로
 * 세는 것은 **그 사람이 가졌던 창을 전부 기다린 것보다 길다** — 그보다 짧은
 * 값은 근거가 없는 추측이고, R1 이 경고하는 「자동 취소가 정상 결제를 취소」가
 * 정확히 그 자리에서 난다.
 *
 * 여기에 스위퍼 주기 한 번을 더한다. 두 번째 조건 —「살아 있는 예약이 없다」— 은
 * `StockReservation.status` 가 답하는데 그 값을 `HELD` 에서 `RELEASED` 로 옮기는
 * 것은 **예약 만료 스케줄러**이고, 그것은 자기 주기로 돈다. TTL 로 딱 맞추면 매
 * 건이 「시간은 됐는데 예약이 아직 `HELD`」로 한 주기를 그냥 흘려보내게 되고, 그
 * 헛도는 주기는 로그에도 안 남는다. 한 주기를 더해 두면 우리가 보는 두 사실이
 * 같은 시각에 참이 된다.
 *
 * 즉 15분 + 1분 = 16분이다. 정상 결제는 승인에서 매입까지 몇 초라 첫 조건에도
 * 안 걸리고, 걸려도 두 번째가 막는다 (D-221).
 */
export const STRAGGLER_ABANDONED_AFTER_MS = RESERVATION_TTL_MS + SWEEP_INTERVAL_MS

/**
 * 이보다 오래 안 돌았으면 degraded 다.
 *
 * 주기의 다섯 배. 근거는 `payment-reconcile.ts` · `reservation-sweeper.ts` 의 같은
 * 상수와 같다 — 한 번 걸러 뛰는 것은 재시작이나 배포로도 일어나고, 그것까지
 * 알람으로 만들면 아무도 알람을 안 본다.
 *
 * {@link worstCycleMs} 가 이 값 아래여야 한다. 넘겨 잡으면 **일하느라 늦은 배치를
 * 헬스체크가 「멈췄다」로 읽는다.**
 */
export const STRAGGLER_STALE_AFTER_MS = 5 * STRAGGLER_INTERVAL_MS

/**
 * 최악의 한 주기가 얼마나 걸리는가.
 *
 * 두 방향이 **한 주기 안에서 차례로** 돌므로 예산도 함께 쓴다. 앞쪽은 결제사를
 * 부르지 않아 한 건이 싸고 뒤쪽은 비싸다 — 그래서 상한이 5배 차이인데도 뒤쪽이
 * 지배항이다(50초 대 150초). 이 함수가 있는 이유는 그 계산을 스펙이 단언할 수
 * 있게 하기 위해서다.
 */
export function worstCycleMs(): number {
  return (
    STRAGGLER_COMPLETE_LIMIT * LOCAL_STEP_BUDGET_MS + STRAGGLER_CANCEL_LIMIT * PROVIDER_DEADLINE_MS
  )
}

export const STRAGGLER_LAST_RUN_KEY = 'payment.straggler.lastRunAt'
export const STRAGGLER_LAST_FIXED_KEY = 'payment.straggler.lastFixed'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * **스위퍼의 {@link lockKeyOf} 를 그대로 쓴다.** 그 함수가 있는 이유가 「두 기능이
 * 우연히 같은 수를 고르면 하나가 영문 모른 채 건너뛴다」이므로, 세 번째 잡이 자기
 * 해시를 따로 만들면 그 보증이 바로 깨진다 — 같은 함수에 다른 문자열을 넣는 것이
 * 곧 「다르다」의 증명이다.
 */
export const STRAGGLER_LOCK_KEY = lockKeyOf('payment.straggler')

/**
 * 승인 취소에 남기는 사유. `PaymentEvent.payload` 로 들어간다.
 *
 * **상수인 이유는 이것을 읽을 사람이 CS 이기 때문**이다. 배치가 취소한 건과
 * 사람이 취소한 건을 나중에 구분할 수 있어야 하고, 문장을 부르는 자리에서 만들면
 * 그 구분이 오타 하나로 사라진다.
 */
export const STRAGGLER_CANCEL_REASON = '승인만 된 채 예약이 만료되어 배치가 승인을 취소했습니다.'

/**
 * 낙오된 결제 하나를 손본 결과.
 *
 * **앞으로와 뒤로가 다른 칸에 쌓인다.** 둘을 한 칸에 세면 「배치가 몇 건을
 * 고쳤나」에는 답할 수 있어도 「돈이 어디로 갔나」에는 답하지 못한다 — 앞쪽은
 * 받은 돈으로 물건을 보내기 시작한 것이고 뒤쪽은 잡아 둔 돈을 놓아준 것이라,
 * 하나가 갑자기 늘어난 날에 봐야 할 곳이 서로 다르다.
 */
export type StragglerOutcome =
  /** **앞으로** — 매입이 끝난 결제의 주문을 마저 끝냈다. */
  | 'completed'
  /** **뒤로** — 매입 없이 남은 승인을 취소했다. */
  | 'canceled'
  /**
   * 취소하려던 사이에 사람이 돌아와 매입이 끝났다.
   *
   * **좋은 결과다.** 되감을 이유가 사라진 것이고, 그래서
   * `PaymentService.cancelAuthorization` 이 조용히 아무것도 하지 않는다.
   */
  | 'overtaken'
  /** 한 건이 던졌다. 이 건은 다음 주기로 넘어간다. */
  | 'failed'

/** 한 주기가 무엇을 만났나. 이름은 {@link StragglerOutcome} 과 같다. */
export interface StragglerTally {
  readonly completed: number
  readonly canceled: number
  readonly overtaken: number
  readonly failed: number
}

/** 아무것도 만나지 않은 주기. 건너뛴 주기의 값이기도 하다. */
export const NOTHING_STRANDED: StragglerTally = {
  completed: 0,
  canceled: 0,
  overtaken: 0,
  failed: 0,
}

/**
 * 이 시각보다 앞서 매입된 것만 마저 끝낸다 ({@link STRAGGLER_COMPLETE_GRACE_MS}).
 *
 * 유예가 있는 이유는 정상 결제가 반드시 이 창을 지나기 때문이다 — 위 상수에
 * 적었다.
 */
export function capturedBefore(now: Date, graceMs: number = STRAGGLER_COMPLETE_GRACE_MS): Date {
  return new Date(now.getTime() - graceMs)
}

/**
 * 이 시각보다 앞서 승인된 것만 취소 후보다 ({@link STRAGGLER_ABANDONED_AFTER_MS}).
 *
 * **후보일 뿐이다.** 두 번째 조건 — 그 주문에 살아 있는 예약이 없다 — 은 시각이
 * 아니라 예약 표가 답하고, 둘은 반드시 **AND** 로 본다 (R1 · D-221).
 */
export function abandonedBefore(now: Date, afterMs: number = STRAGGLER_ABANDONED_AFTER_MS): Date {
  return new Date(now.getTime() - afterMs)
}

/**
 * 결과 하나를 센다.
 *
 * 이름을 {@link StragglerTally} 의 칸 이름과 같게 맞춰 둔 덕분에 분기가 없다.
 * `switch` 로 적으면 결과가 하나 늘 때 기본 갈래가 그것을 조용히 삼키는데, 이
 * 배치에서 「세지 않은 결과」는 곧 **헬스체크가 못 보는 상태**다
 * (`payment-reconcile.ts` 의 `counted` 와 같은 이유다).
 */
export function counted(tally: StragglerTally, outcome: StragglerOutcome): StragglerTally {
  return { ...tally, [outcome]: tally[outcome] + 1 }
}

/**
 * 이 주기가 실제로 **고친** 건수. `AppMeta` 와 헬스체크에 실리는 숫자다.
 *
 * `overtaken` 과 `failed` 는 빠진다. 앞은 고친 것이 우리가 아니라 돌아온 사람이고,
 * 뒤는 아직 안 고친 것이다 — 둘을 더하면 「배치가 몇 건을 끝냈나」라는 물음에
 * 사람이 한 일과 못 한 일이 섞여 들어온다.
 */
export function fixedCount(tally: StragglerTally): number {
  return tally.completed + tally.canceled
}

/**
 * 이 주기를 로그로 남길 것인가.
 *
 * **`overtaken` 만 있는 주기는 남기지 않는다.** 사람이 돌아와 결제를 마친 것은
 * 배치가 고칠 것이 없는 사실이고, 1분마다 그것을 한 줄씩 쌓으면 정작 읽어야 할
 * 줄 — 승인 하나를 취소했고 주문 하나를 마저 끝냈다 — 이 그 사이에 묻힌다.
 * `payment-reconcile.ts` 의 같은 판단과 같은 이유다.
 */
export function worthLogging(tally: StragglerTally): boolean {
  return fixedCount(tally) > 0 || tally.failed > 0
}

/**
 * 마지막 실행이 너무 오래됐는가.
 *
 * 판단은 스위퍼의 {@link isStale} 을 그대로 쓴다 — 「한 번도 안 돌았으면
 * stale」이라는 해석까지 같아야 하고, 그것을 여기서 다시 정하면 세 헬스 지표가
 * 조용히 다른 말을 하게 된다. 다른 것은 임계치뿐이다.
 */
export function isStragglerStale(lastRunAt: Date | null, now: Date): boolean {
  return isStale(lastRunAt, now, STRAGGLER_STALE_AFTER_MS)
}
