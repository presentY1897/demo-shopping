import { describe, expect, it } from 'vitest'

import { barrier, concurrently, fulfilled, rejected } from './concurrently.js'

describe('concurrently', () => {
  it('starts every task before any of them finishes', async () => {
    const started: number[] = []
    const gate = barrier(3)

    const results = await concurrently(3, async (index) => {
      started.push(index)
      // Nothing gets past here until all three have arrived, so a sequential
      // implementation of `concurrently` would deadlock instead of passing.
      await gate.arrive()
      return index
    })

    expect(started).toHaveLength(3)
    expect(fulfilled(results).sort()).toEqual([0, 1, 2])
  })

  it('collects failures instead of losing the successes with them', async () => {
    const results = await concurrently(2, (index) =>
      index === 0 ? Promise.resolve('ok') : Promise.reject(new Error('boom')),
    )

    expect(fulfilled(results)).toEqual(['ok'])
    expect(rejected(results)).toHaveLength(1)
  })
})

describe('barrier', () => {
  it('releases everyone at once when the last participant arrives', async () => {
    const gate = barrier(2)
    const order: string[] = []

    const first = gate.arrive().then(() => order.push('first'))

    // One participant short: nothing may proceed yet.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(order).toEqual([])

    const second = gate.arrive().then(() => order.push('second'))

    await Promise.all([first, second])
    expect(order).toHaveLength(2)
  })

  it('lets a late arrival through instead of blocking it forever', async () => {
    const gate = barrier(1)

    await gate.arrive()
    await expect(gate.arrive()).resolves.toBeUndefined()
  })
})
