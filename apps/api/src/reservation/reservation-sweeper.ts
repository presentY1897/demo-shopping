/**
 * 만료 청소의 순수 판단과 상수 (TASK-0051).
 *
 * **이 스케줄러가 멈추면 재고가 잠긴다.** 잡아 둔 재고가 영영 풀리지 않고, 아무도
 * 그것을 살 수 없으며, **아무것도 실패하지 않는다.** 그 침묵이 이 파일이 지키는
 * 것이고, 헬스체크가 그것을 볼 수 있는 유일한 자리다(F5 · F6 · R1).
 */

/** 한 번에 푸는 예약의 수. 나머지는 다음 주기가 가져간다. */
export const SWEEP_BATCH_LIMIT = 200

/** 도는 주기. 「만료된 예약이 1분 내 해제된다」가 요구사항이다. */
export const SWEEP_INTERVAL_MS = 60_000

/**
 * 이보다 오래 안 돌았으면 degraded 다.
 *
 * 주기의 다섯 배다. 한 번 걸러 뛰는 것은 재시작이나 배포로도 일어나므로 그것까지
 * 알람으로 만들면 아무도 알람을 안 보게 된다. 다섯 번 연속으로 못 돌았다면 그것은
 * 더 이상 우연이 아니다.
 */
export const SWEEP_STALE_AFTER_MS = 5 * SWEEP_INTERVAL_MS

export const SWEEP_LAST_RUN_KEY = 'reservation.sweep.lastRunAt'
export const SWEEP_LAST_RELEASED_KEY = 'reservation.sweep.lastReleased'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * 임의의 수가 아니라 **문자열에서 만든다** — 두 기능이 우연히 같은 수를 고르면 둘
 * 중 하나가 영문 모른 채 건너뛰고, 그 증상은 「가끔 안 돈다」다.
 */
export const SWEEP_LOCK_KEY = lockKeyOf('reservation.sweep')

/**
 * 문자열을 64비트 락 열쇠로.
 *
 * FNV-1a 32비트다. 암호학적 성질이 필요 없고 — 필요한 것은 **다른 문자열이 다른
 * 수가 되는 것**뿐이다 — 32비트면 이 저장소가 가질 잡의 수에 대해 충분히 넓다.
 */
export function lockKeyOf(name: string): number {
  let hash = 0x811c9dc5

  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  // `>>> 0` 로 부호를 뗀다. Postgres 의 `bigint` 에 음수를 넘겨도 되지만, 로그에
  // 찍힌 음수 열쇠는 읽는 사람에게 아무 뜻이 없다.
  return hash >>> 0
}

/**
 * 마지막 실행이 너무 오래됐는가.
 *
 * **한 번도 안 돌았으면 stale 이다.** 「아직 안 돌았을 뿐」과 「멈췄다」를 밖에서
 * 구분할 방법이 없고, 둘 중 안전한 해석은 멈췄다는 쪽이다 — 부팅 직후의 한 주기
 * 동안 degraded 로 보이는 것이 잠긴 재고를 못 보는 것보다 낫다.
 */
export function isStale(
  lastRunAt: Date | null,
  now: Date,
  staleAfterMs: number = SWEEP_STALE_AFTER_MS,
): boolean {
  if (lastRunAt === null) return true

  return now.getTime() - lastRunAt.getTime() > staleAfterMs
}
