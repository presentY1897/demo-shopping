import type { HealthResult } from './health'
import { loadHealth } from './health'
import type { WakePolicy } from './wake-policy'
import { backoffFor } from './wake-policy'

/** Told which attempt is starting, so the screen can show progress. */
export type WakeAttemptListener = (attempt: number) => void

/**
 * Failures another attempt cannot fix, so retrying is only spending free
 * instance hours on a foregone conclusion (TASK-0009 R8).
 *
 * - `configuration` — this build has no API address; the next attempt reads the
 *   same missing value
 * - `aborted` — the visitor left, or the component unmounted
 * - `malformed_response` — the API answered, and its body does not match the
 *   contract. The same request produces the same wrong body; this is a
 *   deployment mismatch, not a cold instance
 *
 * `network`, `timeout` and `http` are all retried. A booting Render instance
 * produces every one of them, 502 included, on its way up.
 */
const FINAL_REASONS = ['configuration', 'aborted', 'malformed_response'] as const

function isWorthRetrying(result: HealthResult): boolean {
  return !result.ok && !FINAL_REASONS.some((reason) => reason === result.reason)
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)

    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }

    signal.addEventListener('abort', finish)
  })
}

/**
 * Wakes the API and returns what it eventually said.
 *
 * **The wake-up and the data request are the same call.** A separate "prewarm
 * ping" would double the requests and therefore the instance hours the free
 * plan bills, for nothing — one request wakes the instance and brings back the
 * payload (TASK-0101 4.3). It also reaches the search engine, because the API
 * probes it while answering (4.6).
 *
 * Never throws; a failure is the returned value.
 */
export async function wakeApi(
  policy: WakePolicy,
  signal: AbortSignal,
  onAttempt: WakeAttemptListener,
): Promise<HealthResult> {
  // **`performance.now()`, not `Date.now()`.** A budget of elapsed time has to be
  // read off a clock that only measures elapsed time. The system clock gets
  // corrected while the loop runs — stepped back 1.7s every half minute on the
  // machine that replayed this (TASK-0118 6.3) — and every correction would
  // lengthen or shorten a budget counted on it.
  const startedAt = performance.now()
  // Assigned on the first pass, before anything can read it. Declaring it
  // without a value says that: an initialiser here would be dead code standing
  // in for a state this function never has.
  let result: HealthResult

  for (let attempt = 1; ; attempt += 1) {
    onAttempt(attempt)

    result = await loadHealth({ timeoutMs: policy.attemptTimeoutMs, signal })
    if (!isWorthRetrying(result)) return result

    // **The budget is spent in wall-clock time, not in attempts.** A refusal
    // that comes back in 0.3s costs the budget 0.3s, so a platform that says
    // "not yet" quickly gets asked again rather than exhausting the policy —
    // which is what a booting instance needs (TASK-0118 4.4).
    const backoffMs = backoffFor(policy, attempt)
    if (performance.now() - startedAt + backoffMs >= policy.budgetMs) break

    await sleep(backoffMs, signal)
    if (signal.aborted) return { ok: false, endpoint: result.endpoint, reason: 'aborted' }
  }

  return result
}
