import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { SellerReviewListResponse } from '@shopping/shared'
import { sellerResponseSchema, sellerReviewListResponseSchema } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { callers } from '../support/principal.js'

/**
 * Gates A1 (response time) and A5 (no N+1) for the review queue.
 *
 * The statements are counted at the source: the application is booted against a
 * **real** `PrismaClient` — the same class, against the same worker database,
 * with query logging switched on. Nothing is mocked, which A6 forbids; the only
 * difference from production is that this client says what it ran.
 *
 * A5 is worth pinning down here even though the queue looks like a flat list.
 * `userId` travels in the response precisely so that TASK-0110 does not fetch an
 * account per row, and the cheapest way to lose that is for somebody to add an
 * `include` to make a name appear. A hundred applications would then cost a
 * hundred round trips while every functional test stayed green.
 */

const db = useDatabase()

/** Statements this run has seen, from the client the application is using. */
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

const SAMPLES = 50

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

function reviewList(search = ''): Promise<SellerReviewListResponse> {
  return api
    .clientAs(callers.operator)
    .request({ path: `/admin/sellers${search}`, schema: sellerReviewListResponseSchema })
}

/** Runs `work` and reports every statement it caused. */
async function statementsDuring(work: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0
  await work()
  // The event is emitted from the adapter's callback; a macrotask is enough for
  // the ones already resolved to have arrived.
  await new Promise((resolve) => setTimeout(resolve, 20))

  return [...statements]
}

/** Statements that actually touched one of this task's tables. */
function onboardingStatements(seen: readonly string[]): string[] {
  return seen.filter((statement) =>
    ['"Seller"', '"UserRole"'].some((table) => statement.includes(table)),
  )
}

/** `count` applications, written straight to the tables. */
async function bulkApplications(count: number, tag: string): Promise<void> {
  await db.execute(
    `INSERT INTO "User" ("id", "googleSub", "email", "name", "updatedAt")
     SELECT gen_random_uuid(), $1 || '-' || n, $1 || n || '@example.com', '대량', now()
       FROM generate_series(1, $2::int) AS n`,
    [tag, count],
  )
  await db.execute(
    `INSERT INTO "Seller" ("id", "userId", "brandName", "slug", "status", "statusChangedAt", "updatedAt")
     SELECT gen_random_uuid(), u."id", '브랜드 ' || u."googleSub", 'store-' || u."googleSub",
            'PENDING'::"SellerStatus", now(), now()
       FROM "User" u WHERE u."googleSub" LIKE $1 || '-%'`,
    [tag],
  )
}

let tags = 0

function nextTag(): string {
  tags += 1
  return `bulk${String(tags)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

describe('A1 — 심사 목록 100건의 응답 시간', () => {
  beforeEach(async () => {
    await bulkApplications(100, nextTag())
  })

  it('answers a hundred applications well inside 300ms at p95', async () => {
    const durations: number[] = []

    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const started = performance.now()

      await reviewList('?limit=100')
      durations.push(performance.now() - started)
    }

    const { sellers } = await reviewList('?limit=100')

    // A number measured over an empty table would say nothing.
    expect(sellers).toHaveLength(100)
    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('answers the filtered queue just as fast', async () => {
    const durations: number[] = []

    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const started = performance.now()

      await reviewList('?status=PENDING&limit=100')
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})

describe('A5 — 목록은 신청 건수와 무관하게 한 문장이다', () => {
  it('costs the same for 5 applications and for 100', async () => {
    await bulkApplications(5, nextTag())

    const forFew = await statementsDuring(() => reviewList('?limit=100'))

    await bulkApplications(95, nextTag())

    const forMany = await statementsDuring(() => reviewList('?limit=100'))

    expect(onboardingStatements(forFew)).toHaveLength(1)
    expect(onboardingStatements(forMany)).toHaveLength(1)

    const { sellers } = await reviewList('?limit=100')

    // The bigger read really did come back whole — a count that stayed flat
    // because nothing was returned would prove nothing.
    expect(sellers).toHaveLength(100)
  })

  it('costs one statement to read a single application', async () => {
    await bulkApplications(3, nextTag())

    const { sellers } = await reviewList()
    const id = sellers[0]?.id ?? ''

    const seen = await statementsDuring(() =>
      api
        .clientAs(callers.operator)
        .request({ path: `/admin/sellers/${id}`, schema: sellerResponseSchema }),
    )

    expect(onboardingStatements(seen)).toHaveLength(1)
  })

  it('costs a fixed number of statements to approve one application', async () => {
    await bulkApplications(2, nextTag())

    const { sellers } = await reviewList()
    const target = sellers[0]

    const seen = await statementsDuring(() =>
      api.clientAs(callers.operator).request({
        path: `/admin/sellers/${target?.id ?? ''}/approve`,
        method: 'POST',
        body: { version: target?.version ?? 0 },
        schema: sellerResponseSchema,
      }),
    )

    // Load, transition, grant, read back — plus the transaction's own BEGIN and
    // COMMIT. The number is asserted so that a lookup added inside the
    // transaction shows up here rather than as a slow console two milestones
    // later.
    expect(onboardingStatements(seen)).toHaveLength(4)
  })
})
