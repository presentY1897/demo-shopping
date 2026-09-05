import { isStale, lockKeyOf } from '../reservation/reservation-sweeper.js'
import type { RecoveryOutcome } from './payment.service.js'

/**
 * 대사 배치의 순수 판단과 상수 (TASK-0056 F6 · F9 · D-220).
 *
 * **이 배치가 멈추면 사람이 갇힌다.** `UNRESOLVED` 는 나가는 길을 대사에게만
 * 열어 뒀고(D-220), 그동안 그 주문에는 새 결제를 시작할 수 없다
 * (`PaymentService.assertNothingUnresolved`). 즉 배치가 안 돌면 카드에서 돈이
 * 빠졌는지도 모르는 채로, 다시 결제할 수도 없는 사람이 남는다 — 그리고
 * **아무것도 실패하지 않는다.** 그 침묵을 밖으로 꺼낼 자리가 헬스체크이고, 이
 * 파일이 그 판단을 쥔다.
 *
 * 예약 만료 청소기와 구조가 같은 것은 우연이 아니다
 * (`reservation/reservation-sweeper.ts`). 다른 것은 **한 건의 값**이다: 저쪽은
 * 한 건이 `UPDATE` 한 줄이고, 여기서 한 건은 **남의 서버와의 왕복**이다. 아래
 * 숫자들은 전부 그 차이에서 나온다.
 */

/**
 * 한 주기가 물어볼 결제의 수. 나머지는 다음 주기가 가져간다.
 *
 * **스위퍼의 200 을 그대로 쓰지 않는다.** 저쪽에서 한 건은 트랜잭션 안의 `UPDATE`
 * 한 줄이라 200건도 밀리초로 끝나지만, 여기서 한 건은 결제사에 물어보는 왕복이고
 * 그것도 **하나씩 차례로** 한다. 저쪽이 죽은 날에는 한 건이 `toss.client.ts` 의
 * 마감 15초를 통째로 쓴다.
 *
 * 그래서 상한은 「최악의 한 주기가 얼마나 걸려도 되는가」로 정한다. 10건 × 15초 =
 * 150초이고, 이것은 {@link RECONCILE_STALE_AFTER_MS}(5분)보다 넉넉히 짧다 — 넘겨
 * 잡으면 **일하느라 늦은 배치를 헬스체크가 「멈췄다」로 읽는다.** 200 을 그대로
 * 썼다면 최악의 한 주기가 50분이고, 그 50분은 재시작 한 번에 통째로 사라진다.
 *
 * 반대쪽 걱정 — 「밀린 것이 안 줄어든다」 — 은 이 상태의 성질이 막아 준다.
 * `UNRESOLVED` 는 결제사에 닿지 못했을 때만 생기므로 평소에는 0건이고, 저쪽이
 * 10분 죽어 100건이 쌓여도 10주기, 10분이면 사라진다.
 */
export const RECONCILE_BATCH_LIMIT = 10

/**
 * 도는 주기. 스위퍼와 같은 1분이지만 이유가 다르다.
 *
 * 저쪽은 「만료된 예약이 1분 내 해제된다」가 요구사항이라서고, 여기서는 **사람이
 * 기다리는 시간**이기 때문이다 — 결과를 모르는 결제 하나가 그 주문의 다음 결제를
 * 막고 있으므로, 주기가 곧 그 사람이 화면 앞에서 막혀 있는 시간의 단위다.
 */
export const RECONCILE_INTERVAL_MS = 60_000

/**
 * 끊긴 지 이만큼 지난 건만 묻는다.
 *
 * **막 끊긴 건을 바로 물어봐야 얻는 답은 `pending` 뿐이다.** 우리 요청은 이미
 * 15초(`toss.client.ts` 의 `REQUEST_TIMEOUT_MS`)를 기다리다 끊긴 것이고, 저쪽의
 * 카드 승인은 그 뒤로도 진행 중일 수 있다. 그때 묻는 것은 호출 한 번을 쓰고
 * 아무것도 배우지 않는 일이다 (R2 — 「대사 배치가 과도한 API 호출」).
 *
 * 반대쪽 비용은 사람이다. 유예 동안 그 사람은 다시 결제할 수 없으므로 유예를
 * 길게 잡을수록 「확인 중」 화면 앞에 오래 서 있게 된다. 그래서 **마감의 네 배이자
 * 주기와 같은 1분**으로 둔다 — 한 주기 늦게 묻는 대신 그 한 번은 대개 답이 있는
 * 물음이 되고, 사람이 막혀 있는 시간은 최악에도 유예 + 주기, 2분이다.
 */
export const RECONCILE_GRACE_MS = 60_000

/**
 * 이보다 오래 안 돌았으면 degraded 다.
 *
 * 주기의 다섯 배. 근거는 `reservation-sweeper.ts` 의 같은 상수와 같다 — 한 번
 * 걸러 뛰는 것은 재시작이나 배포로도 일어나고, 그것까지 알람으로 만들면 아무도
 * 알람을 안 본다.
 */
export const RECONCILE_STALE_AFTER_MS = 5 * RECONCILE_INTERVAL_MS

export const RECONCILE_LAST_RUN_KEY = 'payment.reconcile.lastRunAt'
export const RECONCILE_LAST_RESOLVED_KEY = 'payment.reconcile.lastResolved'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * **스위퍼의 {@link lockKeyOf} 를 그대로 쓴다.** 그 함수가 있는 이유가 「두
 * 기능이 우연히 같은 수를 고르면 하나가 영문 모른 채 건너뛴다」이므로, 두 번째
 * 잡이 자기 해시를 따로 만들면 그 보증이 바로 깨진다 — 같은 함수에 다른
 * 문자열을 넣는 것이 곧 「다르다」의 증명이다.
 */
export const RECONCILE_LOCK_KEY = lockKeyOf('payment.reconcile')

/**
 * 대사가 한 건에서 얻는 답.
 *
 * `PaymentService.resolveUnresolved` 의 넷에 **「물어보지 못했다」를 하나 더한
 * 것**이다. 그 넷은 전부 저쪽의 답이지만 이것은 답이 아니라 사고이고, 배치가
 * 세는 이유도 다르다 — 나머지 넷이 늘어나는 것은 배치가 일하고 있다는 뜻이지만
 * 이것이 늘어나는 것은 배치가 **한 건에 걸려 있다**는 뜻이다.
 */
export type ReconcileOutcome = RecoveryOutcome | 'unreachable'

/** 한 주기가 무엇을 만났나. 이름은 {@link ReconcileOutcome} 과 같다. */
export interface ReconcileTally {
  /** 승인이 확인돼 매입까지 끝났다. */
  readonly settled: number
  /** 저쪽에도 없었다. 결제가 실패로 끝났다. */
  readonly failed: number
  /** 저쪽도 아직 모른다. **정상이다** — 다음 주기가 다시 묻는다. */
  readonly pending: number
  /** 웹훅이 먼저 일했다. **이것도 정상이다** — 멱등이 실제로 동작한 모양이다. */
  readonly noop: number
  /** 물어보다 던졌다. 이 한 건은 다음 주기로 넘어간다. */
  readonly unreachable: number
}

/** 아무것도 만나지 않은 주기. 건너뛴 주기의 값이기도 하다. */
export const NOTHING_RECONCILED: ReconcileTally = {
  settled: 0,
  failed: 0,
  pending: 0,
  noop: 0,
  unreachable: 0,
}

/**
 * 이 시각보다 앞서 `UNRESOLVED` 가 된 것만 묻는다 ({@link RECONCILE_GRACE_MS}).
 *
 * 기준 컬럼은 `Payment.updatedAt` 이다. `createdAt` 은 결제창을 열기 **전**의
 * 시각이라, 사람이 카드 정보를 넣는 몇 분이 유예에 먼저 소진돼 버린다 — 그러면
 * 유예를 둔 이유가 사라진다. 상태가 `UNRESOLVED` 인 동안 그 행을 건드리는 것은
 * 대사뿐이므로, 이 값은 곧 「승인이 끊긴 시각」이다.
 */
export function askableBefore(now: Date, graceMs: number = RECONCILE_GRACE_MS): Date {
  return new Date(now.getTime() - graceMs)
}

/**
 * 답 하나를 센다.
 *
 * 이름을 {@link ReconcileTally} 의 칸 이름과 같게 맞춰 둔 덕분에 분기가 없다.
 * `switch` 로 적으면 답이 하나 늘 때 기본 갈래가 그것을 조용히 삼키는데, 이
 * 배치에서 「세지 않은 답」은 곧 **헬스체크가 못 보는 상태**다.
 */
export function counted(tally: ReconcileTally, outcome: ReconcileOutcome): ReconcileTally {
  return { ...tally, [outcome]: tally[outcome] + 1 }
}

/**
 * 이 주기가 실제로 **옮긴** 건수. `AppMeta` 와 헬스체크에 실리는 숫자다.
 *
 * `pending` 과 `noop` 은 빠진다. 앞은 상태가 그대로이니 옮긴 것이 없고, 뒤는
 * 옮긴 것이 우리가 아니다 — 둘을 더하면 「대사가 몇 건을 풀었나」라는 물음에
 * 웹훅이 한 일과 아무 일도 없던 주기가 섞여 들어온다.
 */
export function resolvedCount(tally: ReconcileTally): number {
  return tally.settled + tally.failed
}

/**
 * 이 주기를 로그로 남길 것인가.
 *
 * **`pending` 과 `noop` 만 있는 주기는 남기지 않는다.** 둘 다 정상이기 때문이다 —
 * 저쪽이 아직 처리 중인 것과 웹훅이 먼저 일한 것은 배치가 고칠 것이 없는 사실이다.
 * 1분마다 「0건 처리」를 한 줄씩 쌓으면 정작 읽어야 할 줄 — 승인 하나가 되살아났고
 * 하나는 실패로 끝났다 — 이 그 사이에 묻힌다. `PaymentEvent` 를 남기지 않는 것과
 * 같은 판단이고, 그쪽이 더 비싼 자리라 `resolveUnresolved` 가 먼저 그렇게 한다.
 */
export function worthLogging(tally: ReconcileTally): boolean {
  return resolvedCount(tally) > 0 || tally.unreachable > 0
}

/**
 * 마지막 대사가 너무 오래됐는가.
 *
 * 판단은 스위퍼의 {@link isStale} 을 그대로 쓴다 — 「한 번도 안 돌았으면
 * stale」이라는 해석까지 같아야 하고, 그것을 여기서 다시 정하면 두 헬스 지표가
 * 조용히 다른 말을 하게 된다. 다른 것은 임계치뿐이다.
 */
export function isReconcileStale(lastRunAt: Date | null, now: Date): boolean {
  return isStale(lastRunAt, now, RECONCILE_STALE_AFTER_MS)
}
