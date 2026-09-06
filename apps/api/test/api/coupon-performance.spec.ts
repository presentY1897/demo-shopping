import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { CouponResponse, UserCouponResponse } from '@shopping/shared'
import { couponResponseSchema, userCouponResponseSchema } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'
import { recordStatements } from '../support/statements.js'

/**
 * 쿠폰 경로의 A1 · A5 (TASK-0072).
 *
 * **A5 가 여기서 재는 것은 목록의 N+1 이 아니라 발급의 비용이다.** 발급이 무거워지는
 * 방식은 하나뿐이고, 그것은 성능이 아니라 정확성의 문제이기도 하다: `issuedCount` 를
 * 들고 있는 대신 `UserCoupon` 을 **세는** 모양으로 되돌아가는 것. 그러면 질의가
 * 하나 늘고, 그 질의와 갱신 사이가 비어 초과 발급이 다시 가능해진다. 그래서 아래는
 * 「이미 나간 장이 1장이든 500장이든 발급의 문장 수가 같다」를 단언한다.
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

const NOW = '2026-09-03T00:00:00.000Z'
const VALID_FROM = '2026-09-01T00:00:00.000Z'
const VALID_UNTIL = '2026-09-30T00:00:00.000Z'

/** A1 의 문턱. QUALITY-GATES 3장. */
const P95_BUDGET_MS = 300

const SAMPLES = 50

beforeEach(() => {
  api.clock.set(NOW)
})

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sellerId: null,
    name: '가을 쿠폰',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountAmount: null,
    minOrderAmount: 0,
    scopeType: 'ALL',
    scopeIds: [],
    validFrom: VALID_FROM,
    validUntil: VALID_UNTIL,
    issueLimit: null,
    withCode: false,
    ...overrides,
  }
}

function issueCoupon(overrides: Record<string, unknown> = {}): Promise<CouponResponse> {
  return api.clientAs(callers.operator).request({
    path: '/coupons',
    method: 'POST',
    body: draft(overrides),
    schema: couponResponseSchema,
  })
}

function claim(caller: TestCaller, code: string): Promise<UserCouponResponse> {
  return api.clientAs(caller).request({
    path: '/coupons/claims',
    method: 'POST',
    body: { code },
    schema: userCouponResponseSchema,
  })
}

/** 서로 다른 사람 `count` 명. 발급은 사람마다 한 번뿐이라 표본마다 새 사람이 필요하다. */
async function buyers(count: number): Promise<readonly TestCaller[]> {
  const rows: TestCaller[] = []

  for (let index = 0; index < count; index += 1) {
    rows.push({ userId: (await createUser(db)).id, roles: ['BUYER'] })
  }

  return rows
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)

  return sorted[index] ?? 0
}

describe('A1 — 응답 시간', () => {
  it('발행이 300ms 안에 끝난다', async () => {
    const durations: number[] = []

    for (let index = 0; index < SAMPLES; index += 1) {
      const started = performance.now()

      await issueCoupon({ withCode: true })
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(P95_BUDGET_MS)
  })

  it('코드 발급이 300ms 안에 끝난다 — 이미 나간 장이 쌓여도', async () => {
    // 표본이 진행될수록 이 쿠폰의 발급 행이 늘어난다. 발급 비용이 그 수에 따라
    // 늘어난다면 p95 는 뒤쪽 표본에서 무너진다.
    const { coupon } = await issueCoupon({ withCode: true })
    const people = await buyers(SAMPLES)
    const durations: number[] = []

    for (const person of people) {
      const started = performance.now()

      await claim(person, coupon.code ?? '')
      durations.push(performance.now() - started)
    }

    expect(p95Of(durations)).toBeLessThan(P95_BUDGET_MS)
  })
})

describe('A5 — 질의 수', () => {
  it('이미 나간 장이 몇이든 발급의 문장 수가 같다', async () => {
    // **성능보다 정확성의 단언이다.** 이 수가 늘었다면 `issuedCount` 를 들고 있는
    // 대신 `UserCoupon` 을 세는 모양으로 돌아간 것이고, 그때는 세는 질의와 갱신
    // 사이가 비어 초과 발급이 다시 가능해진다.
    const { coupon } = await issueCoupon({ withCode: true })
    const people = await buyers(12)
    const code = coupon.code ?? ''

    const first = await recordStatements(statements, () => claim(people[0] ?? emptyCaller(), code))

    for (const person of people.slice(1, 11)) await claim(person, code)

    const twelfth = await recordStatements(statements, () =>
      claim(people[11] ?? emptyCaller(), code),
    )

    expect(countable(twelfth)).toHaveLength(countable(first).length)
  })

  it('이기는 길은 세 문장이다 — 코드 조회 · 조건부 갱신 · 발급 행', async () => {
    const { coupon } = await issueCoupon({ withCode: true })
    const [person] = await buyers(1)

    const made = await recordStatements(statements, () =>
      claim(person ?? emptyCaller(), coupon.code ?? ''),
    )

    // 코드로 정책을 찾고 · 조건부로 자리를 잡고 · 발급 행을 넣는다. 셋뿐이다.
    //
    // **「몇 장 남았는지」와 「이미 받았는지」는 없다** — 그 둘은 진 쪽만 읽는다
    // (`CouponService.explainRefusal`). 정책을 다시 조인하는 질의도 없다: 기간을
    // 보려고 이미 읽은 행을 응답에 그대로 쓴다(`USER_COUPON_SELECT` 가 스칼라만인
    // 이유). 이 수가 늘었다면 성공하는 길에 설명이나 중복 조회가 섞여 들어온
    // 것이다. 트랜잭션 경계는 세지 않는다.
    expect(countable(made)).toHaveLength(3)
  })
})

/** 트랜잭션 경계를 뺀 문장들. 세는 대상은 실제 질의뿐이다. */
function countable(queries: readonly string[]): readonly string[] {
  return queries.filter((query) => !/^(BEGIN|COMMIT|ROLLBACK|DEALLOCATE)/u.test(query))
}

/** 배열 인덱싱의 `undefined` 를 삼키지 않기 위한 자리. 여기 닿으면 그 자체가 실패다. */
function emptyCaller(): TestCaller {
  throw new Error('표본 사용자가 준비되지 않았습니다.')
}
