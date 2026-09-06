import { isStale, lockKeyOf } from '../reservation/reservation-sweeper.js'

/**
 * 만료 배치의 상수와 순수 판단 (TASK-0076 F8).
 *
 * **이 배치가 멈추면 아무것도 실패하지 않는다.** 기한이 지난 적립금이 계속 쓸 수
 * 있는 것처럼 잔액에 남고, 화면도 API 도 정상으로 보인다. 그 침묵이 예약 스위퍼와
 * 같은 종류의 위험이라 같은 장치를 쓴다 — 마지막 실행 시각을 `AppMeta` 에 적고,
 * 그것이 밖에서 보이는 유일한 자리다.
 *
 * **다른 점 하나: 쓰이는 것보다 만료가 늦어도 손해는 한 방향뿐이다.** 사용 경로가
 * 이미 `expiresAt > now` 인 통만 고르므로(`PointsService.liveLots`), 배치가 늦어서
 * 벌어지는 일은 「잔액에 죽은 돈이 잠깐 보인다」이지 「죽은 돈이 쓰인다」가 아니다.
 */

/** 한 주기가 처리할 계정의 수. 나머지는 다음 주기가 가져간다. */
export const POINT_EXPIRY_BATCH_LIMIT = 200

/**
 * 도는 주기.
 *
 * 유효기간이 날 단위이므로 분 단위 정확도가 필요 없다 — 그런데도 1분인 이유는
 * **다른 배치들과 같은 박자로 두기 위해서**다. 이 잡만 한 시간에 한 번 돌면
 * 헬스체크의 「너무 오래 안 돌았다」 임계치도 이 잡만 따로 정해야 하고, 그러면
 * 「배치가 멈췄다」의 뜻이 잡마다 달라진다.
 */
export const POINT_EXPIRY_INTERVAL_MS = 60_000

/**
 * 이보다 오래 안 돌았으면 degraded 다. 주기의 다섯 배 — 근거는
 * `reservation-sweeper.ts` 의 같은 상수와 같다.
 */
export const POINT_EXPIRY_STALE_AFTER_MS = 5 * POINT_EXPIRY_INTERVAL_MS

export const POINT_EXPIRY_LAST_RUN_KEY = 'point.expiry.lastRunAt'
export const POINT_EXPIRY_LAST_EXPIRED_KEY = 'point.expiry.lastExpired'

/**
 * 인스턴스 하나만 돌게 하는 어드바이저리 락의 열쇠.
 *
 * **스위퍼의 `lockKeyOf` 를 그대로 쓴다.** 그 함수가 있는 이유가 「두 기능이 우연히
 * 같은 수를 고르면 하나가 영문 모른 채 건너뛴다」이므로, 여섯 번째 잡이 자기 해시를
 * 따로 만들면 그 보증이 바로 깨진다.
 */
export const POINT_EXPIRY_LOCK_KEY = lockKeyOf('point.expiry')

/** 한 주기가 무엇을 만났나. */
export interface ExpiryTally {
  /** 실제로 닫은 통의 수. */
  readonly lots: number
  /** 그 통들이 없앤 금액의 합. */
  readonly amount: number
  /** 한 계정을 처리하다 던진 횟수. 그 계정은 다음 주기로 넘어간다. */
  readonly failed: number
}

export const NOTHING_EXPIRED: ExpiryTally = { lots: 0, amount: 0, failed: 0 }

/** 한 계정의 결과를 더한다. */
export function counted(
  tally: ExpiryTally,
  lots: readonly { readonly amount: number }[],
): ExpiryTally {
  return {
    ...tally,
    lots: tally.lots + lots.length,
    amount: tally.amount + lots.reduce((sum, lot) => sum + lot.amount, 0),
  }
}

/** 한 계정이 실패한 것을 센다. */
export function failed(tally: ExpiryTally): ExpiryTally {
  return { ...tally, failed: tally.failed + 1 }
}

/**
 * 이 주기를 로그로 남길 것인가.
 *
 * 아무것도 만료되지 않은 주기는 남기지 않는다. 대부분의 주기가 그렇고, 1분마다
 * 「0건」을 쌓으면 정작 읽어야 할 줄이 그 사이에 묻힌다
 * (`payment-reconcile.ts` · `order-confirm.ts` 의 같은 함수와 같은 판단).
 */
export function worthLogging(tally: ExpiryTally): boolean {
  return tally.lots > 0 || tally.failed > 0
}

/** 마지막 실행이 너무 오래됐는가. 판단은 스위퍼의 것을 그대로 쓴다. */
export function isExpiryStale(lastRunAt: Date | null, now: Date): boolean {
  return isStale(lastRunAt, now, POINT_EXPIRY_STALE_AFTER_MS)
}
