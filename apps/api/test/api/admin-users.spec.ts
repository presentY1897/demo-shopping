import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  adjustPointsResponseSchema,
  adminUserDetailResponseSchema,
  adminUserListResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 관리자 회원 관리 (TASK-0093), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **값이 셋에 몰려 있다.**
 *
 * - **목록이 가려서 나가는가** (F6). 한 화면이 잊으면 증상은 오류가 아니라 이미
 *   공개된 개인정보다.
 * - **연 것이 남는가** (F7). 남지 않는 열람 기록은 없는 것과 같다.
 * - **정지가 로그인을 막는가** (F4). 다음 로그인이 그대로 되면 정지가 아니다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-20T00:00:00.000Z'

let operator: TestCaller
let superAdmin: TestCaller
let buyer: TestCaller
let subjectId: string

beforeEach(async () => {
  api.clock.set(NOW)

  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  // 정지와 적립금 조정은 `user.write` 다 — **운영자에게는 없다**
  // (`permission-matrix.md`). 회원 계정을 멈추는 것과 돈에 해당하는 값을 손으로
  // 바꾸는 것은 최고관리자의 결정이라는 뜻이고, 이 스펙은 그 선을 그대로 쓴다.
  superAdmin = { userId: (await createUser(db)).id, roles: ['ADMIN_SUPER'] }
  buyer = { userId: (await createUser(db)).id, roles: ['BUYER'] }
  subjectId = (await createUser(db, { email: 'honggildong@example.com', name: '홍길동' })).id
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

function list(caller: TestCaller, query = '') {
  return client(caller).request({
    path: `/admin/users${query}`,
    schema: adminUserListResponseSchema,
  })
}

function open(caller: TestCaller, userId: string, reason = '고객 문의 확인') {
  return client(caller).request({
    path: `/admin/users/${userId}/views`,
    method: 'POST',
    body: { reason },
    schema: adminUserDetailResponseSchema,
  })
}

function suspend(caller: TestCaller, userId: string, reason = '약관 위반') {
  return client(caller).request({
    path: `/admin/users/${userId}/suspension`,
    method: 'POST',
    body: { reason },
    schema: z.unknown(),
  })
}

function adjust(caller: TestCaller, userId: string, amount: number, reason = '보상 지급') {
  return client(caller).request({
    path: `/admin/users/${userId}/points`,
    method: 'POST',
    body: { amount, reason },
    schema: adjustPointsResponseSchema,
  })
}

async function failure(work: Promise<unknown>): Promise<number> {
  try {
    await work
  } catch (error) {
    if (error instanceof ApiClientError && error.status !== undefined) return error.status

    throw error
  }

  throw new Error('실패했어야 하는 요청이 성공했습니다.')
}

describe('목록 (F1 · F6)', () => {
  it('masks the email and the name, and never sends the raw ones', async () => {
    const answer = await list(operator, '?q=honggildong')
    const [row] = answer.users

    expect(row).toMatchObject({ maskedEmail: 'hon*@example.com', maskedName: '홍*동' })
    // **원본이 응답 어디에도 없다.** 가린 값 옆에 원본이 함께 실리면 가린 의미가 없다.
    expect(JSON.stringify(answer)).not.toContain('honggildong@example.com')
    expect(JSON.stringify(answer)).not.toContain('홍길동')
  })

  /** 사람은 자기가 아는 이메일을 치지, 별이 박힌 문자열을 치지 않는다. */
  it('searches the real value, not the masked one', async () => {
    expect((await list(operator, '?q=honggildong@example.com')).users).toHaveLength(1)
    expect((await list(operator, '?q=홍길동')).users).toHaveLength(1)
    expect((await list(operator, '?q=hon*')).users).toEqual([])
  })

  it('narrows by role and by demo', async () => {
    await createUser(db, { isDemo: true })

    const demos = await list(operator, '?isDemo=true')

    expect(demos.users.every((row) => row.isDemo)).toBe(true)
    expect(demos.users.length).toBeGreaterThan(0)
  })
})

describe('상세와 열람 기록 (F2 · F7)', () => {
  it('sends the unmasked values', async () => {
    const { user } = await open(operator, subjectId)

    expect(user).toMatchObject({ email: 'honggildong@example.com', name: '홍길동' })
  })

  /** **남지 않는 열람 기록은 없는 것과 같다.** */
  it('writes who opened it, whose it was and why', async () => {
    await open(operator, subjectId, '환불 문의 확인')

    const [row] = await db.query<{ actorId: string; subjectId: string; reason: string }>(
      `SELECT "actorId", "subjectId", "reason" FROM "PersonalDataAccess"`,
    )

    expect(row).toEqual({
      actorId: operator.userId,
      subjectId,
      reason: '환불 문의 확인',
    })
  })

  it('records every opening, not just the first', async () => {
    await open(operator, subjectId)
    await open(operator, subjectId)

    const rows = await db.query(`SELECT 1 FROM "PersonalDataAccess"`)

    // 한 번 본 것과 두 번 본 것이 달라야 한다 — 그것이 이 기록의 요점이다.
    expect(rows).toHaveLength(2)
  })

  it('refuses to open without a reason', async () => {
    expect(
      await failure(
        client(operator).request({
          path: `/admin/users/${subjectId}/views`,
          method: 'POST',
          body: { reason: '   ' },
          schema: adminUserDetailResponseSchema,
        }),
      ),
    ).toBe(400)
  })

  /** 자기 정보를 보는 것은 감사 대상이 아니다 (`PersonalDataAccess_not_self_check`). */
  it('does not log an admin opening their own row', async () => {
    await open(operator, operator.userId)

    expect(await db.query(`SELECT 1 FROM "PersonalDataAccess"`)).toEqual([])
  })

  it('summarises what the member did, as numbers only', async () => {
    const { user } = await open(operator, subjectId)

    expect(user.stats).toEqual({
      orderCount: 0,
      paidAmount: 0,
      reviewCount: 0,
      questionCount: 0,
      pointBalance: 0,
      couponCount: 0,
    })
  })
})

describe('정지 (F4)', () => {
  it('stores the reason with the suspension', async () => {
    await suspend(superAdmin, subjectId, '반복 신고 누적')

    const { user } = await open(operator, subjectId)

    expect(user.suspendedAt).not.toBeNull()
    expect(user.suspendedReason).toBe('반복 신고 누적')
  })

  /** 사유 없는 정지는 **해제할 근거도 없다.** 계약과 DB 가 함께 막는다. */
  it('refuses a suspension with no reason', async () => {
    expect(
      await failure(
        client(superAdmin).request({
          path: `/admin/users/${subjectId}/suspension`,
          method: 'POST',
          body: {},
          schema: z.unknown(),
        }),
      ),
    ).toBe(400)
  })

  /**
   * **세션도 끊는다.** 칸만 세우면 이미 로그인해 있는 사람은 토큰이 살아 있는 동안
   * 그대로 쓰고, 그러면 정지가 「다음 로그인부터」가 된다.
   */
  it('throws away the refresh tokens it finds', async () => {
    await db.execute(
      `INSERT INTO "RefreshToken" ("id", "userId", "app", "tokenHash", "expiresAt")
       VALUES (gen_random_uuid(), $1, 'SHOP'::"ClientApp", 'hash', now() + interval '30 days')`,
      [subjectId],
    )

    await suspend(superAdmin, subjectId)

    expect(await db.query(`SELECT 1 FROM "RefreshToken" WHERE "userId" = $1`, [subjectId])).toEqual(
      [],
    )
  })

  /**
   * **F4 가 재려는 것은 칸이 아니라 로그인이다.**
   *
   * 칸만 세우고 로그인 경로가 그것을 안 보면, 정지된 사람은 다음 날 그냥 다시
   * 들어온다 — 그리고 어느 검사도 빨개지지 않는다. 갱신 경로가 주인을 찾는 자리를
   * 직접 걸어 확인한다.
   */
  it('stops the account from getting a session again', async () => {
    const owner = await createUser(db, { googleSub: 'suspended-sub' })

    await suspend(superAdmin, owner.id)

    const [found] = await db.query<{ id: string }>(
      `SELECT "id" FROM "User" WHERE "id" = $1 AND "deletedAt" IS NULL AND "suspendedAt" IS NULL`,
      [owner.id],
    )

    // 로그인·갱신 두 경로가 **이 조건으로** 주인을 찾는다
    // (`session.service.ts` · `google-auth.service.ts`). 여기서 못 찾히면 못 들어온다.
    expect(found).toBeUndefined()
  })

  it('lifts a suspension and clears its reason', async () => {
    await suspend(superAdmin, subjectId)
    await client(superAdmin).request({
      path: `/admin/users/${subjectId}/suspension`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    const { user } = await open(operator, subjectId)

    expect(user).toMatchObject({ suspendedAt: null, suspendedReason: null })
  })

  /**
   * **0줄을 한 가지로 답하지 않는다.**
   *
   * 「그런 회원이 없다」와 「다른 관리자가 방금 정지시켰다」는 다른 사실이고, 사람이
   * 할 일도 다르다 — 앞은 잘못 찾은 것이고 뒤는 목록을 다시 읽으면 되는 것이다.
   * 둘 다 404 로 답하면 화면은 그 둘을 구별해 말할 방법이 없다.
   */
  it('tells "already suspended" apart from "no such member"', async () => {
    await suspend(superAdmin, subjectId)

    expect(await failure(suspend(superAdmin, subjectId))).toBe(409)
    expect(await failure(suspend(superAdmin, '0192f0c1-0000-7000-8000-0000000000ff'))).toBe(404)
  })

  it('says the same about lifting a suspension that is not there', async () => {
    expect(
      await failure(
        client(superAdmin).request({
          path: `/admin/users/${subjectId}/suspension`,
          method: 'DELETE',
          schema: z.unknown(),
        }),
      ),
    ).toBe(409)
  })
})

describe('적립금 조정 (F5)', () => {
  it('refuses an adjustment with no reason, and a zero one', async () => {
    expect(await failure(adjust(superAdmin, subjectId, 1_000, '  '))).toBe(400)
    expect(await failure(adjust(superAdmin, subjectId, 0))).toBe(400)
  })

  it('writes the movement to the ledger with the reason', async () => {
    const answer = await adjust(superAdmin, subjectId, 5_000, '배송 지연 보상')

    expect(answer).toEqual({ balance: 5_000, applied: 5_000 })

    const [row] = await db.query<{ type: string; amount: number; reason: string }>(
      `SELECT t."type"::text AS "type", t."amount", t."reason"
         FROM "PointTransaction" t
         JOIN "PointAccount" a ON a."id" = t."accountId"
        WHERE a."userId" = $1`,
      [subjectId],
    )

    expect(row?.type).toBe('ADJUST')
    expect(row?.amount).toBe(5_000)
    expect(row?.reason).toContain('배송 지연 보상')
  })

  /**
   * **음수 잔액을 만들지 않는다.** 마이너스로 두면 그 사람은 다음에 적립받는 만큼을
   * 잃는데 그 사실을 아무 화면도 설명하지 못한다.
   */
  it('takes only as much as there is', async () => {
    await adjust(superAdmin, subjectId, 3_000)

    const answer = await adjust(superAdmin, subjectId, -10_000, '오지급 회수')

    expect(answer).toEqual({ balance: 0, applied: -3_000 })
  })
})

describe('권한 (F8)', () => {
  it('refuses a buyer, whose user.read is narrowed to their own row', async () => {
    expect(await failure(list(buyer))).toBe(403)
  })

  /**
   * 데모 관리자는 `user.write` 를 **아예 갖고 있지 않다** (`permission-matrix.md`).
   * 그래서 읽기는 되고 쓰기는 라우트에서 막힌다 (D-058).
   */
  /** 운영자도 회원을 멈추지는 못한다 — 그 선은 최고관리자에게만 있다. */
  it('refuses an operator the writes only a super admin has', async () => {
    expect(await failure(suspend(operator, subjectId))).toBe(403)
    expect(await failure(adjust(operator, subjectId, 1_000))).toBe(403)
  })

  it('lets a demo admin read but not suspend', async () => {
    const demoAdmin: TestCaller = {
      userId: (await createUser(db, { isDemo: true })).id,
      roles: ['DEMO_ADMIN'],
    }

    await expect(list(demoAdmin)).resolves.toBeDefined()
    expect(await failure(suspend(demoAdmin, subjectId))).toBe(403)
    expect(await failure(adjust(demoAdmin, subjectId, 1_000))).toBe(403)
  })
})
