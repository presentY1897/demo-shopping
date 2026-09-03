/**
 * Helpers for the tests that have to make two requests actually compete.
 *
 * QUALITY-GATES A7 asks every endpoint touching a balance, a stock level, an
 * ordering or an idempotency key to be tested under concurrent calls. The
 * assertion "only one of them succeeded" is worthless on its own, though: it
 * passes just as happily when the two calls never overlapped. {@link barrier} is
 * what removes that ambiguity — it holds every participant until the last one
 * arrives, so the overlap is arranged by the test rather than hoped for.
 */

/** Starts `count` copies of `task` at once and waits for all of them to settle. */
export function concurrently<T>(
  count: number,
  task: (index: number) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(Array.from({ length: count }, (_unused, index) => task(index)))
}

/** Narrowing helpers: `.status === 'fulfilled'` alone leaves `value` as `any`. */
function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled'
}

export function fulfilled<T>(results: readonly PromiseSettledResult<T>[]): T[] {
  return results.filter(isFulfilled).map((result) => result.value)
}

export function rejected<T>(results: readonly PromiseSettledResult<T>[]): unknown[] {
  return results.filter((result) => !isFulfilled(result)).map((result) => result.reason as unknown)
}

/** Blocks each caller until `parties` of them have arrived. */
export interface Barrier {
  arrive: () => Promise<void>
}

/**
 * A rendezvous point for `parties` concurrent callers.
 *
 * Used to pin down the interleaving a race needs: every participant reads,
 * everyone waits at the barrier, and only then does anyone write. Without it the
 * two halves might not overlap on a given run and the spec would be flaky in the
 * worst possible direction — green when the code is broken.
 */
export function barrier(parties: number): Barrier {
  let waiting = 0
  let release: () => void = () => undefined

  const opened = new Promise<void>((resolve) => {
    release = resolve
  })

  return {
    arrive(): Promise<void> {
      waiting += 1
      if (waiting >= parties) release()

      return opened
    },
  }
}
