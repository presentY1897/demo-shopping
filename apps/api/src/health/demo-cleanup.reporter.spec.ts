/**
 * The field must never be the reason `/health` fails.
 *
 * Found the hard way: `health.integration.spec.ts` has a case for "database
 * down, API still answers", and adding this reporter broke it — the query threw
 * and the endpoint returned 500. A 500 from `/health` reads as "the process is
 * gone", and a load balancer that believes it stops routing to the last live
 * instance. The `database` indicator is what reports a database outage; this
 * field's only job is to say when the sweep last ran, and "I could not find out"
 * is `null`.
 */

import { describe, expect, it } from 'vitest'

import { DEMO_CLEANUP_LAST_RUN_KEY } from '../demo/demo-cleanup.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { DemoCleanupReporter } from './demo-cleanup.reporter.js'

function prismaAnswering(answer: () => Promise<{ value: string } | null>): PrismaService {
  return { appMeta: { findUnique: answer } } as unknown as PrismaService
}

describe('DemoCleanupReporter', () => {
  it('answers the recorded instant', async () => {
    const at = '2026-09-05T00:15:00.000Z'
    const reporter = new DemoCleanupReporter(prismaAnswering(() => Promise.resolve({ value: at })))

    expect(await reporter.lastRunAt()).toBe(at)
  })

  it('answers null before the sweep has ever run', async () => {
    const reporter = new DemoCleanupReporter(prismaAnswering(() => Promise.resolve(null)))

    expect(await reporter.lastRunAt()).toBeNull()
  })

  it('answers null rather than throwing when the row is not a date', async () => {
    const reporter = new DemoCleanupReporter(
      prismaAnswering(() => Promise.resolve({ value: '어제쯤' })),
    )

    expect(await reporter.lastRunAt()).toBeNull()
  })

  it('answers null rather than throwing when the database is unreachable', async () => {
    const reporter = new DemoCleanupReporter(
      prismaAnswering(() => Promise.reject(new Error('connection refused'))),
    )

    await expect(reporter.lastRunAt()).resolves.toBeNull()
  })

  it('reads the key the sweep writes', async () => {
    // Two constants that must agree, in two modules. If they drift the endpoint
    // reports `null` forever and nobody notices, because `null` is a legal
    // answer.
    let asked: string | null = null
    const reporter = new DemoCleanupReporter({
      appMeta: {
        findUnique: (query: { where: { key: string } }) => {
          asked = query.where.key

          return Promise.resolve(null)
        },
      },
    } as unknown as PrismaService)

    await reporter.lastRunAt()

    expect(asked).toBe(DEMO_CLEANUP_LAST_RUN_KEY)
  })
})
