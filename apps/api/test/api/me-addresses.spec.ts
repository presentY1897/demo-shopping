import { randomUUID } from 'node:crypto'

import type { ApiClient, Role } from '@shopping/shared'
import { addressListResponseSchema, addressResponseSchema, ApiClientError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { deniedMessage } from '../../src/auth/access-denied.js'
import { useApiApp } from '../support/api-app.js'
import { concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * The address book over real HTTP, against this worker's real database
 * (TASK-0111 F2 · F3 · F3b · F3d · F6 · A2 · A3 · A4).
 *
 * The invariant this task exists for — **exactly one default while there are
 * addresses** — is asserted against the database itself after every operation,
 * not against the response body. A service that answered correctly while leaving
 * two defaults behind would pass every assertion about its own output.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

async function anAccount(roles: readonly Role[] = ['BUYER']): Promise<TestCaller> {
  const user = await createUser(db)

  for (const role of roles) {
    await db.execute(
      `INSERT INTO "UserRole" ("id", "userId", "role") VALUES (gen_random_uuid(), $1, $2::"Role")`,
      [user.id, role],
    )
  }

  return { userId: user.id, roles }
}

function as(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

interface AddressBody {
  readonly label?: string | null
  readonly recipientName?: string
  readonly phone?: string
  readonly postalCode?: string
  readonly addressLine1?: string
  readonly addressLine2?: string | null
  readonly isDefault?: boolean
}

/** A valid address, stating only what a test is about. */
function anAddress(overrides: AddressBody = {}): AddressBody {
  return {
    label: '집',
    recipientName: '김수령',
    phone: '010-1234-5678',
    postalCode: '06234',
    addressLine1: '서울시 강남구 테헤란로 1',
    addressLine2: '101동 1001호',
    ...overrides,
  }
}

function create(caller: TestCaller, body: AddressBody = anAddress()): Promise<unknown> {
  return as(caller).request({
    path: '/me/addresses',
    method: 'POST',
    body,
    schema: addressResponseSchema,
  })
}

async function createId(caller: TestCaller, body: AddressBody = anAddress()): Promise<string> {
  return addressResponseSchema.parse(await create(caller, body)).address.id
}

function list(caller: TestCaller): Promise<unknown> {
  return as(caller).request({ path: '/me/addresses', schema: addressListResponseSchema })
}

function makeDefault(caller: TestCaller, id: string): Promise<unknown> {
  return as(caller).request({
    path: `/me/addresses/${id}/default`,
    method: 'POST',
    schema: addressResponseSchema,
  })
}

function patch(caller: TestCaller, id: string, body: unknown): Promise<unknown> {
  return as(caller).request({
    path: `/me/addresses/${id}`,
    method: 'PATCH',
    body,
    schema: addressResponseSchema,
  })
}

function remove(caller: TestCaller, id: string): Promise<unknown> {
  return as(caller).request({
    path: `/me/addresses/${id}`,
    method: 'DELETE',
    schema: addressResponseSchema,
  })
}

async function failure(work: Promise<unknown>): Promise<ApiClientError> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return error
}

/** What the database says, which is the only thing that settles the invariant. */
function defaultsOf(userId: string): Promise<{ count: number; id: string | null }> {
  return db.one<{ count: number; id: string | null }>(
    `SELECT count(*)::int AS count, max("id"::text) AS id
       FROM "Address" WHERE "userId" = $1 AND "isDefault"`,
    [userId],
  )
}

function storedCount(userId: string): Promise<number> {
  return db
    .one<{ count: number }>('SELECT count(*)::int AS count FROM "Address" WHERE "userId" = $1', [
      userId,
    ])
    .then((row) => row.count)
}

describe('배송지 추가와 목록 (F2)', () => {
  it('3건을 저장하면 3건이 나온다', async () => {
    const caller = await anAccount()

    await create(caller, anAddress({ label: '집' }))
    await create(caller, anAddress({ label: '회사' }))
    await create(caller, anAddress({ label: '본가' }))

    // Parsed with the schema TASK-0112 will build its mocks from (C3).
    const { items } = addressListResponseSchema.parse(await list(caller))

    expect(items).toHaveLength(3)
    expect(items.map((item) => item.label).sort()).toEqual(['본가', '집', '회사'])
  })

  it('첫 배송지는 요청하지 않아도 기본이 된다', async () => {
    // The state the partial index cannot forbid: addresses on file and no
    // default for checkout to preselect.
    const caller = await anAccount()

    const { address } = addressResponseSchema.parse(
      await create(caller, anAddress({ isDefault: false })),
    )

    expect(address.isDefault).toBe(true)
    expect((await defaultsOf(caller.userId)).count).toBe(1)
  })

  it('두 번째부터는 요청한 대로다', async () => {
    const caller = await anAccount()

    await create(caller)
    const { address } = addressResponseSchema.parse(await create(caller))

    expect(address.isDefault).toBe(false)
    expect((await defaultsOf(caller.userId)).count).toBe(1)
  })

  it('isDefault 로 만들면 이전 기본이 같은 트랜잭션에서 풀린다', async () => {
    const caller = await anAccount()
    const first = await createId(caller)

    const second = await createId(caller, anAddress({ isDefault: true }))

    const defaults = await defaultsOf(caller.userId)
    expect(defaults.count).toBe(1)
    expect(defaults.id).toBe(second)
    expect(defaults.id).not.toBe(first)
  })

  it('목록은 기본 먼저, 그다음 최근 순이다', async () => {
    const caller = await anAccount()
    const first = await createId(caller, anAddress({ label: '첫째' }))
    await createId(caller, anAddress({ label: '둘째' }))
    const third = await createId(caller, anAddress({ label: '셋째' }))

    await makeDefault(caller, first)

    const { items } = addressListResponseSchema.parse(await list(caller))

    expect(items[0]?.id).toBe(first)
    expect(items[1]?.id).toBe(third)
    expect(items.map((item) => item.label)).toEqual(['첫째', '셋째', '둘째'])
  })

  it('남의 배송지는 목록에 섞이지 않는다', async () => {
    const mine = await anAccount()
    const theirs = await anAccount()

    await create(mine)
    await create(theirs)
    await create(theirs)

    expect(addressListResponseSchema.parse(await list(mine)).items).toHaveLength(1)
  })
})

describe('배송지 수정', () => {
  it('보낸 필드만 바뀐다', async () => {
    const caller = await anAccount()
    const id = await createId(caller)

    const { address } = addressResponseSchema.parse(
      await patch(caller, id, { recipientName: '박수령' }),
    )

    expect(address.recipientName).toBe('박수령')
    expect(address.postalCode).toBe('06234')
    expect(address.label).toBe('집')
  })

  it('수정으로는 기본 배송지를 바꿀 수 없다', async () => {
    // `isDefault` is not in the update schema: promotion has to clear the
    // previous default first, and a partial update cannot carry that.
    const caller = await anAccount()
    const first = await createId(caller)
    const second = await createId(caller)

    await patch(caller, second, { isDefault: true })

    expect((await defaultsOf(caller.userId)).id).toBe(first)
  })
})

describe('기본 배송지 전환 (F3)', () => {
  it('다른 배송지를 기본으로 지정하면 이전 기본이 풀린다', async () => {
    const caller = await anAccount()
    const first = await createId(caller)
    const second = await createId(caller)

    const { address } = addressResponseSchema.parse(await makeDefault(caller, second))

    expect(address.isDefault).toBe(true)

    const defaults = await defaultsOf(caller.userId)
    expect(defaults.count).toBe(1)
    expect(defaults.id).toBe(second)
    expect(defaults.id).not.toBe(first)
  })

  it('이미 기본인 배송지를 다시 지정해도 멱등이다', async () => {
    const caller = await anAccount()
    const only = await createId(caller)

    await makeDefault(caller, only)
    const { address } = addressResponseSchema.parse(await makeDefault(caller, only))

    expect(address.isDefault).toBe(true)
    expect((await defaultsOf(caller.userId)).count).toBe(1)
  })
})

describe('기본 배송지 동시 지정 (F3b · A7)', () => {
  /**
   * Waits until `count` statements are blocked on a lock in this database.
   *
   * The overlap is arranged rather than hoped for. Without this the two requests
   * might not actually compete — and "one of them failed" passes just as happily
   * when they ran one after the other, which proves nothing (QUALITY-GATES A7).
   */
  async function untilBlocked(count: number): Promise<void> {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const { blocked } = await db.one<{ blocked: number }>(
        `SELECT count(*)::int AS blocked
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
            AND wait_event_type = 'Lock'`,
      )

      if (blocked >= count) return

      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
    }

    throw new Error(`요청 ${String(count)}개가 잠금에서 만나지 않았습니다.`)
  }

  it('둘이 동시에 오면 하나만 성공하고 기본은 1건으로 남는다', async () => {
    const caller = await anAccount()
    const first = await createId(caller)
    const second = await createId(caller)
    const third = await createId(caller)

    const results = await db.withConnection(async (holder) => {
      // Holds the row both requests must clear before they may set their own,
      // so neither can finish before the other has started.
      await holder.query('BEGIN')
      await holder.query('SELECT "id" FROM "Address" WHERE "id" = $1 FOR UPDATE', [first])

      const race = concurrently(2, async (index) =>
        makeDefault(caller, index === 0 ? second : third),
      )

      await untilBlocked(2)
      await holder.query('COMMIT')

      return race
    })

    expect(fulfilled(results)).toHaveLength(1)
    expect(rejected(results)).toHaveLength(1)

    const loser = rejected(results)[0]
    expect(loser).toBeInstanceOf(ApiClientError)
    // 409, not 500: the index refused a second live default and the API says so
    // in a way a screen can act on — re-read the list, ask again.
    expect((loser as ApiClientError).status).toBe(409)

    const defaults = await defaultsOf(caller.userId)
    expect(defaults.count).toBe(1)
    expect([second, third]).toContain(defaults.id)
  })
})

describe('기본 배송지 삭제와 승격 (F3d · R3)', () => {
  it('기본을 지우면 남은 것 중 가장 최근 생성분이 승격한다', async () => {
    const caller = await anAccount()
    const oldest = await createId(caller)
    const middle = await createId(caller)
    const newest = await createId(caller)

    // `oldest` is the default — it was the first one saved.
    expect((await defaultsOf(caller.userId)).id).toBe(oldest)

    await remove(caller, oldest)

    const defaults = await defaultsOf(caller.userId)
    expect(defaults.count).toBe(1)
    expect(defaults.id).toBe(newest)
    expect(defaults.id).not.toBe(middle)
  })

  it('기본이 아닌 것을 지우면 기본은 그대로다', async () => {
    const caller = await anAccount()
    const primary = await createId(caller)
    const spare = await createId(caller)

    await remove(caller, spare)

    expect(await storedCount(caller.userId)).toBe(1)
    expect((await defaultsOf(caller.userId)).id).toBe(primary)
  })

  it('마지막 한 건을 지우면 기본도 없다', async () => {
    const caller = await anAccount()
    const only = await createId(caller)

    const { address } = addressResponseSchema.parse(await remove(caller, only))

    expect(address.id).toBe(only)
    expect(await storedCount(caller.userId)).toBe(0)
    expect((await defaultsOf(caller.userId)).count).toBe(0)
  })
})

describe('남의 배송지 (F6)', () => {
  it('다른 사용자의 배송지 id 로 수정하면 403 이다', async () => {
    const mine = await anAccount()
    const theirs = await anAccount()
    const foreign = await createId(theirs)

    const refused = await failure(patch(mine, foreign, { recipientName: '탈취' }))

    expect(refused.status).toBe(403)
    expect(refused.body?.error.details).toContain(deniedMessage('profile.write', 'out_of_scope'))
  })

  it('삭제와 기본 지정도 마찬가지다', async () => {
    const mine = await anAccount()
    const theirs = await anAccount()
    const foreign = await createId(theirs)

    expect((await failure(remove(mine, foreign))).status).toBe(403)
    expect((await failure(makeDefault(mine, foreign))).status).toBe(403)
    expect(await storedCount(theirs.userId)).toBe(1)
  })

  it('profile.write:any 를 가진 ADMIN_SUPER 도 403 이다', async () => {
    // The scope check alone would let this through — `/me` would then be an
    // administrative path for exactly one role, which is the failure R4 names.
    const superAdmin = await anAccount(['ADMIN_SUPER'])
    const theirs = await anAccount()
    const foreign = await createId(theirs)

    const refused = await failure(patch(superAdmin, foreign, { recipientName: '관리자' }))

    expect(refused.status).toBe(403)
    expect(refused.body?.error.details).toContain(deniedMessage('profile.write', 'out_of_scope'))
  })

  it('없는 배송지는 404 다', async () => {
    const caller = await anAccount()

    expect((await failure(patch(caller, randomUUID(), { label: '집' }))).status).toBe(404)
  })

  it('배송지 id 가 UUID 가 아니면 400 이다', async () => {
    const caller = await anAccount()

    const refused = await failure(patch(caller, 'not-a-uuid', { label: '집' }))

    expect(refused.status).toBe(400)
    expect(refused.body?.error.details).toContainEqual(expect.objectContaining({ field: 'id' }))
  })
})

describe('입력 검증과 권한 (A2 · A3 · A4)', () => {
  it('우편번호가 4자리면 400 이고 어느 필드인지 말한다', async () => {
    const caller = await anAccount()

    const refused = await failure(create(caller, anAddress({ postalCode: '0623' })))

    expect(refused.status).toBe(400)
    expect(refused.body?.error.details).toContainEqual(
      expect.objectContaining({ field: 'postalCode', code: 'INVALID' }),
    )
    expect(await storedCount(caller.userId)).toBe(0)
  })

  it('전화번호 형식이 아니면 400 이다', async () => {
    const caller = await anAccount()

    const refused = await failure(create(caller, anAddress({ phone: '01012345678900' })))

    expect(refused.status).toBe(400)
    expect(refused.body?.error.details).toContainEqual(expect.objectContaining({ field: 'phone' }))
  })

  it('profile.write 가 없는 운영자는 배송지를 추가하지 못한다', async () => {
    const operator = await anAccount(['ADMIN_OPERATOR'])

    const refused = await failure(create(operator))

    expect(refused.status).toBe(403)
    expect(refused.body?.error.details).toContain(
      deniedMessage('profile.write', 'missing_permission'),
    )
  })

  it('토큰 없이 목록을 부르면 401 이다', async () => {
    const refused = await failure(
      api.client.request({ path: '/me/addresses', schema: addressListResponseSchema }),
    )

    expect(refused.status).toBe(401)
    expect(refused.code).toBe('AUTH_REQUIRED')
  })
})
