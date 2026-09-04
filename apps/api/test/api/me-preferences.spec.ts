import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  DEFAULT_USER_PREFERENCE,
  profileResponseSchema,
  userPreferenceResponseSchema,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * Display and notification settings over real HTTP (TASK-0111 F4 · F4b · F7 · A2).
 *
 * The row is created on first write and never on read, so two things have to be
 * true at once: an account that has never touched its settings gets an answer
 * anyway, and that answer is the same one the columns would have produced. F4b
 * is what pins the second — a drift there would silently change a setting the
 * first time somebody saves.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

async function anAccount(): Promise<TestCaller> {
  const user = await createUser(db)

  await db.execute(
    `INSERT INTO "UserRole" ("id", "userId", "role") VALUES (gen_random_uuid(), $1, 'BUYER')`,
    [user.id],
  )

  return { userId: user.id, roles: ['BUYER'] }
}

function as(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

function read(caller: TestCaller): Promise<unknown> {
  return as(caller).request({ path: '/me/preferences', schema: userPreferenceResponseSchema })
}

function write(caller: TestCaller, body: unknown): Promise<unknown> {
  return as(caller).request({
    path: '/me/preferences',
    method: 'PATCH',
    body,
    schema: userPreferenceResponseSchema,
  })
}

async function failureStatus(work: Promise<unknown>): Promise<ApiClientError> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return error
}

function storedRows(userId: string): Promise<number> {
  return db
    .one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "UserPreference" WHERE "userId" = $1',
      [userId],
    )
    .then((row) => row.count)
}

describe('밀도 승격 (F4)', () => {
  it('저장한 밀도가 다른 세션에서도 같은 값으로 나온다', async () => {
    const caller = await anAccount()

    await write(caller, { density: 'MAXIMAL' })

    // A different client object: a fresh `fetch`, a fresh cookie jar, nothing
    // carried over from the call that wrote. The value has to come from the
    // server or this passes for the wrong reason.
    const elsewhere = userPreferenceResponseSchema.parse(await read(caller))

    expect(elsewhere.preference.density).toBe('MAXIMAL')
  })

  it('첫 저장에서 설정 행이 만들어진다', async () => {
    const caller = await anAccount()

    expect(await storedRows(caller.userId)).toBe(0)

    await write(caller, { density: 'MINIMAL' })

    expect(await storedRows(caller.userId)).toBe(1)
  })

  it('조회는 행을 만들지 않는다', async () => {
    // A GET that writes breaks against a read replica or a narrowed grant, and
    // turns "look at my settings" into a write in the audit trail.
    const caller = await anAccount()

    await read(caller)
    await read(caller)

    expect(await storedRows(caller.userId)).toBe(0)
  })
})

describe('설정 기본값이 컬럼 기본값과 같다 (F4b)', () => {
  it('행이 없는 계정과 빈 행을 가진 계정이 같은 값을 받는다', async () => {
    const without = await anAccount()
    const withEmptyRow = await anAccount()

    // Inserted with raw SQL so the database — not Prisma, not the service —
    // supplies every default.
    await db.execute(`INSERT INTO "UserPreference" ("userId", "updatedAt") VALUES ($1, now())`, [
      withEmptyRow.userId,
    ])

    const fromDefaults = userPreferenceResponseSchema.parse(await read(without))
    const fromColumns = userPreferenceResponseSchema.parse(await read(withEmptyRow))

    expect(fromDefaults.preference).toEqual(fromColumns.preference)
    expect(fromColumns.preference).toEqual(DEFAULT_USER_PREFERENCE)
  })

  it('GET /me 가 싣는 설정도 같은 값이다', async () => {
    const caller = await anAccount()

    const bundled = profileResponseSchema.parse(
      await as(caller).request({ path: '/me', schema: profileResponseSchema }),
    )

    expect(bundled.preference).toEqual(DEFAULT_USER_PREFERENCE)
  })
})

describe('알림 설정 (F7)', () => {
  it('마케팅 수신을 껐다 켰다 할 수 있고 나머지는 그대로다', async () => {
    const caller = await anAccount()

    await write(caller, { notifyMarketing: true })
    expect(userPreferenceResponseSchema.parse(await read(caller)).preference).toMatchObject({
      notifyMarketing: true,
      notifyOrder: true,
      notifyClaim: true,
    })

    await write(caller, { notifyMarketing: false })
    expect(userPreferenceResponseSchema.parse(await read(caller)).preference.notifyMarketing).toBe(
      false,
    )
  })

  it('한 필드만 보내면 나머지 필드는 건드리지 않는다', async () => {
    const caller = await anAccount()

    await write(caller, { density: 'MAXIMAL', notifyClaim: false })
    await write(caller, { notifyOrder: false })

    expect(userPreferenceResponseSchema.parse(await read(caller)).preference).toEqual({
      ...DEFAULT_USER_PREFERENCE,
      density: 'MAXIMAL',
      notifyClaim: false,
      notifyOrder: false,
    })
  })
})

describe('입력 검증 (A2)', () => {
  it('알 수 없는 밀도값을 400 으로 거절하고 어느 필드인지 말한다', async () => {
    const caller = await anAccount()

    const refused = await failureStatus(write(caller, { density: 'HUGE' }))

    expect(refused.status).toBe(400)
    expect(refused.body?.error.details).toContainEqual(
      expect.objectContaining({ field: 'density', code: 'INVALID' }),
    )
  })

  it('통화 코드는 세 글자여야 한다', async () => {
    const caller = await anAccount()

    const refused = await failureStatus(write(caller, { currency: 'WON!' }))

    expect(refused.status).toBe(400)
    expect(refused.body?.error.details).toContainEqual(
      expect.objectContaining({ field: 'currency' }),
    )
  })

  it('거절된 요청은 아무것도 저장하지 않는다', async () => {
    const caller = await anAccount()

    await failureStatus(write(caller, { density: 'HUGE' }))

    expect(await storedRows(caller.userId)).toBe(0)
  })
})
