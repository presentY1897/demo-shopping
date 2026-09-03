import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { DatabaseHealthIndicator } from './database.health-indicator.js'

const CONFIG = {
  database: {
    url: 'postgresql://shopping:shopping@localhost:5482/shopping',
    poolSize: 10,
    connectTimeoutMs: 5_000,
    healthTimeoutMs: 100,
  },
} as AppConfig

/** Stands in for the client; only `$queryRaw` is reached by the indicator. */
function prismaAnswering(queryRaw: () => Promise<unknown>): PrismaService {
  return { $queryRaw: queryRaw } as unknown as PrismaService
}

function indicatorAnswering(queryRaw: () => Promise<unknown>): DatabaseHealthIndicator {
  return new DatabaseHealthIndicator(prismaAnswering(queryRaw), CONFIG)
}

describe('DatabaseHealthIndicator', () => {
  it('is registered under the key the shared payload declares', () => {
    expect(indicatorAnswering(() => Promise.resolve([{ ok: 1 }])).key).toBe('database')
  })

  it('reports ok when the probe query comes back', async () => {
    await expect(indicatorAnswering(() => Promise.resolve([{ ok: 1 }])).check()).resolves.toBe('ok')
  })

  it('accepts the driver returning the count as a string or a bigint', async () => {
    // `pg` decides per type how a number reaches JS; the probe must not depend on it.
    await expect(indicatorAnswering(() => Promise.resolve([{ ok: '1' }])).check()).resolves.toBe(
      'ok',
    )
    await expect(indicatorAnswering(() => Promise.resolve([{ ok: 1n }])).check()).resolves.toBe(
      'ok',
    )
  })

  it('reports degraded when the answer is not the expected payload', async () => {
    await expect(indicatorAnswering(() => Promise.resolve([])).check()).resolves.toBe('degraded')
    await expect(indicatorAnswering(() => Promise.resolve([{ ok: 0 }])).check()).resolves.toBe(
      'degraded',
    )
    await expect(indicatorAnswering(() => Promise.resolve('nonsense')).check()).resolves.toBe(
      'degraded',
    )
  })

  it('reports down instead of rejecting when the database refuses the connection', async () => {
    const check = indicatorAnswering(() => Promise.reject(new Error('ECONNREFUSED'))).check()

    await expect(check).resolves.toBe('down')
  })

  it('reports down instead of rejecting when the driver throws a non-Error', async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      indicatorAnswering(() => Promise.reject('boom')).check(),
    ).resolves.toBe('down')
  })

  it('gives up once the deadline passes rather than holding the request open', async () => {
    // `performance.now()` and not `Date.now()`: reading the wall clock directly
    // is banned in this package (see eslint.config.mjs), and a monotonic counter
    // is the right instrument for an elapsed time anyway.
    const startedAt = performance.now()

    // A server that accepts the connection and then stops answering: the query
    // never settles, so only the deadline can end the check.
    const neverSettles = (): Promise<never> => new Promise<never>(() => undefined)

    await expect(indicatorAnswering(neverSettles).check()).resolves.toBe('down')
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })

  it('clears the deadline timer so a healthy check leaves nothing pending', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout')

    await indicatorAnswering(() => Promise.resolve([{ ok: 1 }])).check()

    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
})
