/**
 * How long the app is willing to wait for a sleeping API, and when it starts
 * explaining the wait.
 *
 * Every number here answers a measurement rather than a preference. The deployed
 * API sleeps after 15 minutes of inactivity and takes **about 90 seconds** to
 * answer the first request after that; awake, the same call is **0.35 seconds**
 * (TASK-0101 4.1). There is almost nothing in between, which is what shapes the
 * thresholds below.
 *
 * The values live in one exported object so a test can hand the same machinery
 * millisecond thresholds and reproduce a 90 second sequence in a fraction of a
 * second. What the real numbers are is pinned by asserting on this constant
 * directly — a check no slow machine can make pass.
 */
export interface WakePolicy {
  /**
   * Deadline for each attempt, in order. Its length is the attempt count.
   *
   * The deadlines grow. Render holds a request aimed at a sleeping instance open
   * until the instance answers, so the first attempt is only asking "is it awake
   * but slow?", and the last one sits through a full spin-up.
   */
  readonly attemptTimeoutsMs: readonly number[]
  /** Wait before attempt n+1. Exponential, and one shorter than the attempts. */
  readonly backoffMs: readonly number[]
  /** When the wait stops looking like a normal load and gets a notice. */
  readonly noticeAfterMs: number
  /** When the notice admits how long this can take. */
  readonly longWaitNoticeAfterMs: number
  /** Measured cold start. Drives the progress indicator, nothing else. */
  readonly expectedColdStartMs: number
  /** How often the elapsed counter is refreshed while waiting. */
  readonly tickMs: number
  /**
   * Waits before each automatic re-check of a search engine that is not ready.
   *
   * Its length is the budget: once spent, the screen stops asking and offers a
   * button. There is no interval anywhere in this app, because an interval is
   * how a free plan's 750 shared instance hours disappear (TASK-0009 R8).
   */
  readonly searchRecheckDelaysMs: readonly number[]
  /** Deadline for one re-check. The API is awake by then, so it is short. */
  readonly searchRecheckTimeoutMs: number
}

export const WAKE_POLICY: WakePolicy = {
  // 10s catches "awake but slow". 40s and 90s sit through the spin-up; with the
  // backoffs the budget totals 143s, 60% above the measured 90s.
  attemptTimeoutsMs: [10_000, 40_000, 90_000],
  backoffMs: [1_000, 2_000],
  noticeAfterMs: 3_000,
  // Past 3s it is almost certainly a cold start, but saying "up to two minutes"
  // that early invents a problem for someone whose network merely hiccuped.
  longWaitNoticeAfterMs: 15_000,
  expectedColdStartMs: 90_000,
  tickMs: 250,
  searchRecheckDelaysMs: [5_000, 15_000, 30_000],
  searchRecheckTimeoutMs: 10_000,
}

/** How much the visitor is being told, as one value the markup can switch on. */
export type WakeNoticeLevel = 'none' | 'waking' | 'cold'

export function wakeNoticeLevel(policy: WakePolicy, elapsedMs: number): WakeNoticeLevel {
  if (elapsedMs >= policy.longWaitNoticeAfterMs) return 'cold'
  if (elapsedMs >= policy.noticeAfterMs) return 'waking'

  return 'none'
}

/**
 * Progress towards the expected cold start, as a percentage.
 *
 * Capped below 100: the bar must never claim to be finished while the screen is
 * still waiting, and a wake-up that runs long is exactly when a full bar would
 * read as "stuck" rather than "nearly there".
 */
export function wakeProgress(policy: WakePolicy, elapsedMs: number): number {
  const ratio = elapsedMs / policy.expectedColdStartMs

  return Math.max(0, Math.min(95, Math.round(ratio * 100)))
}

/** Whole seconds, for a counter that has to look like it is moving. */
export function elapsedSeconds(elapsedMs: number): number {
  return Math.floor(elapsedMs / 1000)
}
