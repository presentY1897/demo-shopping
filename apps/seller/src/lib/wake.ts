import type { HealthResult } from './health'
import { loadHealth } from './health'
import type { WakePolicy } from './wake-policy'

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
  let result: HealthResult = { ok: false, endpoint: '', reason: 'unknown' }

  for (const [index, timeoutMs] of policy.attemptTimeoutsMs.entries()) {
    onAttempt(index + 1)

    result = await loadHealth({ timeoutMs, signal })
    if (!isWorthRetrying(result)) return result

    const backoffMs = policy.backoffMs[index]
    if (backoffMs === undefined) break

    await sleep(backoffMs, signal)
    if (signal.aborted) return { ok: false, endpoint: result.endpoint, reason: 'aborted' }
  }

  return result
}
