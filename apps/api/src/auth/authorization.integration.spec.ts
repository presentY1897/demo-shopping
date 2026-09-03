import 'reflect-metadata'

import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { INestApplication } from '@nestjs/common'
import { Body, Controller, Get, Injectable, Module, Post, VersioningType } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core'
import type { ApiErrorBody, ResourceOwnership, Role } from '@shopping/shared'
import { apiErrorSchema, isRole, platformOwnership } from '@shopping/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AllExceptionsFilter } from '../common/all-exceptions.filter.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { UserRolesController } from '../users/user-roles.controller.js'
import { UserRolesService } from '../users/user-roles.service.js'
import { assertResourceAccess } from './access-denied.js'
import { PermissionGuard } from './permission.guard.js'
import type { PrincipalResolver } from './principal-resolver.js'
import { PRINCIPAL_RESOLVER } from './principal-resolver.js'
import { Principal } from './principal.decorator.js'
import { PublicEndpoint } from './public-endpoint.decorator.js'
import { RequirePermission } from './require-permission.decorator.js'
import type { RequestPrincipal } from './request-principal.js'

/**
 * The authorization stack over real HTTP: guard, scope check, exception filter
 * and error envelope, exactly as `main.ts` wires them.
 *
 * Authentication does not exist yet (TASK-0021/0022), so the principal comes
 * from a resolver that reads test headers — the same seam the JWT resolver will
 * occupy. That substitution is the whole reason the seam exists: refusing to
 * verify 403 until authentication ships would leave the most security-relevant
 * code in the repository untested for several tasks.
 */

const BUYER = '0192f0c1-0000-7000-8000-000000000001'
const SELLER = '0192f0c1-0000-7000-8000-000000000002'
const OPERATOR = '0192f0c1-0000-7000-8000-000000000003'
const SUPER = '0192f0c1-0000-7000-8000-000000000004'
const DEMO_ADMIN = '0192f0c1-0000-7000-8000-000000000005'
const DEMO_MEMBER = '0192f0c1-0000-7000-8000-000000000006'
const UNKNOWN = '0192f0c1-0000-7000-8000-00000000ffff'

const SELLER_STORE = 'store-seller'
const DEMO_STORE = 'store-demo'

/** A row the fixture controller pretends to have loaded from the database. */
function ownership(body: unknown): ResourceOwnership {
  const value = body as Partial<ResourceOwnership> | undefined

  return {
    ownerUserId: value?.ownerUserId ?? null,
    ownerSellerId: value?.ownerSellerId ?? null,
    ownerIsDemo: value?.ownerIsDemo ?? false,
  }
}

@Controller({ path: 'fixtures', version: '1' })
class FixtureController {
  @Get('open')
  @PublicEndpoint()
  open(): { ok: true } {
    return { ok: true }
  }

  /** No decorator, on purpose: the case deny-by-default exists for. */
  @Get('undeclared')
  undeclared(): { ok: true } {
    return { ok: true }
  }

  @Get('catalog')
  @RequirePermission('catalog.read')
  readCatalog(@Principal() principal: RequestPrincipal): { ok: true } {
    assertResourceAccess(principal, 'catalog.read', platformOwnership)

    return { ok: true }
  }

  /** Seed data: owned by the platform, so only an `any` grant reaches it. */
  @Post('catalog')
  @RequirePermission('catalog.write')
  writeCatalog(@Principal() principal: RequestPrincipal): { ok: true } {
    assertResourceAccess(principal, 'catalog.write', platformOwnership)

    return { ok: true }
  }

  @Post('products')
  @RequirePermission('product.write')
  writeProduct(@Principal() principal: RequestPrincipal, @Body() body: unknown): { ok: true } {
    assertResourceAccess(principal, 'product.write', ownership(body))

    return { ok: true }
  }

  @Post('seller-approvals')
  @RequirePermission('seller.approve')
  approveSeller(@Principal() principal: RequestPrincipal, @Body() body: unknown): { ok: true } {
    assertResourceAccess(principal, 'seller.approve', ownership(body))

    return { ok: true }
  }
}

function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]

  return Array.isArray(value) ? value[0] : value
}

/** Stands in for TASK-0022's JWT resolver. Nothing else in the app changes. */
@Injectable()
class HeaderPrincipalResolver implements PrincipalResolver {
  resolve(request: IncomingMessage): Promise<RequestPrincipal | null> {
    const userId = headerOf(request, 'x-test-user')

    if (userId === undefined) return Promise.resolve(null)

    return Promise.resolve({
      userId,
      roles: (headerOf(request, 'x-test-roles') ?? '').split(',').filter(isRole),
      sellerId: headerOf(request, 'x-test-seller') ?? null,
      app: 'admin',
    })
  }
}

interface Account {
  readonly id: string
  readonly isDemo: boolean
  readonly deleted: boolean
  readonly roles: Set<Role>
}

const accounts = new Map<string, Account>()

function seedAccounts(): void {
  accounts.clear()

  for (const [id, isDemo, granted] of [
    [BUYER, false, ['BUYER']],
    [SELLER, false, ['BUYER', 'SELLER_OWNER']],
    [OPERATOR, false, ['ADMIN_OPERATOR']],
    [SUPER, false, ['ADMIN_SUPER']],
    [DEMO_ADMIN, true, ['DEMO_ADMIN']],
    [DEMO_MEMBER, true, ['BUYER']],
  ] as const) {
    accounts.set(id, { id, isDemo, deleted: false, roles: new Set<Role>(granted) })
  }
}

interface RoleWhere {
  readonly where: { readonly id?: string; readonly userId?: string; readonly role?: Role }
}

/** Enough of Prisma for this controller; the suite stays database free. */
const prismaDouble = {
  user: {
    findFirst({ where }: RoleWhere) {
      const account = where.id === undefined ? undefined : accounts.get(where.id)

      if (account === undefined || account.deleted) return Promise.resolve(null)

      return Promise.resolve({
        id: account.id,
        isDemo: account.isDemo,
        roles: [...account.roles].map((role) => ({ role })),
      })
    },
  },
  userRole: {
    createMany({ data }: { data: readonly { userId: string; role: Role }[] }) {
      for (const entry of data) accounts.get(entry.userId)?.roles.add(entry.role)

      return Promise.resolve({ count: data.length })
    },
    deleteMany({ where }: RoleWhere) {
      if (where.userId !== undefined && where.role !== undefined) {
        accounts.get(where.userId)?.roles.delete(where.role)
      }

      return Promise.resolve({ count: 1 })
    },
    findMany({ where }: RoleWhere) {
      const account = where.userId === undefined ? undefined : accounts.get(where.userId)

      return Promise.resolve([...(account?.roles ?? [])].map((role) => ({ role })))
    },
  },
}

@Module({
  controllers: [FixtureController, UserRolesController],
  providers: [
    UserRolesService,
    { provide: PrismaService, useValue: prismaDouble },
    { provide: APP_CONFIG, useValue: { nodeEnv: 'test' } as AppConfig },
    { provide: PRINCIPAL_RESOLVER, useClass: HeaderPrincipalResolver },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class TestModule {}

interface Caller {
  readonly userId: string
  readonly roles: readonly Role[]
  readonly sellerId?: string
}

const callers = {
  buyer: { userId: BUYER, roles: ['BUYER'] },
  seller: { userId: SELLER, roles: ['SELLER_OWNER'], sellerId: SELLER_STORE },
  operator: { userId: OPERATOR, roles: ['ADMIN_OPERATOR'] },
  superAdmin: { userId: SUPER, roles: ['ADMIN_SUPER'] },
  demoAdmin: { userId: DEMO_ADMIN, roles: ['DEMO_ADMIN'] },
} satisfies Record<string, Caller>

let app: INestApplication
let base = ''

interface Answer {
  readonly status: number
  readonly body: unknown
}

async function call(
  method: string,
  path: string,
  options: { as?: Caller; body?: unknown } = {},
): Promise<Answer> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }

  if (options.as !== undefined) {
    headers['x-test-user'] = options.as.userId
    headers['x-test-roles'] = options.as.roles.join(',')
    if (options.as.sellerId !== undefined) headers['x-test-seller'] = options.as.sellerId
  }

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  return { status: response.status, body: await response.json() }
}

/** Asserts the shared envelope and hands back its `error` for inspection. */
function envelopeOf(answer: Answer): ApiErrorBody['error'] {
  const parsed = apiErrorSchema.safeParse(answer.body)

  expect(parsed.success).toBe(true)
  if (!parsed.success) throw new Error('에러 응답이 공통 포맷이 아닙니다.')

  return parsed.data.error
}

beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false })
  app.setGlobalPrefix('/api')
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })

  await app.listen(0, '127.0.0.1')

  const address = (app.getHttpServer() as Server).address() as AddressInfo

  base = `http://127.0.0.1:${String(address.port)}/api/v1`
})

afterAll(async () => {
  await app.close()
})

describe('deny by default over HTTP', () => {
  /**
   * A missing decorator is a bug in our code, not a shortfall in the caller's
   * account, so it is a 500 whose body says nothing about it (TASK-0117 F8).
   * The reason is in the log, where it can be acted on.
   */
  it('blocks an endpoint that declares no permission with an unexplained 500', async () => {
    const answer = await call('GET', '/fixtures/undeclared', { as: callers.superAdmin })

    expect(answer.status).toBe(500)
    expect(envelopeOf(answer)).toMatchObject({ code: 'INTERNAL_ERROR', details: [] })
    expect(JSON.stringify(answer.body)).not.toContain('퍼미션')
  })

  it('serves an endpoint that declares itself public', async () => {
    expect(await call('GET', '/fixtures/open')).toEqual({ status: 200, body: { ok: true } })
  })

  it('answers 401 when nobody could be identified, and says what to do', async () => {
    const answer = await call('POST', '/fixtures/products')

    expect(answer.status).toBe(401)
    expect(envelopeOf(answer).code).toBe('AUTH_REQUIRED')
  })
})

describe('permission refusals', () => {
  it('refuses a buyer the write permission and names it', async () => {
    const answer = await call('POST', '/fixtures/products', {
      as: callers.buyer,
      body: { ownerUserId: BUYER, ownerSellerId: null, ownerIsDemo: false },
    })

    expect(answer.status).toBe(403)
    expect(envelopeOf(answer).details).toEqual(['product.write 퍼미션이 없습니다.'])
  })
})

describe('own scope', () => {
  it('lets a seller edit their own store', async () => {
    const answer = await call('POST', '/fixtures/products', {
      as: callers.seller,
      body: { ownerUserId: SELLER, ownerSellerId: SELLER_STORE, ownerIsDemo: false },
    })

    expect(answer).toEqual({ status: 201, body: { ok: true } })
  })

  it("refuses a seller another store's product", async () => {
    const answer = await call('POST', '/fixtures/products', {
      as: callers.seller,
      body: { ownerUserId: 'someone', ownerSellerId: 'store-rival', ownerIsDemo: false },
    })

    expect(answer.status).toBe(403)
    expect(envelopeOf(answer).details).toEqual([
      'product.write 퍼미션으로 접근할 수 없는 리소스입니다.',
    ])
  })
})

describe('demo scope', () => {
  it('refuses a demo administrator the seed catalogue', async () => {
    const answer = await call('POST', '/fixtures/catalog', { as: callers.demoAdmin })

    expect(answer.status).toBe(403)
    expect(envelopeOf(answer).details).toEqual([
      'catalog.write 퍼미션으로 접근할 수 없는 리소스입니다.',
    ])
  })

  it('refuses a demo administrator the product of a real account', async () => {
    const answer = await call('POST', '/fixtures/products', {
      as: callers.demoAdmin,
      body: { ownerUserId: SELLER, ownerSellerId: SELLER_STORE, ownerIsDemo: false },
    })

    expect(answer.status).toBe(403)
  })

  it('still lets a demo administrator read the seed catalogue', async () => {
    expect(await call('GET', '/fixtures/catalog', { as: callers.demoAdmin })).toEqual({
      status: 200,
      body: { ok: true },
    })
  })

  it('lets a demo administrator edit a product a demo seller created', async () => {
    expect(
      await call('POST', '/fixtures/products', {
        as: callers.demoAdmin,
        body: { ownerUserId: DEMO_MEMBER, ownerSellerId: DEMO_STORE, ownerIsDemo: true },
      }),
    ).toEqual({ status: 201, body: { ok: true } })
  })

  it('lets a demo administrator approve a demo seller, but not a real one', async () => {
    expect(
      await call('POST', '/fixtures/seller-approvals', {
        as: callers.demoAdmin,
        body: { ownerUserId: DEMO_MEMBER, ownerSellerId: DEMO_STORE, ownerIsDemo: true },
      }),
    ).toEqual({ status: 201, body: { ok: true } })

    const real = await call('POST', '/fixtures/seller-approvals', {
      as: callers.demoAdmin,
      body: { ownerUserId: SELLER, ownerSellerId: SELLER_STORE, ownerIsDemo: false },
    })

    expect(real.status).toBe(403)
  })

  it('an operator reaches all of it, which is what `demo` narrows', async () => {
    expect((await call('POST', '/fixtures/catalog', { as: callers.operator })).status).toBe(201)
  })
})

describe('role administration', () => {
  beforeAll(() => {
    seedAccounts()
  })

  it('lets an account read its own roles', async () => {
    expect(await call('GET', `/users/${BUYER}/roles`, { as: callers.buyer })).toEqual({
      status: 200,
      body: { userId: BUYER, roles: ['BUYER'] },
    })
  })

  it("refuses an account another account's roles", async () => {
    const answer = await call('GET', `/users/${SELLER}/roles`, { as: callers.buyer })

    expect(answer.status).toBe(403)
    expect(envelopeOf(answer).details).toEqual([
      'user.read 퍼미션으로 접근할 수 없는 리소스입니다.',
    ])
  })

  it('lets an operator read anyone, but grants nothing', async () => {
    expect((await call('GET', `/users/${BUYER}/roles`, { as: callers.operator })).status).toBe(200)

    const answer = await call('POST', `/users/${BUYER}/roles`, {
      as: callers.operator,
      body: { role: 'ADMIN_SUPER' },
    })

    expect(answer.status).toBe(403)
    expect(envelopeOf(answer).details).toEqual(['user.write 퍼미션이 없습니다.'])
  })

  it('grants and revokes for a super admin, idempotently', async () => {
    const granted = await call('POST', `/users/${BUYER}/roles`, {
      as: callers.superAdmin,
      body: { role: 'SELLER_OWNER' },
    })

    expect(granted).toEqual({
      status: 200,
      body: { userId: BUYER, roles: ['BUYER', 'SELLER_OWNER'] },
    })

    const again = await call('POST', `/users/${BUYER}/roles`, {
      as: callers.superAdmin,
      body: { role: 'SELLER_OWNER' },
    })

    expect(again.body).toEqual({ userId: BUYER, roles: ['BUYER', 'SELLER_OWNER'] })

    const revoked = await call('DELETE', `/users/${BUYER}/roles/SELLER_OWNER`, {
      as: callers.superAdmin,
    })

    expect(revoked).toEqual({ status: 200, body: { userId: BUYER, roles: ['BUYER'] } })
  })

  it('refuses to let a super admin lock themselves out', async () => {
    const answer = await call('DELETE', `/users/${SUPER}/roles/ADMIN_SUPER`, {
      as: callers.superAdmin,
    })

    expect(answer.status).toBe(409)
    expect(envelopeOf(answer).details).toEqual(['본인의 ADMIN_SUPER 역할은 회수할 수 없습니다.'])
  })

  it('rejects a malformed id and a malformed role with 400', async () => {
    const badId = await call('GET', '/users/not-a-uuid/roles', { as: callers.superAdmin })

    expect(badId.status).toBe(400)
    expect(envelopeOf(badId).details).toMatchObject([{ field: 'userId', code: 'INVALID' }])

    const badRole = await call('POST', `/users/${BUYER}/roles`, {
      as: callers.superAdmin,
      body: { role: 'ROOT' },
    })

    expect(badRole.status).toBe(400)
    expect(envelopeOf(badRole).details).toMatchObject([{ field: 'role', code: 'INVALID' }])
  })

  it('answers 404 for an account that does not exist', async () => {
    const answer = await call('GET', `/users/${UNKNOWN}/roles`, { as: callers.superAdmin })

    expect(answer.status).toBe(404)
    expect(envelopeOf(answer).details).toEqual(['사용자를 찾을 수 없습니다.'])
  })

  it('lets a demo administrator read a real account, per the read-stays-any rule', async () => {
    expect((await call('GET', `/users/${SELLER}/roles`, { as: callers.demoAdmin })).status).toBe(
      200,
    )
  })
})
