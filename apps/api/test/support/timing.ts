import { expect } from 'vitest'

/**
 * How the `*-performance.spec.ts` files take a time and judge it (TASK-0146).
 *
 * QUALITY-GATES A1 asks for a p95 inside a budget **measured locally**. For a
 * while the specs asserted that same number on CI's shared runners too, and on
 * 2026-09-18 a commit that touched nothing but `docs/` turned `main` red: the
 * runner was 2.6 times slower than the one that had passed the same code a few
 * minutes earlier, and order creation read 335ms against 300.
 *
 * A wall clock on somebody else's VM cannot hold an absolute number, so the
 * number is held where it can be. Locally — `pre-push`, `pnpm gate` — the
 * verdict is the strict one, the p95 against the budget as written. On CI it is
 * loose: the median against three times the budget, which still goes red for a
 * wait inside a transaction and does not for a slow neighbour. What catches
 * N+1 and a lost index on CI was never the clock anyway; it is the statement
 * counts and the `EXPLAIN` checks beside these, and they are deterministic.
 */

export type TimingMode = 'strict' | 'loose'

/**
 * Calls made and thrown away before the first sample.
 *
 * The first call through a route opens pool connections and runs cold code.
 * With thirty samples the p95 is the second-slowest value, so an unwarmed loop
 * has spent one of its two slow slots before the runner has done anything.
 */
export const WARMUP_RUNS = 2

/**
 * What the loose verdict multiplies the budget by. The slowdown observed on
 * 2026-09-18 was 2.6; anything under 3 is a flake waiting for its day.
 */
export const LOOSE_FACTOR = 3

/**
 * `PERF_TIMING` decides, and when it is absent the presence of `CI` does. The
 * explicit variable is what lets either verdict be reproduced on the other
 * side — `PERF_TIMING=loose` locally to see what CI sees.
 */
export function timingMode(env: NodeJS.ProcessEnv = process.env): TimingMode {
  const requested = env.PERF_TIMING ?? ''

  if (requested === 'strict' || requested === 'loose') {
    return requested
  }

  if (requested !== '') {
    // A typo must not quietly pick a verdict — `PERF_TIMING=strcit` falling
    // back to loose would look exactly like a pass.
    throw new Error(`PERF_TIMING 은 strict 또는 loose 여야 합니다: ${requested}`)
  }

  const ci = env.CI ?? ''

  return ci !== '' && ci !== 'false' ? 'loose' : 'strict'
}

export interface SampleOptions {
  /** How many timed calls to keep. */
  samples: number
  /** Calls to make and discard first. Defaults to {@link WARMUP_RUNS}. */
  warmup?: number
  /** The clock, in milliseconds. Only `timing.spec.ts` replaces it. */
  now?: () => number
}

/**
 * Times `run` alone; `prepare` happens outside the clock.
 *
 * Both receive a **continuous** index — `0 … warmup + samples - 1` — so a loop
 * that needs a fresh name or a fresh address per call gets one for the warm-up
 * calls too. A spec that lays out one fixture per sample beforehand therefore
 * needs `warmup + samples` of them.
 */
export async function samplePrepared<Prepared>(
  prepare: (index: number) => Promise<Prepared>,
  run: (prepared: Prepared, index: number) => Promise<unknown>,
  options: SampleOptions,
): Promise<number[]> {
  const warmup = options.warmup ?? WARMUP_RUNS
  const now = options.now ?? (() => performance.now())
  const durations: number[] = []

  for (let index = 0; index < warmup + options.samples; index += 1) {
    const prepared = await prepare(index)
    const started = now()

    await run(prepared, index)

    const elapsed = now() - started

    if (index >= warmup) {
      durations.push(elapsed)
    }
  }

  return durations
}

/** {@link samplePrepared} for the common case with nothing to prepare. */
export function sample(
  run: (index: number) => Promise<unknown>,
  options: SampleOptions,
): Promise<number[]> {
  return samplePrepared(
    () => Promise.resolve(undefined),
    (_prepared, index) => run(index),
    options,
  )
}

function ascending(durations: readonly number[]): number[] {
  if (durations.length === 0) {
    // Every figure below would be `undefined`, and a verdict over no samples
    // is a pass that measured nothing.
    throw new Error('표본이 없습니다 — 시간을 재지 않고 판정할 수 없습니다.')
  }

  return [...durations].sort((left, right) => left - right)
}

/** Nearest-rank p95: with thirty samples, the second-slowest. */
export function p95Of(durations: readonly number[]): number {
  const sorted = ascending(durations)

  return sorted[Math.ceil(sorted.length * 0.95) - 1]!
}

export function medianOf(durations: readonly number[]): number {
  const sorted = ascending(durations)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]!

  return sorted.length % 2 === 1 ? upper : (sorted[middle - 1]! + upper) / 2
}

export interface TimingVerdict {
  mode: TimingMode
  within: boolean
  /** The figure the mode judges: the p95 when strict, the median when loose. */
  measuredMs: number
  /** What it is judged against: the budget when strict, `LOOSE_FACTOR` of it when loose. */
  limitMs: number
  /** Everything a reader needs to tell a flake from a regression. */
  summary: string
}

export function judge(
  durations: readonly number[],
  budgetMs: number,
  mode: TimingMode = timingMode(),
): TimingVerdict {
  const median = medianOf(durations)
  const p95 = p95Of(durations)
  const max = Math.max(...durations)
  const measuredMs = mode === 'strict' ? p95 : median
  const limitMs = mode === 'strict' ? budgetMs : budgetMs * LOOSE_FACTOR
  const rule =
    mode === 'strict'
      ? `p95 < 예산 ${String(budgetMs)}ms`
      : `중앙값 < 예산 ${String(budgetMs)}ms × ${String(LOOSE_FACTOR)}`

  return {
    mode,
    within: measuredMs < limitMs,
    measuredMs,
    limitMs,
    summary:
      `[perf:${mode}] ${rule} — 중앙값 ${median.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · ` +
      `최대 ${max.toFixed(1)}ms (표본 ${String(durations.length)}개)`,
  }
}

/**
 * The one timing assertion the performance specs make.
 *
 * `335 to be less than 300` was all the failure of 2026-09-18 said, and it
 * could not be read: a median of 180 beside it says "slow runner", a median of
 * 320 says "regression". The summary rides along with the assertion for that.
 */
export function expectWithinBudget(
  durations: readonly number[],
  budgetMs: number,
  mode: TimingMode = timingMode(),
): void {
  const verdict = judge(durations, budgetMs, mode)

  expect(verdict.measuredMs, verdict.summary).toBeLessThan(verdict.limitMs)
}
