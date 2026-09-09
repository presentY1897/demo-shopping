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
   * Deadline for **one** attempt.
   *
   * One value rather than a rising list, because the list existed only to make
   * the deadlines *sum* to the budget — and {@link WakePolicy.budgetMs} now says
   * that directly. What is left is the question a single attempt asks, and the
   * answer has to be long enough to sit through a spin-up in case the platform
   * holds the request open rather than refusing it (TASK-0118 4.4).
   */
  readonly attemptTimeoutMs: number
  /**
   * How long the app keeps trying, measured on the **wall clock**.
   *
   * **Not a count of attempts.** A refusal comes back in about 0.3 seconds, so
   * three attempts budgeted by count are spent in under four — while the
   * instance behind them needs a minute and a half. Counting elapsed time
   * instead means a fast failure costs the budget nothing, which is the correct
   * response to a platform that says "not yet" quickly (TASK-0118 4.3).
   */
  readonly budgetMs: number
  /**
   * Wait before each retry, in order. **The last value repeats.**
   *
   * Repeating the last entry is what caps the wait: without a ceiling an
   * exponential schedule eventually sleeps past the moment the instance came up,
   * and the visitor is left looking at a finished boot.
   */
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
  // Long enough to ride out a spin-up if the platform holds the request rather
  // than refusing it. Against a refusal it never comes into play.
  attemptTimeoutMs: 90_000,
  // 150s against a measured boot of about 90s. The old policy computed 143s the
  // same way and never spent it (4.3).
  budgetMs: 150_000,
  // 1 → 2 → 4 → 8, then 8 forever. The ceiling is the time a visitor can spend
  // *after* the instance is already up without knowing it: 8s on a 90s wait is
  // 9%, and it is the stretch where the progress bar sits still (4.5).
  backoffMs: [1_000, 2_000, 4_000, 8_000],
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

/** The wait before retry `attempt`; the schedule's last entry repeats. */
export function backoffFor(policy: WakePolicy, attempt: number): number {
  const index = Math.min(attempt - 1, policy.backoffMs.length - 1)

  return policy.backoffMs[index] ?? 0
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
