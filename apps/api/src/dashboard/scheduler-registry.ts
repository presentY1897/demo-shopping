import { CLAIM_REFUND_LAST_RUN_KEY, CLAIM_REFUND_STALE_AFTER_MS } from '../claims/refund-retry.js'
import {
  COUPON_EXPIRY_LAST_RUN_KEY,
  COUPON_EXPIRY_STALE_AFTER_MS,
} from '../coupons/coupon-expiry.js'
import { DEMO_CLEANUP_LAST_RUN_KEY, DEMO_CLEANUP_STALE_AFTER_MS } from '../demo/demo-cleanup.js'
import { CONFIRM_LAST_RUN_KEY, CONFIRM_STALE_AFTER_MS } from '../orders/order-confirm.js'
import { RECONCILE_LAST_RUN_KEY, RECONCILE_STALE_AFTER_MS } from '../payment/payment-reconcile.js'
import { STRAGGLER_LAST_RUN_KEY, STRAGGLER_STALE_AFTER_MS } from '../payment/payment-straggler.js'
import { POINT_EXPIRY_LAST_RUN_KEY, POINT_EXPIRY_STALE_AFTER_MS } from '../points/point-expiry.js'
import { SWEEP_LAST_RUN_KEY, SWEEP_STALE_AFTER_MS } from '../reservation/reservation-sweeper.js'
import {
  SETTLEMENT_LAST_RUN_KEY,
  SETTLEMENT_STALE_AFTER_MS,
} from '../settlement/settlement-batch.js'
import { DELIVERY_LAST_RUN_KEY, DELIVERY_STALE_AFTER_MS } from '../shipping/delivery-simulator.js'

/**
 * 대시보드가 지켜보는 배치들 (TASK-0092 F4).
 *
 * ## 임계치를 여기서 정하지 않는다
 *
 * 줄마다 `staleAfterMs` 가 **그 배치의 모듈에서 온다.** 여기서 다시 정하면 같은
 * 배치에 대해 「멈췄다」의 뜻이 두 개가 되고, `/health` 는 초록인데 대시보드는 빨간
 * (또는 그 반대) 화면이 나온다 — 그리고 둘 중 어느 쪽이 맞는지 아무도 모른다. 주기를
 * 바꾸는 사람은 자기 모듈만 고치면 되고, 그 변경이 여기까지 따라온다.
 *
 * ## 이 목록이 빠짐없는지는 검사가 지킨다
 *
 * 배치를 하나 더 만들고 여기 안 적으면 **대시보드는 멀쩡히 그려진다** — 그냥 그
 * 배치만 아무도 안 보는 상태가 되고, 그것이 정확히 이 화면이 막으려던 일이다.
 * `scheduler-registry.spec.ts` 가 소스에서 `_LAST_RUN_KEY` 를 세어 견준다.
 */
export interface SchedulerEntry {
  /** 화면이 이름을 붙일 때 쓰는 열쇠. `AppMeta` 의 열쇠와 같다. */
  readonly key: string
  readonly staleAfterMs: number
}

export const SCHEDULERS: readonly SchedulerEntry[] = [
  { key: SWEEP_LAST_RUN_KEY, staleAfterMs: SWEEP_STALE_AFTER_MS },
  { key: CONFIRM_LAST_RUN_KEY, staleAfterMs: CONFIRM_STALE_AFTER_MS },
  { key: DELIVERY_LAST_RUN_KEY, staleAfterMs: DELIVERY_STALE_AFTER_MS },
  { key: RECONCILE_LAST_RUN_KEY, staleAfterMs: RECONCILE_STALE_AFTER_MS },
  { key: STRAGGLER_LAST_RUN_KEY, staleAfterMs: STRAGGLER_STALE_AFTER_MS },
  { key: SETTLEMENT_LAST_RUN_KEY, staleAfterMs: SETTLEMENT_STALE_AFTER_MS },
  { key: CLAIM_REFUND_LAST_RUN_KEY, staleAfterMs: CLAIM_REFUND_STALE_AFTER_MS },
  { key: POINT_EXPIRY_LAST_RUN_KEY, staleAfterMs: POINT_EXPIRY_STALE_AFTER_MS },
  { key: COUPON_EXPIRY_LAST_RUN_KEY, staleAfterMs: COUPON_EXPIRY_STALE_AFTER_MS },
  { key: DEMO_CLEANUP_LAST_RUN_KEY, staleAfterMs: DEMO_CLEANUP_STALE_AFTER_MS },
]

/**
 * 배치 하나의 상태 (`schedulerStatusSchema`).
 *
 * `never` 와 `stale` 을 가르는 것이 요점이다. 한 번도 안 돈 것은 **갓 뜬 프로세스의
 * 정상 상태**이고, 돌다가 멈춘 것은 사고다 — 둘을 같은 색으로 칠하면 배포 직후마다
 * 빨간 화면을 보게 되고, 그것이 몇 번 반복되면 사람은 그 색을 안 믿는다.
 *
 * `/health` 는 둘을 합쳐 `degraded` 로 답한다. 거기서는 그것이 맞다 — 로드밸런서에게
 * 「아직 안 돌았다」와 「멈췄다」는 같은 뜻이다. 사람에게는 다르다.
 */
export function statusOf(
  lastRunAt: Date | null,
  now: Date,
  staleAfterMs: number,
): 'ok' | 'stale' | 'never' {
  if (lastRunAt === null) return 'never'

  return now.getTime() - lastRunAt.getTime() > staleAfterMs ? 'stale' : 'ok'
}
