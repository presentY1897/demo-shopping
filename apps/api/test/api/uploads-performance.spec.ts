import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { PresignUploadRequest } from '@shopping/shared'
import { afterAll, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import { callers } from '../support/principal.js'

/**
 * Gates A1 (response time) and A5 (no N+1) for `POST /uploads/presign`.
 *
 * Counted rather than reasoned about, the same way `categories-performance`
 * does it: the application is booted against a **real** `PrismaClient` — same
 * class, same worker database, query logging on — so nothing is mocked (A6) and
 * the statements are the ones production would issue.
 *
 * What A5 protects here is small but easy to lose. Presigning needs one row: the
 * store, plus the demo flag of the account that owns it. That is one query
 * today; an `include` added later, or an ownership mapper that fetches the owner
 * separately, turns it into two without any functional test noticing.
 */

const db = useDatabase()

const statements: string[] = []

const observable = new PrismaClient({
  adapter: new PrismaPg({ connectionString: db.url, max: 5 }),
  log: [{ emit: 'event', level: 'query' }],
})

;(
  observable as unknown as {
    $on: (event: 'query', listener: (payload: { query: string }) => void) => void
  }
).$on('query', (payload) => statements.push(payload.query))

const api = useApiApp({ database: db, authenticate: true, prisma: observable })

afterAll(async () => {
  await observable.$disconnect()
})

async function createStore(): Promise<string> {
  const owner = await createUser(db)
  const seller = await createSeller(db, { userId: owner.id })

  return seller.id
}

function request(sellerId: string): PresignUploadRequest {
  return {
    purpose: 'product-image',
    sellerId,
    filename: '가을-니트.png',
    contentType: 'image/png',
    size: 204_800,
  }
}

/** Runs `work` and reports every statement it caused. */
async function statementsDuring(work: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0
  await work()
  await new Promise((resolve) => setTimeout(resolve, 20))

  return [...statements]
}

describe('issuing a URL costs a fixed two statements (A5)', () => {
  /**
   * Two, not one: the store is read, then the account that owns it, because the
   * demo flag the scope check needs lives on `User`.
   *
   * Prisma would collapse the pair into a lateral join with
   * `relationLoadStrategy: 'join'`, but that needs the `relationJoins` preview
   * flag in `schema.prisma`, and this branch does not own that file. Recorded in
   * TASK-0011 7장 R7 so it is a decision rather than an oversight.
   *
   * What matters for A5 is that the number does not move with the data, which is
   * what the two sizes below establish.
   */
  const EXPECTED_STATEMENTS = 2

  it('reads the same number of rows whether there is one store or twenty', async () => {
    const alone = await createStore()
    const forOne = await statementsDuring(() =>
      api.clientAs(callers.superAdmin).presignUpload(request(alone)),
    )

    for (let index = 0; index < 20; index += 1) await createStore()

    const crowded = await createStore()
    const forMany = await statementsDuring(() =>
      api.clientAs(callers.superAdmin).presignUpload(request(crowded)),
    )

    expect(forOne).toHaveLength(EXPECTED_STATEMENTS)
    expect(forMany).toHaveLength(EXPECTED_STATEMENTS)
    expect(forMany.filter((statement) => statement.includes('"Seller"'))).toHaveLength(1)
    expect(forMany.filter((statement) => statement.includes('"User"'))).toHaveLength(1)
  })

  it('does not open a transaction — nothing is written', async () => {
    const sellerId = await createStore()
    const seen = await statementsDuring(() =>
      api.clientAs(callers.superAdmin).presignUpload(request(sellerId)),
    )

    expect(seen.filter((statement) => /^(BEGIN|COMMIT)/.test(statement))).toEqual([])
  })
})

describe('response time (A1)', () => {
  it('answers well inside 300ms at p95', async () => {
    const sellerId = await createStore()
    const client = api.clientAs(callers.superAdmin)
    const durations: number[] = []

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await client.presignUpload(request(sellerId))
      durations.push(performance.now() - started)
    }

    durations.sort((left, right) => left - right)

    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Number.POSITIVE_INFINITY

    expect(p95).toBeLessThan(300)
  })
})
