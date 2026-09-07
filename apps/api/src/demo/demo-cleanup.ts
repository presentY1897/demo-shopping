/**
 * The `AppMeta` key the sweep records its last run under.
 *
 * A row rather than a field on a service, so that the answer survives a restart
 * and is the same for every instance. `/health` reads it (F5), and "the
 * scheduler has stopped" is a timestamp that stopped moving.
 */
export const DEMO_CLEANUP_LAST_RUN_KEY = 'demo.cleanup.lastRunAt'

/** How often the sweep runs. */
export const DEMO_CLEANUP_INTERVAL_MS = 15 * 60_000

/**
 * 마지막 스윕이 **무엇을 했는지** (TASK-0096 F3).
 *
 * 시각만으로는 「돌았다」까지만 말할 수 있다. 0건을 집고 돌아온 주기와 50건을 집은
 * 주기가 화면에서 같아 보이면, 운영자는 정리가 밀리고 있는 것을 알 수 없다 — 시각은
 * 계속 갱신되기 때문이다.
 *
 * 별도 표를 만들지 않는 이유는 **마지막 한 번만 뜻이 있어서**다. 지난 주기들의 건수는
 * 그것으로 할 일이 없고, 쌓으면 지우는 일이 하나 더 생긴다.
 */
export const DEMO_CLEANUP_LAST_REPORT_KEY = 'demo.cleanup.lastReport'

/**
 * 이보다 오래 안 돌았으면 멈춘 것으로 본다 (TASK-0092 F4).
 *
 * 다른 아홉 배치와 같은 5주기다. `/health` 는 이 판정을 하지 않고 시각만 내보내
 * 읽는 쪽에 맡겼는데(`health.ts` 의 `demoCleanup` 주석), **이제 그 읽는 쪽이
 * 생겼다** — 관리자 대시보드다. 판정을 그쪽에 두면 배치의 주기를 바꾼 사람이 고쳐야
 * 할 자리가 다른 파일에 생기므로, 주기 바로 옆에 둔다.
 */
export const DEMO_CLEANUP_STALE_AFTER_MS = 5 * DEMO_CLEANUP_INTERVAL_MS

/**
 * How many accounts one sweep collects (R2).
 *
 * A cap rather than "all of them": a demo that went viral overnight would
 * otherwise put a thousand transactions into one tick, and the failure mode of
 * that is the API being unresponsive while it works — on the free instance,
 * indistinguishable from being down. What is left over is collected by the next
 * tick fifteen minutes later, which for expired demo data is soon enough.
 */
export const DEMO_CLEANUP_BATCH = 50

/** Why a demo store is suspended rather than deleted. */
export const DEMO_CLEANUP_REASON = '데모 계정이 만료되어 스토어를 닫았습니다.'

/** What one sweep did. */
export interface DemoCleanupReport {
  readonly swept: number
  /** Accounts whose transaction failed. They stay expired and are retried (F6). */
  readonly failed: number
  readonly at: Date
}
