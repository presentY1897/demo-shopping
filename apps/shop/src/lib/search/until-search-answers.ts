import { apiFailure, hasCode } from '@shopping/shared'

import { sleep } from '@/lib/wake'
import type { WakePolicy } from '@/lib/wake-policy'
import { backoffFor } from '@/lib/wake-policy'

/**
 * Asks a search route again while the API says its engine cannot be reached
 * (TASK-0143 4.3).
 *
 * `SEARCH_UNAVAILABLE` is a state that passes: the engine is a separate free
 * service that sleeps and restarts on its own, and the search that was just
 * refused is itself the request that reached its gateway and started it (4.2).
 * So the screen asks again rather than telling the visitor to.
 *
 * **The wake-up's policy, not one of its own** — the same wall-clock budget,
 * the same backoff, and therefore the same ceiling of 21 requests
 * (TASK-0118 4.5). This is the results screen's counterpart of the home gate's
 * loop: that screen has no gate, so the search is what it retries.
 *
 * **Only that code.** Any other failure is thrown at once, as it always was: a
 * 500 is a fault and a dead network is not something the engine's schedule
 * fixes. When the budget ends the last refusal is thrown too, and the caller
 * draws the failure it already knows how to draw.
 *
 * An aborted wait rethrows as well; every caller already drops whatever arrives
 * after its own abort.
 */
export async function untilSearchAnswers<T>(
  policy: WakePolicy,
  signal: AbortSignal,
  ask: () => Promise<T>,
  /** Called before each wait, so the screen can say 「준비 중」 instead of nothing. */
  onPreparing: () => void,
): Promise<T> {
  // The monotonic clock, for the reason `wakeApi` gives.
  const startedAt = performance.now()

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await ask()
    } catch (error) {
      if (signal.aborted || !hasCode(apiFailure(error), 'SEARCH_UNAVAILABLE')) throw error

      const backoffMs = backoffFor(policy, attempt)
      if (performance.now() - startedAt + backoffMs >= policy.budgetMs) throw error

      onPreparing()
      await sleep(backoffMs, signal)
      if (signal.aborted) throw error
    }
  }
}
