import { PATH_METADATA } from '@nestjs/common/constants'
import type { ApiClient, Role } from '@shopping/shared'
import { ApiClientError, profileResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { deniedMessage } from '../../src/auth/access-denied.js'
import { AddressController } from '../../src/profile/address.controller.js'
import { MeController } from '../../src/profile/me.controller.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * `GET · PATCH /me` over real HTTP, against this worker's real database
 * (TASK-0111 F1 · F10 · A2 · A3 · A4).
 *
 * Everything goes through `createApiClient` from `@shopping/shared`, which
 * parses each response with `profileResponseSchema` — the object TASK-0112 will
 * build its mocks from. Gate C3 therefore holds structurally: a renamed or
 * missing field fails here whether or not an assertion happens to mention it.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** An account that really exists, with the roles it really holds. */
async function anAccount(
  roles: readonly Role[] = ['BUYER'],
  options: { readonly name?: string } = {},
): Promise<TestCaller> {
  const user = await createUser(db, { name: options.name ?? '김구매' })

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

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
  readonly message: string
}

/** Asserts the call failed over HTTP and returns the shared error envelope. */
async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    details: error.body?.error.details ?? [],
    message: error.body?.error.message ?? '',
  }
}

function getMe(caller: TestCaller): Promise<unknown> {
  return as(caller).request({ path: '/me', schema: profileResponseSchema })
}

function patchMe(caller: TestCaller, body: unknown): Promise<unknown> {
  return as(caller).request({
    path: '/me',
    method: 'PATCH',
    body,
    schema: profileResponseSchema,
  })
}

describe('프로필 조회와 수정 (F1)', () => {
  it('수정한 이름이 다시 조회했을 때 반영되어 있다', async () => {
    const caller = await anAccount(['BUYER'], { name: '김구매' })

    const updated = await patchMe(caller, { name: '이수정' })
    const reread = await getMe(caller)

    expect(profileResponseSchema.parse(updated).profile.name).toBe('이수정')
    expect(profileResponseSchema.parse(reread).profile.name).toBe('이수정')
  })

  it('아바타를 설정했다가 지울 수 있다', async () => {
    const caller = await anAccount()

    await patchMe(caller, { avatarUrl: 'https://cdn.example.com/a.png' })
    expect(profileResponseSchema.parse(await getMe(caller)).profile.avatarUrl).toBe(
      'https://cdn.example.com/a.png',
    )

    // `null` clears it; `undefined` — an omitted key — leaves it alone. The two
    // have to mean different things or a form can never remove a picture.
    await patchMe(caller, { avatarUrl: null })
    expect(profileResponseSchema.parse(await getMe(caller)).profile.avatarUrl).toBeNull()
  })

  it('빈 본문은 아무것도 바꾸지 않는다', async () => {
    const caller = await anAccount(['BUYER'], { name: '김구매' })

    const answered = await patchMe(caller, {})

    expect(profileResponseSchema.parse(answered).profile.name).toBe('김구매')
  })

  it('역할은 토큰이 아니라 저장된 행에서 온다', async () => {
    // The header resolver would happily claim anything; what `/me` answers has
    // to be what the account actually holds.
    const caller = await anAccount(['BUYER', 'SELLER_OWNER'])
    const liar: TestCaller = { userId: caller.userId, roles: ['BUYER', 'ADMIN_SUPER'] }

    expect(profileResponseSchema.parse(await getMe(liar)).profile.roles).toEqual([
      'BUYER',
      'SELLER_OWNER',
    ])
  })

  it('이메일과 함께 설정도 한 번에 답한다', async () => {
    const caller = await anAccount()
    const body = profileResponseSchema.parse(await getMe(caller))

    expect(body.profile.id).toBe(caller.userId)
    expect(body.preference.density).toBe('STANDARD')
  })
})

describe('/me 에는 남의 것을 요청할 방법이 없다 (F10)', () => {
  it('사용자 식별자를 받는 경로가 하나도 없다', () => {
    const controllers = [MeController, AddressController]
    const paths = controllers.flatMap((controller) => {
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string
      const prototype = controller.prototype as object

      return Object.getOwnPropertyNames(prototype)
        .filter((name) => name !== 'constructor')
        .map((name) => Object.getOwnPropertyDescriptor(prototype, name)?.value as unknown)
        .filter((handler): handler is object => typeof handler === 'function')
        .map((handler) => Reflect.getMetadata(PATH_METADATA, handler) as string | undefined)
        .filter((path): path is string => path !== undefined)
        .map((path) => `${base}/${path}`)
    })

    expect(paths.length).toBeGreaterThan(0)
    expect(paths.filter((path) => /user/i.test(path))).toEqual([])
  })

  it('본문에 남의 userId 를 실어도 그 계정은 그대로다', async () => {
    const mine = await anAccount()
    const theirs = await anAccount(['BUYER'], { name: '남의계정' })

    await patchMe(mine, { name: '내이름', userId: theirs.userId })

    const untouched = profileResponseSchema.parse(await getMe(theirs))
    expect(untouched.profile.name).toBe('남의계정')
  })
})

describe('입력 검증 (A2)', () => {
  it('빈 이름을 400 으로 거절하고 어느 필드인지 말한다', async () => {
    const caller = await anAccount()

    const refused = await failure(patchMe(caller, { name: '   ' }))

    expect(refused.status).toBe(400)
    expect(refused.details).toContainEqual(
      expect.objectContaining({ field: 'name', code: 'INVALID' }),
    )
  })

  it('URL 이 아닌 아바타를 거절한다', async () => {
    const caller = await anAccount()

    const refused = await failure(patchMe(caller, { avatarUrl: '이미지' }))

    expect(refused.status).toBe(400)
    expect(refused.details).toContainEqual(expect.objectContaining({ field: 'avatarUrl' }))
  })
})

describe('권한과 인증 (A3 · A4)', () => {
  it('profile.write 가 없는 운영자는 자기 프로필도 고치지 못한다', async () => {
    // Not an oversight: `profile.*` is granted to BUYER and SELLER_OWNER only,
    // and only ADMIN_SUPER picks it up through the "holds everything" rule
    // (TASK-0111 4장 R5). An operator can read accounts and edit none.
    const operator = await anAccount(['ADMIN_OPERATOR'])

    const refused = await failure(patchMe(operator, { name: '운영자' }))

    expect(refused.status).toBe(403)
    expect(refused.details).toContain(deniedMessage('profile.write', 'missing_permission'))
  })

  it('운영자도 조회는 된다', async () => {
    const operator = await anAccount(['ADMIN_OPERATOR'], { name: '운영자' })

    expect(profileResponseSchema.parse(await getMe(operator)).profile.name).toBe('운영자')
  })

  it('토큰 없이 부르면 401 이다', async () => {
    const refused = await failure(
      api.client.request({ path: '/me', schema: profileResponseSchema }),
    )

    expect(refused.status).toBe(401)
    expect(refused.code).toBe('AUTH_REQUIRED')
  })

  it('탈퇴한 계정의 토큰은 404 를 받는다', async () => {
    const caller = await anAccount()
    await db.execute('UPDATE "User" SET "deletedAt" = now() WHERE "id" = $1', [caller.userId])

    expect((await failure(getMe(caller))).status).toBe(404)
  })
})
