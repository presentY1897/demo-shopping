import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient } from '@shopping/shared'
import { addressListResponseSchema, profileResponseSchema } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * Gates A1 (response time) and A5 (no N+1) for the `/me` family, measured rather
 * than asserted by inspection.
 *
 * The statements are counted at the source: the application is booted against a
 * **real** `PrismaClient` — the same class, against the same worker database,
 * with query logging switched on. Nothing is mocked, which A6 forbids.
 *
 * The address book is the only answer here whose size a person controls, so it
 * is the only one that can become linear. The original completion criterion said
 * "프로필+설정+배송지 동시 조회", but `GET /me` carries no addresses (4장 절단면);
 * measuring it would have counted a constant and called it a proof.
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

let caller: TestCaller

beforeEach(async () => {
  const user = await createUser(db)

  await db.execute(
    `INSERT INTO "UserRole" ("id", "userId", "role") VALUES (gen_random_uuid(), $1, 'BUYER')`,
    [user.id],
  )

  caller = { userId: user.id, roles: ['BUYER'] }
})

function client(): ApiClient {
  return api.clientAs(caller)
}

function listAddresses(): Promise<unknown> {
  return client().request({ path: '/me/addresses', schema: addressListResponseSchema })
}

function readMe(): Promise<unknown> {
  return client().request({ path: '/me', schema: profileResponseSchema })
}

/**
 * Fills the book, promoting the first one only if the account has no default
 * yet — the index allows exactly one, and this helper is called twice.
 */
async function saveAddresses(count: number): Promise<void> {
  await db.execute(
    `INSERT INTO "Address"
       ("id", "userId", "label", "recipientName", "phone", "postalCode", "addressLine1",
        "isDefault", "updatedAt")
     SELECT gen_random_uuid(), $1, '주소 ' || n, '김수령', '010-1234-5678', '06234',
            '서울시 강남구 테헤란로 ' || n,
            n = 1 AND NOT EXISTS (
              SELECT 1 FROM "Address" WHERE "userId" = $1 AND "isDefault"
            ),
            now()
       FROM generate_series(1, $2::int) AS n`,
    [caller.userId, count],
  )
}

async function statementsDuring(work: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0
  await work()
  await new Promise((resolve) => {
    setTimeout(resolve, 20)
  })

  return [...statements]
}

/** Statements that actually touched the address book. */
function addressStatements(seen: readonly string[]): string[] {
  return seen.filter((statement) => statement.includes('"Address"'))
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.floor(sorted.length * 0.95)] ?? Number.POSITIVE_INFINITY
}

describe('배송지 목록은 건수에 비례하지 않는다 (A5)', () => {
  it('1건과 50건을 같은 수의 문장으로 읽는다', async () => {
    await saveAddresses(1)
    const forOne = await statementsDuring(listAddresses)

    await saveAddresses(49)
    const forMany = await statementsDuring(listAddresses)

    expect(addressStatements(forMany)).toHaveLength(addressStatements(forOne).length)
    // One `SELECT`, and no count query for a list that carries no cursor.
    expect(addressStatements(forMany)).toHaveLength(1)
  })

  it('50건을 읽어도 전체 문장 수가 늘지 않는다', async () => {
    await saveAddresses(1)
    const forOne = await statementsDuring(listAddresses)

    await saveAddresses(49)
    const forMany = await statementsDuring(listAddresses)

    // The account lookup that resolves `/me` is the other statement, and it is
    // one whatever the book holds.
    expect(forMany.length).toBe(forOne.length)
  })

  it('GET /me 는 배송지를 싣지 않는다', async () => {
    await saveAddresses(20)

    const seen = await statementsDuring(readMe)

    expect(addressStatements(seen)).toEqual([])
  })
})

describe('응답 시간 (A1)', () => {
  it('배송지 50건 목록을 300ms 안에 답한다', async () => {
    await saveAddresses(50)

    const durations: number[] = []

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await listAddresses()
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })

  it('프로필과 설정을 300ms 안에 답한다', async () => {
    const durations: number[] = []

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await readMe()
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(300)
  })
})
