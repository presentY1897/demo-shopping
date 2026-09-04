/**
 * Counting the statements one request makes (gate A5).
 *
 * **Three performance specs had a copy of this, and all three had the same
 * bug.** The Prisma adapter emits its `query` events on a callback that runs
 * *after* the request has answered, so a measurement that cleared its array and
 * then waited a fixed 20ms was doing two hopeful things at once: assuming the
 * previous measurement's stragglers had already landed, and assuming its own
 * would land inside the window.
 *
 * Under the load of the whole suite neither held. `products-list-performance`
 * reported a slope of 1.83 or 2.17 instead of 2 and `products-performance`
 * counted eight statements where seven were made — in both cases one
 * measurement had borrowed a statement from its neighbour. Run alone, both files
 * were always exact, which is what made it look like a real regression in the
 * query count.
 *
 * So: drain **before** clearing as well as after, and decide "drained" by the
 * count having stopped moving rather than by a clock.
 */

/** How long one window of quiet is. */
const WINDOW_MS = 50

/** How many consecutive quiet windows mean the events have arrived. */
const WINDOWS = 3

/**
 * Waits until the recorder has stopped growing.
 *
 * Three windows rather than one: under load a straggler can arrive after a gap
 * longer than a single window, and a wrong count is a gate failing for the wrong
 * reason — worse than one that takes another tenth of a second.
 */
export async function statementsSettled(statements: readonly unknown[]): Promise<void> {
  for (let windows = 0; windows < WINDOWS; windows += 1) {
    const before = statements.length

    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS))

    if (statements.length !== before) windows = -1
  }
}

/**
 * Records the statements one piece of work makes.
 *
 * `statements` is the array the observable client pushes into; it is cleared
 * here, so a spec never has to remember to.
 */
export async function recordStatements(
  statements: string[],
  work: () => Promise<unknown>,
): Promise<readonly string[]> {
  await statementsSettled(statements)
  statements.length = 0
  await work()
  await statementsSettled(statements)

  return [...statements]
}
