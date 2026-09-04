import 'reflect-metadata'

import type { AddressInfo } from 'node:net'

import type { INestApplication } from '@nestjs/common'
import { Controller, Module, Post } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { ApiClient, SellerStatus } from '@shopping/shared'
import { ApiClientError, createApiClient } from '@shopping/shared'
import { z } from 'zod'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../../src/app.module.js'
import { PRINCIPAL_RESOLVER } from '../../src/auth/principal-resolver.js'
import { Principal } from '../../src/auth/principal.decorator.js'
import { RequirePermission } from '../../src/auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import { configureApp } from '../../src/bootstrap/configure-app.js'
import { CLOCK } from '../../src/common/clock.js'
import { sellerInactiveMessage } from '../../src/sellers/seller-access.js'
import { SellerService } from '../../src/sellers/seller.service.js'
import { SellersModule } from '../../src/sellers/sellers.module.js'
import { testAppConfig } from '../support/app-config.js'
import { DEFAULT_TEST_INSTANT, fixedClock } from '../support/clock.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callerHeaders, HeaderPrincipalResolver } from '../support/principal.js'

/**
 * 완료 기준 F3 · F5 — the store's state gate, over real HTTP against a real
 * store row.
 *
 * **Why a fixture controller and not a product endpoint.** The two capabilities
 * the gate decides — `product.write` and `order.write` — belong to endpoints
 * this task does not own: `apps/api/src/catalog` is TASK-0032's and order
 * handling arrives in M09. TASK-0108 4장 says as much ("다른 TASK 의 판매자
 * 엔드포인트가 이것을 붙인다"), so what this task owes is the decision, the
 * refusal's shape, and a seam that is demonstrably usable — not an edit to
 * somebody else's file in the middle of a wave.
 *
 * The controller below is therefore exactly what an adopting endpoint will
 * look like: one `await this.sellers.assertCapability(...)` before the work. It
 * runs inside the **real** application — same guard, same exception filter,
 * same envelope — so what is being checked here is the thing that will ship,
 * with only the business logic behind it replaced by a constant.
 *
 * TASK-0032 currently answers a non-`ACTIVE` store with 409 from its own inline
 * check. Moving it onto this gate is a one-line change in a file another task
 * owns; it is reported rather than made (TASK-0108 9장, 2026-09-04).
 */

const db = useDatabase()

/** What an endpoint adopting the gate looks like. Nothing else is in the way. */
@Controller({ path: 'fixtures/seller-capability', version: '1' })
class CapabilityFixtureController {
  constructor(private readonly sellers: SellerService) {}

  @Post('products')
  @RequirePermission('product.write')
  async writeProduct(@Principal() principal: RequestPrincipal): Promise<{ ok: true }> {
    await this.sellers.assertCapability(principal.sellerId ?? '', 'product.write')

    return { ok: true }
  }

  @Post('orders')
  @RequirePermission('order.write')
  async handleOrder(@Principal() principal: RequestPrincipal): Promise<{ ok: true }> {
    await this.sellers.assertCapability(principal.sellerId ?? '', 'order.write')

    return { ok: true }
  }
}

@Module({ imports: [SellersModule], controllers: [CapabilityFixtureController] })
class CapabilityFixtureModule {}

const okSchema = z.object({ ok: z.literal(true) })

let app: INestApplication | null = null
let baseUrl = ''

beforeAll(async () => {
  const config = testAppConfig({ databaseUrl: db.url })
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config), CapabilityFixtureModule],
  })
    .overrideProvider(CLOCK)
    .useValue(fixedClock(DEFAULT_TEST_INSTANT))
    .overrideProvider(PRINCIPAL_RESOLVER)
    .useClass(HeaderPrincipalResolver)
    .compile()

  const created = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })

  await configureApp(created, config)
  await created.listen(0, '127.0.0.1')

  app = created

  const address = created.getHttpServer().address() as AddressInfo | null

  baseUrl = `http://127.0.0.1:${String(address?.port ?? 0)}`
})

afterAll(async () => {
  await app?.close()
  app = null
})

function client(caller: TestCaller): ApiClient {
  return createApiClient({
    baseUrl,
    appId: 'seller',
    fetch: (input, init) =>
      fetch(input, { ...init, headers: { ...init.headers, ...callerHeaders(caller) } }),
  })
}

/**
 * A store in `status`, and a caller who owns it.
 *
 * The caller holds `SELLER_OWNER` in every case, including the ones a real
 * approval would never have granted it for. That is deliberate: the permission
 * has to pass so that the request reaches the state gate at all, and what these
 * specs are about is the refusal the **store's state** produces, not the one
 * the permission table already produces (`authorization.integration.spec.ts`
 * owns that half).
 */
async function storefront(status: SellerStatus): Promise<TestCaller> {
  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id, status })

  return { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
}

interface Attempt {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
}

async function attempt(caller: TestCaller, path: string): Promise<Attempt> {
  const outcome: unknown = await client(caller)
    .request({ path: `/fixtures/seller-capability/${path}`, method: 'POST', schema: okSchema })
    .then(() => null)
    .catch((reason: unknown) => reason)

  if (outcome === null) return { status: 200, code: '', details: [] }
  if (!(outcome instanceof ApiClientError) || outcome.kind !== 'http') {
    throw new Error(
      `HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${outcome instanceof Error ? outcome.message : 'unknown'}`,
    )
  }

  return {
    status: outcome.status ?? 0,
    code: outcome.body?.error.code ?? '',
    details: outcome.body?.error.details ?? [],
  }
}

const STATUSES: readonly SellerStatus[] = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED']

describe('F3 — ACTIVE 가 아닌 스토어의 상품 등록', () => {
  it('refuses a pending store with 403 and the shared FORBIDDEN envelope', async () => {
    const caller = await storefront('PENDING')

    const refused = await attempt(caller, 'products')

    expect(refused.status).toBe(403)
    expect(refused.code).toBe('FORBIDDEN')
    // The reason travels in `details`, where a console reads it to explain the
    // disabled button rather than only greying it out.
    expect(refused.details).toContain(sellerInactiveMessage('PENDING', 'product.write'))
  })

  it('refuses a rejected store and admits an approved one', async () => {
    expect((await attempt(await storefront('REJECTED'), 'products')).status).toBe(403)
    expect((await attempt(await storefront('ACTIVE'), 'products')).status).toBe(200)
  })
})

describe('F5 — 정지된 스토어', () => {
  it('closes the catalogue and leaves order handling open', async () => {
    const caller = await storefront('SUSPENDED')

    // The whole reason the table exists: buyers who already paid must still be
    // shipped to, whatever the seller did.
    expect((await attempt(caller, 'products')).status).toBe(403)
    expect((await attempt(caller, 'orders')).status).toBe(200)
  })

  it('tells a suspended seller apart from one still waiting for review', async () => {
    const suspended = await attempt(await storefront('SUSPENDED'), 'products')
    const waiting = await attempt(await storefront('PENDING'), 'products')

    expect(suspended.details).not.toEqual(waiting.details)
  })
})

describe('상태별 접근 제어표 — 여덟 칸 전부', () => {
  it('answers every status against both capabilities the same way the table does', async () => {
    const observed: Record<string, number> = {}

    for (const status of STATUSES) {
      const caller = await storefront(status)

      observed[`${status}:product`] = (await attempt(caller, 'products')).status
      observed[`${status}:order`] = (await attempt(caller, 'orders')).status
    }

    expect(observed).toEqual({
      'PENDING:product': 403,
      'PENDING:order': 403,
      'ACTIVE:product': 200,
      'ACTIVE:order': 200,
      'REJECTED:product': 403,
      'REJECTED:order': 403,
      'SUSPENDED:product': 403,
      'SUSPENDED:order': 200,
    })
  })
})
