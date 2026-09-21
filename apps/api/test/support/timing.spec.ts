import { describe, expect, it } from 'vitest'

import {
  expectWithinBudget,
  judge,
  LOOSE_FACTOR,
  medianOf,
  p95Of,
  sample,
  samplePrepared,
  timingMode,
  WARMUP_RUNS,
} from './timing.js'

/**
 * A clock the test moves by hand. Nothing here sleeps: a spec about flaky
 * timing that itself depended on the wall clock would be the joke it sounds like.
 */
function manualClock(): { now: () => number; advance: (ms: number) => void } {
  let current = 0

  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

/** `count` durations that are all `value`, except the slowest `tail` which are `slow`. */
function durationsOf(count: number, value: number, tail = 0, slow = value): number[] {
  return Array.from({ length: count }, (_unused, index) => (index < count - tail ? value : slow))
}

describe('sample', () => {
  it('throws the warm-up calls away, however slow they were', async () => {
    const clock = manualClock()

    const durations = await sample(
      (index) => {
        // Only the first two calls pay for the cold pool and the cold code.
        clock.advance(index < WARMUP_RUNS ? 900 : 40)

        return Promise.resolve()
      },
      { samples: 30, now: clock.now },
    )

    expect(durations).toHaveLength(30)
    expect(durations.filter((duration) => duration !== 40)).toEqual([])
  })

  it('hands out one continuous index across warm-up and samples', async () => {
    const seen: number[] = []

    await sample(
      (index) => {
        seen.push(index)

        return Promise.resolve()
      },
      { samples: 3, warmup: 2 },
    )

    expect(seen).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps every call when the warm-up is turned off', async () => {
    const durations = await sample(() => Promise.resolve(), { samples: 4, warmup: 0 })

    expect(durations).toHaveLength(4)
  })
})

describe('samplePrepared', () => {
  it('leaves the preparation outside the clock', async () => {
    const clock = manualClock()

    const durations = await samplePrepared(
      (index) => {
        // Filling a cart for the order about to be timed — seconds, not the subject.
        clock.advance(5_000)

        return Promise.resolve(`cart-${String(index)}`)
      },
      () => {
        clock.advance(70)

        return Promise.resolve()
      },
      { samples: 5, now: clock.now },
    )

    expect(durations).toEqual([70, 70, 70, 70, 70])
  })

  it('gives each run what was prepared for it', async () => {
    const received: string[] = []

    await samplePrepared(
      (index) => Promise.resolve(`cart-${String(index)}`),
      (prepared) => {
        received.push(prepared)

        return Promise.resolve()
      },
      { samples: 2, warmup: 1 },
    )

    expect(received).toEqual(['cart-0', 'cart-1', 'cart-2'])
  })
})

describe('p95Of · medianOf', () => {
  it('takes the second-slowest of thirty as the p95', () => {
    const durations = [...durationsOf(28, 70), 250, 400]

    expect(p95Of(durations)).toBe(250)
  })

  it('does not care what order the samples arrived in', () => {
    expect(p95Of([400, 70, 250, ...durationsOf(27, 70)])).toBe(250)
    expect(medianOf([9, 1, 5])).toBe(5)
  })

  it('takes the mean of the middle pair when the count is even', () => {
    expect(medianOf([10, 20, 30, 40])).toBe(25)
  })

  it('refuses to summarise no samples at all', () => {
    expect(() => p95Of([])).toThrow('표본이 없습니다')
    expect(() => medianOf([])).toThrow('표본이 없습니다')
  })
})

describe('judge', () => {
  it('strict: holds the p95 to the budget as written', () => {
    // Two samples over — with thirty, that is the p95.
    expect(judge(durationsOf(30, 70, 2, 310), 300, 'strict').within).toBe(false)
    expect(judge(durationsOf(30, 70, 2, 299), 300, 'strict').within).toBe(true)
  })

  it('strict: forgives a single outlier, which is what a p95 is for', () => {
    expect(judge(durationsOf(30, 70, 1, 2_000), 300, 'strict').within).toBe(true)
  })

  it('loose: a runner three times slower still passes', () => {
    // 2026-09-18, replayed: the p95 is over the budget and the median is nowhere near the limit.
    const slowRunner = durationsOf(30, 182, 2, 335)

    expect(judge(slowRunner, 300, 'strict').within).toBe(false)
    expect(judge(slowRunner, 300, 'loose').within).toBe(true)
    expect(judge(durationsOf(30, 800), 300, 'loose').within).toBe(true)
  })

  it('loose: a regression of several times does not', () => {
    const verdict = judge(durationsOf(30, 1_000), 300, 'loose')

    expect(verdict.within).toBe(false)
    expect(verdict.limitMs).toBe(300 * LOOSE_FACTOR)
  })

  it('loose: is not moved by the tail that made the strict verdict flaky', () => {
    expect(judge(durationsOf(30, 70, 10, 5_000), 300, 'loose').within).toBe(true)
  })

  it('says the mode, the rule and all three figures', () => {
    const { summary } = judge([...durationsOf(28, 180), 320, 340], 300, 'strict')

    expect(summary).toContain('[perf:strict]')
    expect(summary).toContain('예산 300ms')
    expect(summary).toContain('중앙값 180.0ms')
    expect(summary).toContain('p95 320.0ms')
    expect(summary).toContain('최대 340.0ms')
    expect(summary).toContain('표본 30개')
  })
})

describe('expectWithinBudget', () => {
  it('passes quietly inside the budget', () => {
    expect(() => {
      expectWithinBudget(durationsOf(30, 70), 300, 'strict')
    }).not.toThrow()
  })

  it('fails with the summary attached, not just two numbers', () => {
    expect(() => {
      expectWithinBudget(durationsOf(30, 1_000), 300, 'loose')
    }).toThrow(/\[perf:loose\].*중앙값 1000\.0ms/)
  })
})

describe('timingMode', () => {
  it('is strict on a developer machine and loose on CI', () => {
    expect(timingMode({})).toBe('strict')
    expect(timingMode({ CI: 'true' })).toBe('loose')
    expect(timingMode({ CI: '1' })).toBe('loose')
  })

  it('does not take CI=false or an empty CI for a runner', () => {
    expect(timingMode({ CI: 'false' })).toBe('strict')
    expect(timingMode({ CI: '' })).toBe('strict')
  })

  it('lets PERF_TIMING overrule CI in both directions', () => {
    expect(timingMode({ CI: 'true', PERF_TIMING: 'strict' })).toBe('strict')
    expect(timingMode({ PERF_TIMING: 'loose' })).toBe('loose')
  })

  it('refuses a value it does not know instead of picking a verdict', () => {
    expect(() => timingMode({ PERF_TIMING: 'strcit' })).toThrow('strict 또는 loose')
  })
})
