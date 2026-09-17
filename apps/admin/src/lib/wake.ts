import type { HealthResult } from './health'
import { loadHealth } from './health'
import type { WakePolicy } from './wake-policy'
import { backoffFor } from './wake-policy'

/** Told which attempt is starting, so the screen can show progress. */
export type WakeAttemptListener = (attempt: number) => void

/**
 * Told each time the API answers and says its search engine is not ready.
 *
 * **Handing one to {@link wakeApi} is what makes it wait for search.** The two
 * are one argument because they are one decision: a screen that is nothing
 * without search — the storefront — needs the loop to keep asking *and* needs
 * to hear about the answers in between, so it can say 「준비 중」 rather than
 * look stuck. A console reads `search` off the final answer and draws its own
 * panel for it; it passes nothing and the loop stops where it always has.
 */
export type SearchPendingListener = (result: HealthResult) => void

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

/**
 * @param waitsForSearch Whether an API that is up beside an engine that is not
 *   counts as "not yet". The engine is a separate free service that sleeps and
 *   restarts on its own, so that answer is a state that passes — the same kind
 *   of thing as a 502 from a booting instance, and worth the same patience
 *   (TASK-0143 4.3).
 */
function isWorthRetrying(result: HealthResult, waitsForSearch: boolean): boolean {
  if (result.ok) return waitsForSearch && result.response.search !== 'ok'

  return !FINAL_REASONS.some((reason) => reason === result.reason)
}

/**
 * Resolves after `ms`, or as soon as `signal` aborts — it never rejects.
 *
 * Exported because it is **the one timer a retry in this app is allowed**: the
 * storefront's search results wait out an unreachable engine on the same
 * schedule, and a second way of sleeping would be a second place for a timer to
 * outlive its screen (TASK-0143 4.3).
 */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
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
 * **Waiting for search spends the same budget, not a second one.** With
 * `onSearchPending` the loop treats `ok` with `search` not `"ok"` as one more
 * "not yet": same clock, same backoff, and therefore the same ceiling on
 * requests. If the budget ends first, what comes back is that last answer —
 * `ok: true` with search still pending — and the caller decides what to say.
 *
 * Never throws; a failure is the returned value.
 */
export async function wakeApi(
  policy: WakePolicy,
  signal: AbortSignal,
  onAttempt: WakeAttemptListener,
  onSearchPending?: SearchPendingListener,
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
    if (!isWorthRetrying(result, onSearchPending !== undefined)) return result

    // Said before the wait rather than after it: the screen has the whole
    // backoff to show that the API is up and only search is outstanding.
    if (result.ok) onSearchPending?.(result)

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
