import type {
  ApiClient,
  ClaimStatus,
  ClaimType,
  SellerClaimListItem,
  SellerClaimListResponse,
} from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  claimResponseSchema,
  claimTransitionResponseSchema,
  orderResponseSchema,
  returnResponseSchema,
  sellerClaimDetailResponseSchema,
  sellerClaimListResponseSchema,
  sellerClaimSummaryResponseSchema,
} from '@shopping/shared'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { CLAIM_HANDLING_DEMO_MS, claimDueAt } from '../../src/claims/claim-deadline.js'
import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import type { PaymentProviderName, PaymentStatus } from '@shopping/shared'
import type {
  AuthorizeRequest,
  AuthorizeResult,
  PaymentProviderPort,
} from '../../src/payment/payment-provider.js'
import { PaymentProviderRegistry } from '../../src/payment/payment-registry.js'
import { PaymentService } from '../../src/payment/payment.service.js'
import { useApiApp } from '../support/api-app.js'
import { testStorageConfig } from '../support/app-config.js'
import { fixedClock } from '../support/clock.js'
import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'
import { recordStatements } from '../support/statements.js'

/**
 * 판매자 콘솔의 클레임 목록 · 뱃지 · 상세 (TASK-0070), 이 워커의 실제 데이터베이스에 대고.
 *
 * 정렬·단계·커서·영업일이 옳은지는 순수 스펙 둘이 잰다 (`claim-console.spec.ts` ·
 * `claim-deadline.spec.ts`). **여기서 재는 것은 그 판단이 실제 행에 적용되는가**이고,
 * TASK 의 완료 기준에 붙은 것들이다.
 *
 * | 무엇을 | 왜 그것이 증거인가 |
 * | --- | --- |
 * | 처리 대기가 먼저 온다 | 「대기 먼저」가 정렬이지 탭이 아니다 |
 * | 커서로 끝까지 넘겨도 중복·누락 0 | 두 칸짜리 정렬 키에서도 키셋이 성립하는가 |
 * | **미리 본 환불 예정액 = 실제 환불액** | 두 벌로 만들지 않았다는 유일한 증거 (R2) |
 * | 사유 없이 거절 → 400 | **서버에서** 막는가. 화면만 막으면 API 를 직접 부르는 길이 남는다 |
 * | 검수 합격/불합격이 환불을 가른다 | 물건을 돌려받지 못했는데 나간 돈이 이 TASK 의 최악이다 |
 * | 남의 클레임 → 403 | |
 * | 2영업일 경계 | 정각은 아직 기한 안이다 |
 *
 * **결제사만 대역이다** (QUALITY-GATES 6장). 환불 예정액과 실제 환불액을 비교하려면
 * 환불이 실제로 나가야 하고, 그러려면 매입까지 끝난 결제가 있어야 한다.
 */

/** 대본대로 답하는 결제사. `refund.spec.ts` 의 것과 같은 모양이다. */
class ScriptedProvider implements PaymentProviderPort {
  readonly name: PaymentProviderName = 'VIRTUAL_CARD'

  authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    return Promise.resolve({ outcome: 'approved', paymentKey: `card-${request.paymentId}` })
  }

  capture(): Promise<void> {
    return Promise.resolve()
  }

  cancel(): Promise<void> {
    return Promise.resolve()
  }

  refund(): Promise<void> {
    return Promise.resolve()
  }

  recover(paymentId: string): Promise<AuthorizeResult> {
    return Promise.resolve({ outcome: 'approved', paymentKey: `card-${paymentId}` })
  }

  getStatus(): Promise<PaymentStatus> {
    return Promise.resolve('PAID')
  }
}

const provider = new ScriptedProvider()

const db = useDatabase()
const NOW = '2026-09-03T00:00:00.000Z'
const clock = fixedClock(NOW)

/**
 * 문장을 세는 Prisma. **A5 를 재는 유일한 방법**이다.
 *
 * 「N+1 이 없다」는 눈으로 읽어서는 증명되지 않는다 — 줄이 하나일 때와 스물일 때
 * 나가는 문장의 수가 같은지가 그 정의이고, 그것을 재려면 나가는 문장을 붙잡아야
 * 한다 (`seller-order-console.spec.ts` 가 같은 이유로 같은 장치를 쓴다).
 */
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

const api = useApiApp({ database: db, authenticate: true, clock, prisma: observable })

/**
 * 같은 데이터베이스를 보는 **두 번째 앱** — 실제 서비스의 속도와, **저장소가 없는**
 * 배포.
 *
 * 기본 앱은 배포의 기본값(`demo`)과 설정된 R2 를 쓴다. 영업일 경계와 「저장소가
 * 없을 때 사진이 어떻게 나가는가」는 그 설정에서 잴 수 없는 것들이고, 환경변수 →
 * `AppConfig` → 계산이 실제로 갈리는지는 앱을 하나 더 띄우는 것 말고 재는 방법이
 * 없다 (`delivery-simulator.spec.ts` 가 같은 이유로 같은 모양이다).
 */
const realisticClock = fixedClock(NOW)
const realistic = useApiApp({
  database: db,
  authenticate: true,
  clock: realisticClock,
  config: { fulfillmentPace: 'realistic', storage: null },
})

let buyer: TestCaller
let principal: RequestPrincipal
let addressId: string
let categoryId: number
let store: Store

interface Store {
  readonly sellerId: string
  readonly seller: TestCaller
  readonly productId: string
  readonly variantId: string
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

beforeAll(() => {
  api.resolve<PaymentProviderRegistry>(PaymentProviderRegistry).register(provider)
})

afterAll(async () => {
  await observable.$disconnect()
})

beforeEach(async () => {
  clock.set(NOW)
  realisticClock.set(NOW)

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  principal = { app: 'shop', userId: account.id, roles: ['BUYER'], sellerId: null }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
  store = await storefront()
})

async function storefront(): Promise<Store> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    status: 'ACTIVE',
    name: '울 코트',
    minPrice: 10_000,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: 10_000,
    stock: 200,
    isActive: true,
  })

  return {
    sellerId: seller.id,
    seller: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: seller.id },
    productId: product.id,
    variantId: variant.id,
  }
}

// -------------------------------------------------------------- 대량 시드

/**
 * 정렬 위치가 정해진 uuid.
 *
 * 커서는 정렬 축 위의 위치이고 그 두 번째 칸이 `id` 다. `id` 가 UUIDv7 이라 신청
 * 시각과 같은 순서라는 성질을 시드에서도 지켜야, 「대기 안에서 오래된 것이 먼저」를
 * 잴 수 있다 (`seller-order-console.spec.ts` 의 `orderedId` 와 같은 장치).
 */
function orderedId(index: number): string {
  return `01930000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`
}

/** 유형과 상태가 짝이 맞는가 — `ClaimRequest_type_status_check` 가 막는 것. */
function typeOf(status: ClaimStatus): ClaimType {
  return status.startsWith('CANCEL') ? 'CANCEL' : 'RETURN'
}

/**
 * 클레임 한 건을 주문과 함께 심는다.
 *
 * 진짜 신청 흐름(`POST /claims`)을 쓰지 않는 이유는 **종착 상태를 만들 수 없기**
 * 때문이다 — `REFUNDED` 로 가려면 결제까지 끝난 주문이 필요하고, 목록의 정렬을
 * 재려면 열 가지 상태가 골고루 있어야 한다. 정렬은 상태만 보므로 여기서 필요한
 * 사실도 상태뿐이다.
 */
async function seedClaim(index: number, status: ClaimStatus): Promise<string> {
  const orderId = orderedId(index)
  const sellerOrderId = orderedId(1_000 + index)
  const orderItemId = orderedId(2_000 + index)
  const claimId = orderedId(3_000 + index)
  // **신청 시각을 명시한다.** 컬럼의 기본값은 데이터베이스의 `now()` 이고 그것은
  // 이 스펙의 시계를 따라오지 않는다 — 기본값에 맡기면 기한이 언제나 실제 오늘에서
  // 계산되어, 주입한 시계로는 지연을 만들 수 없다 (QUALITY-GATES 6장이 `vi.setSystemTime`
  // 을 금지한 것과 같은 어긋남이 반대 방향으로 나타난다).
  const requestedAt = new Date(Date.parse(NOW) - (SEEDED.length - index) * 60_000)

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             10000, 10000, now())`,
    [orderId, `20260906-${String(index).padStart(8, '0')}`, buyer.userId],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, 'PREPARING'::"SellerOrderStatus", '가상브랜드', 10000, 10000, now())`,
    [sellerOrderId, orderId, store.sellerId],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productSnapshot", "unitPrice", "quantity",
        "productAmount", "claimedQuantity", "updatedAt")
     VALUES ($1, $2, $3, $4::jsonb, 10000, 2, 20000, 1, now())`,
    [
      orderItemId,
      sellerOrderId,
      store.variantId,
      JSON.stringify({
        productId: store.productId,
        productName: '울 코트',
        optionLabel: '블랙 / M',
        sku: `SKU-${String(index)}`,
        thumbnailUrl: 'https://cdn.test.invalid/coat.jpg',
        brandName: '가상브랜드',
      }),
    ],
  )
  await db.execute(
    `INSERT INTO "ClaimRequest"
       ("id", "sellerOrderId", "type", "status", "reason", "fault", "requestedById",
        "createdAt", "updatedAt")
     VALUES ($1, $2, $3::"ClaimType", $4::"ClaimStatus", '색상이 화면과 달라요.',
             'CUSTOMER'::"ClaimFault", $5, ($6::timestamptz AT TIME ZONE 'UTC'), now())`,
    [claimId, sellerOrderId, typeOf(status), status, buyer.userId, requestedAt.toISOString()],
  )
  await db.execute(
    `INSERT INTO "ClaimItem" ("id", "claimId", "orderItemId", "quantity", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, 1, now())`,
    [claimId, orderItemId],
  )

  return claimId
}

/**
 * 열 가지 상태를 **id 순서와 일부러 어긋나게** 심는다.
 *
 * id 가 가장 작은 것이 종착이고 가장 큰 것이 대기다. 정렬이 `id` 하나였다면 종착이
 * 맨 위에 오므로, 이 배치에서 「대기가 먼저」가 실제로 정렬의 결과인지 확인된다.
 */
const SEEDED: readonly ClaimStatus[] = [
  'REFUNDED',
  'CANCEL_REJECTED',
  'RETURN_REJECTED',
  'CANCEL_APPROVED',
  'RETURN_COMPLETED',
  'INSPECTING',
  'PICKING_UP',
  'RETURN_APPROVED',
  'RETURN_REQUESTED',
  'CANCEL_REQUESTED',
]

async function seedAll(): Promise<void> {
  for (const [index, status] of SEEDED.entries()) await seedClaim(index + 1, status)
}

// ------------------------------------------------------------------ 읽기

function list(query = '', caller: TestCaller = store.seller): Promise<SellerClaimListResponse> {
  return api.clientAs(caller).request({
    path: `/seller-claims${query}`,
    schema: sellerClaimListResponseSchema,
  })
}

/** 커서를 끝까지 따라간다. 중복·누락을 재는 유일한 방법이다. */
async function walk(query = '', limit = 3): Promise<SellerClaimListItem[]> {
  const collected: SellerClaimListItem[] = []
  let cursor: string | null = null
  let pages = 0

  do {
    const separator = query === '' ? '?' : `${query}&`
    // 타입을 적어 두는 것은 취향이 아니다 — `cursor` 재대입 고리 안에서 추론이
    // 순환해 `any` 가 된다 (`seller-order-console.spec.ts` 가 같은 주석을 달았다).
    const page: SellerClaimListResponse = await list(
      `${separator}limit=${String(limit)}${cursor === null ? '' : `&cursor=${cursor}`}`,
    )

    collected.push(...page.claims)
    cursor = page.nextCursor
    pages += 1

    if (pages > 100) throw new Error('커서가 끝나지 않습니다.')
  } while (cursor !== null)

  return collected
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly field: string
}

function failureOf(error: unknown): HttpFailure {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const detail = error.body?.error.details?.at(0)
  const entry = typeof detail === 'object' && detail !== null ? detail : {}

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    field: 'field' in entry && typeof entry.field === 'string' ? entry.field : '',
  }
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  return failureOf(
    await work.then(
      () => null,
      (reason: unknown) => reason,
    ),
  )
}

describe('목록 — 처리 대기 우선', () => {
  it('puts everything the seller has to touch above everything else', async () => {
    await seedAll()

    const page = await list('?limit=50')
    const stages = page.claims.map((row) => row.stage)

    // 대기 다섯 · 진행 중 둘 · 종결 셋. 심은 순서와 정확히 반대다.
    expect(stages).toEqual([
      ...Array.from({ length: 5 }, () => 'WAITING'),
      ...Array.from({ length: 2 }, () => 'IN_PROGRESS'),
      ...Array.from({ length: 3 }, () => 'CLOSED'),
    ])
  })

  it('puts the oldest first inside a stage, which is the same thing as the nearest deadline', async () => {
    await seedAll()

    const waiting = (await list('?stage=WAITING&limit=50')).claims
    const requested = waiting.map((row) => row.requestedAt)

    expect([...requested].sort()).toEqual(requested)
    // 기한은 신청 시각의 단조 증가 함수다. 그래서 같은 정렬이 곧 기한 순이다 —
    // 지연된 건이 대기 탭 맨 위에 모이는 것이 그 결과다.
    expect([...waiting.map((row) => row.dueAt)].sort()).toEqual(waiting.map((row) => row.dueAt))
  })

  it('walks to the end with no duplicate and no gap', async () => {
    await seedAll()

    const walked = await walk()
    const ids = walked.map((row) => row.id)

    expect(ids).toHaveLength(SEEDED.length)
    expect(new Set(ids).size).toBe(SEEDED.length)
    // 한 페이지에 다 담아 읽은 것과 **순서까지** 같아야 한다. 커서가 정렬 축 위의
    // 위치를 가리키지 않으면 여기서 순서가 무너진다.
    expect(ids).toEqual((await list('?limit=50')).claims.map((row) => row.id))
  })

  it('keeps that guarantee under a filter, too', async () => {
    await seedAll()

    const walked = await walk('?type=RETURN', 2)

    expect(walked.every((row) => row.type === 'RETURN')).toBe(true)
    expect(new Set(walked.map((row) => row.id)).size).toBe(walked.length)
    expect(walked).toHaveLength(SEEDED.filter((status) => typeOf(status) === 'RETURN').length)
  })

  it('refuses a cursor that is not a position on the sort axis', async () => {
    await seedAll()

    const refused = await failure(list('?cursor=not-a-cursor'))

    // 조용히 첫 페이지로 되돌리면 화면이 1페이지를 무한히 반복하고, 그 증상은 아무
    // 오류도 내지 않는다.
    expect(refused.status).toBe(400)
    expect(refused.field).toBe('cursor')
  })

  it('narrows by stage, type and status', async () => {
    await seedAll()

    expect((await list('?stage=CLOSED&limit=50')).claims).toHaveLength(3)
    expect((await list('?type=CANCEL&limit=50')).claims).toHaveLength(
      SEEDED.filter((status) => typeOf(status) === 'CANCEL').length,
    )
    expect(
      (await list('?status=CANCEL_REQUESTED,RETURN_REQUESTED&limit=50')).claims.map(
        (row) => row.status,
      ),
    ).toEqual(['RETURN_REQUESTED', 'CANCEL_REQUESTED'])
  })

  it('carries the headline and the item counts so the row draws without a second request', async () => {
    await seedClaim(1, 'CANCEL_REQUESTED')

    const row = (await list()).claims.at(0)

    expect(row).toMatchObject({
      headline: '울 코트',
      itemCount: 1,
      totalQuantity: 1,
      thumbnailUrl: 'https://cdn.test.invalid/coat.jpg',
    })
  })
})

describe('뱃지', () => {
  it('counts every status, zero included, and sums the waiting ones', async () => {
    await seedAll()

    const { summary } = await api.clientAs(store.seller).request({
      path: '/seller-claims/summary',
      schema: sellerClaimSummaryResponseSchema,
    })

    expect(summary.counts.CANCEL_REQUESTED).toBe(1)
    // 심지 않은 상태도 0을 갖는다. 안 채우면 화면이 「아직 못 읽었다」와 「0건이다」를
    // 구분할 수 없다.
    expect(summary.counts.PICKING_UP).toBe(1)
    expect(summary.stages).toEqual({ WAITING: 5, IN_PROGRESS: 2, CLOSED: 3 })
    expect(summary.waiting).toBe(5)
  })

  it('is not shadowed by /seller-claims/:id', async () => {
    // 라우터는 먼저 등록된 것을 쓴다. 순서가 뒤집히면 `summary` 가 id 로 읽히고
    // 조회가 500 으로 끝난다.
    await expect(
      api.clientAs(store.seller).request({
        path: '/seller-claims/summary',
        schema: sellerClaimSummaryResponseSchema,
      }),
    ).resolves.toMatchObject({ summary: { waiting: 0 } })
  })
})

describe('권한', () => {
  it('refuses another seller with 403 and an anonymous caller with 401', async () => {
    const claimId = await seedClaim(1, 'CANCEL_REQUESTED')
    const other = await storefront()

    const stranger = await failure(
      api.clientAs(other.seller).request({
        path: `/seller-claims/${claimId}`,
        schema: sellerClaimDetailResponseSchema,
      }),
    )

    expect(stranger.status).toBe(403)

    // 목록도 마찬가지다 — 남의 가게 것은 아예 나오지 않는다.
    expect((await list('', other.seller)).claims).toEqual([])

    const anonymous = await failure(
      api.client.request({ path: '/seller-claims', schema: sellerClaimListResponseSchema }),
    )

    expect(anonymous.status).toBe(401)
  })

  it('refuses an operator who has the permission but no store to hang it on', async () => {
    const refused = await failure(
      api.clientAs(callers.operator).request({
        path: '/seller-claims',
        schema: sellerClaimListResponseSchema,
      }),
    )

    expect(refused.status).toBe(403)
  })
})

// ------------------------------------------------- 환불 예정액과 실제 환불액

interface Placed {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly itemIds: readonly string[]
}

/** 두 항목짜리 주문 하나. 부분 취소를 만들어야 배송비 갈래가 실제로 걸린다. */
async function place(): Promise<Placed> {
  const itemIds: string[] = []

  for (const quantity of [1, 3]) {
    const product = await createProduct(db, {
      sellerId: store.sellerId,
      categoryId,
      status: 'ACTIVE',
      minPrice: 10_000,
    })
    const variant = await createProductVariant(db, {
      productId: product.id,
      sellerId: store.sellerId,
      price: 10_000,
      stock: 50,
      isActive: true,
    })
    const cart = await client().request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId: variant.id, quantity },
      schema: cartResponseSchema,
    })
    const line = cart.groups.flatMap((group) => group.items).at(-1)

    if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

    itemIds.push(line.id)
  }

  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds, addressId },
    schema: orderResponseSchema,
  })
  const bundle = order.sellerOrders.at(0)

  if (bundle === undefined) throw new Error('판매자 몫을 찾지 못했습니다.')

  const rows = await db.query<{ id: string }>(
    `SELECT "id" FROM "OrderItem" WHERE "sellerOrderId" = $1 ORDER BY "quantity", "id"`,
    [bundle.id],
  )

  return { orderId: order.id, sellerOrderId: bundle.id, itemIds: rows.map((row) => row.id) }
}

/** 매입까지. 여기서부터가 환불을 시험할 수 있는 자리다. */
async function pay(orderId: string): Promise<void> {
  const payments = api.resolve<PaymentService>(PaymentService)
  const { payment } = await payments.start(principal, orderId, 'VIRTUAL_CARD')

  await payments.authorize(principal, payment.id)
  await payments.capture(principal, payment.id)
}

function detail(claimId: string, caller: TestCaller = store.seller) {
  return api.clientAs(caller).request({
    path: `/seller-claims/${claimId}`,
    schema: sellerClaimDetailResponseSchema,
  })
}

function transition(claimId: string, to: ClaimStatus, reason?: string) {
  return api.clientAs(store.seller).request({
    path: `/claims/${claimId}/transitions`,
    method: 'POST',
    body: reason === undefined ? { to } : { to, reason },
    schema: claimTransitionResponseSchema,
  })
}

describe('환불 예정액', () => {
  it('is the number that actually leaves — the same function, not a second one', async () => {
    const placed = await place()

    await pay(placed.orderId)
    // `PREPARING` 이라 규칙이 자동 승인하지 않는다. 판매자가 승인 버튼을 누르기
    // **전에** 물어보는 것이 이 TASK 의 요구사항이다.
    await db.execute(
      `UPDATE "SellerOrder" SET "status" = 'PREPARING'::"SellerOrderStatus" WHERE "id" = $1`,
      [placed.sellerOrderId],
    )

    const { claim } = await client().request({
      path: '/claims',
      method: 'POST',
      body: {
        sellerOrderId: placed.sellerOrderId,
        // 세 개 중 두 개만. 부분 환불이라 배송비 갈래와 누적 반올림이 함께 걸린다.
        items: [{ orderItemId: placed.itemIds.at(1), quantity: 2 }],
        reason: '색상이 화면과 달라요.',
        fault: 'CUSTOMER',
      },
      schema: claimResponseSchema,
    })

    const quoted = (await detail(claim.id)).claim.quote

    expect(quoted.total).toBeGreaterThan(0)

    await transition(claim.id, 'CANCEL_APPROVED')

    const settled = await db.one<{
      itemsAmount: number
      shippingAmount: number
      amount: number
    }>(`SELECT "itemsAmount", "shippingAmount", "amount" FROM "ClaimRefund" WHERE "claimId" = $1`, [
      claim.id,
    ])

    // 세 숫자가 전부 같아야 한다. 총액만 비교하면 항목과 배송비가 서로를 상쇄한
    // 경우를 놓친다.
    expect(settled.itemsAmount).toBe(quoted.itemsAmount)
    expect(settled.shippingAmount).toBe(quoted.shippingAmount)
    expect(settled.amount).toBe(quoted.total)

    // 끝난 뒤에는 **나간 액수**를 답한다. 「지금 환불하면 얼마인가」를 그대로 물으면
    // 남은 수량이 없어 0이 나오고, 그러면 종결된 클레임의 상세가 「0원」을 보여 준다.
    const closed = (await detail(claim.id)).claim

    expect(closed.refunded).toBe(true)
    expect(closed.quote.total).toBe(quoted.total)
  })
})

// ------------------------------------------------------------ 거절과 검수

describe('거절 사유', () => {
  it('refuses a rejection with no reason, from the server', async () => {
    const claimId = await seedClaim(1, 'CANCEL_REQUESTED')

    // 화면이 먼저 막는 것은 친절이고, 규칙은 여기 있다 — 화면만 막으면 API 를
    // 직접 부르는 길이 남는다.
    const blank = await failure(transition(claimId, 'CANCEL_REJECTED'))

    expect(blank).toMatchObject({ status: 400, code: 'CLAIM_REASON_REQUIRED', field: 'reason' })

    const whitespace = await failure(transition(claimId, 'CANCEL_REJECTED', '   '))

    expect(whitespace.code).toBe('CLAIM_REASON_REQUIRED')

    const { claim } = await transition(claimId, 'CANCEL_REJECTED', '이미 발송 준비가 끝났어요.')

    expect(claim.status).toBe('CANCEL_REJECTED')
    expect(claim.history.at(-1)?.reason).toBe('이미 발송 준비가 끝났어요.')
  })

  it('does not ask for one on the steps that are not rejections', async () => {
    const claimId = await seedClaim(1, 'CANCEL_REQUESTED')

    // 정상 흐름마다 빈 칸을 채우게 하면 그 칸은 곧 「.」 으로 채워진다.
    await expect(transition(claimId, 'CANCEL_APPROVED')).resolves.toMatchObject({ changed: true })
  })
})

describe('검수', () => {
  /** 승인 → 수거 → 입고까지. 검수 앞에 세우는 것이 이 함수의 전부다. */
  async function upToInspecting(): Promise<{ claimId: string; sellerOrderId: string }> {
    const placed = await place()

    await pay(placed.orderId)
    await db.execute(
      `UPDATE "SellerOrder" SET "status" = 'DELIVERED'::"SellerOrderStatus" WHERE "id" = $1`,
      [placed.sellerOrderId],
    )
    await db.execute(
      `INSERT INTO "OrderStatusHistory"
         ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "actorId", "createdAt")
       VALUES (gen_random_uuid(), $1, 'SHIPPED', 'DELIVERED', 'SYSTEM', NULL, now())`,
      [placed.sellerOrderId],
    )

    const { claim } = await client().request({
      path: '/returns',
      method: 'POST',
      body: {
        sellerOrderId: placed.sellerOrderId,
        items: [{ orderItemId: placed.itemIds.at(0), quantity: 1 }],
        reason: '받아 보니 박음질이 터져 있어요.',
        return: {
          returnReason: 'DEFECTIVE',
          photoKeys: [`returns/${buyer.userId}/00000001-0000-4000-8000-000000000000.jpg`],
        },
      },
      schema: returnResponseSchema,
    })

    await transition(claim.id, 'RETURN_APPROVED')
    await api.clientAs(store.seller).request({
      path: `/returns/${claim.id}/pickup`,
      method: 'POST',
      body: {},
      schema: returnResponseSchema,
    })
    await transition(claim.id, 'INSPECTING')

    return { claimId: claim.id, sellerOrderId: placed.sellerOrderId }
  }

  function inspect(claimId: string, passed: boolean, note?: string | null) {
    return api.clientAs(store.seller).request({
      path: `/returns/${claimId}/inspection`,
      method: 'POST',
      body: note === undefined ? { passed } : { passed, note },
      schema: returnResponseSchema,
    })
  }

  function refundRow(claimId: string) {
    return db.query<{ amount: number; refundedAt: Date | null }>(
      `SELECT "amount", "refundedAt" FROM "ClaimRefund" WHERE "claimId" = $1`,
      [claimId],
    )
  }

  it('refunds on a pass', async () => {
    const { claimId } = await upToInspecting()
    const { claim } = await inspect(claimId, true)

    expect(claim.status).toBe('REFUNDED')
    expect((await refundRow(claimId)).at(0)?.refundedAt).not.toBeNull()
  })

  it('refunds nothing on a fail, and asks why', async () => {
    const { claimId } = await upToInspecting()

    // 검수 불합격도 거절이다. 사유가 붙는 칸이 `reason` 이 아니라 `note` 인 것은
    // 이 요청에 `reason` 이라는 칸이 없기 때문이다.
    const blank = await failure(inspect(claimId, false))

    expect(blank).toMatchObject({ status: 400, code: 'CLAIM_REASON_REQUIRED', field: 'note' })

    const { claim } = await inspect(claimId, false, '사용감이 뚜렷해요.')

    expect(claim.status).toBe('RETURN_REJECTED')
    // 물건은 판매자에게 있지만 돈은 나가지 않는다. 이 TASK 의 최악이 그 반대다.
    expect(await refundRow(claimId)).toEqual([])
    // 불합격 사유가 클레임 이력에도 남는다 — 분쟁에서 읽히는 것이 그 이력이다.
    expect(claim.history.at(-1)?.reason).toBe('사용감이 뚜렷해요.')
  })

  it('draws the two inspection buttons through the inspection route, not the transition one', async () => {
    const { claimId } = await upToInspecting()
    const { actions } = (await detail(claimId)).claim

    expect(actions).toEqual([
      { to: 'RETURN_COMPLETED', route: 'inspection', requiresReason: false },
      { to: 'RETURN_REJECTED', route: 'inspection', requiresReason: true },
    ])
  })

  it('hands the seller the photo the buyer attached, as a URL it does not have to assemble', async () => {
    const { claimId } = await upToInspecting()

    const configured = (await detail(claimId)).claim.return
    const photo = configured?.photos.at(0)

    // **화면이 URL 을 조합하지 않는다.** 공개 호스트는 배포 설정이고, 프론트가
    // 만들면 그 설정이 한 벌 더 생겨 배포마다 갈린다.
    expect(photo?.key).toContain(`returns/${buyer.userId}/`)
    expect(photo?.url).toBe(`${testStorageConfig.publicBaseUrl}/${photo?.key ?? ''}`)
    expect(configured?.pickupTrackingNumber).not.toBeNull()

    // 저장소를 아직 붙이지 않은 배포에서는 열쇠만 나가고 URL 은 `null` 이다 —
    // 사진을 못 보는 것과 클레임을 처리하지 못하는 것은 다른 일이다 (TASK-0011 4.5).
    const unconfigured = await realistic.clientAs(store.seller).request({
      path: `/seller-claims/${claimId}`,
      schema: sellerClaimDetailResponseSchema,
    })

    expect(unconfigured.claim.return?.photos.at(0)?.url).toBeNull()
  })
})

// ------------------------------------------------------------------ 기한

describe('처리 기한', () => {
  it('answers the compressed window in the demo pace, and flips exactly when it passes', async () => {
    const claimId = await seedClaim(1, 'CANCEL_REQUESTED')
    const before = (await detail(claimId)).claim

    expect(before.overdue).toBe(false)

    const dueAt = Date.parse(before.dueAt)

    // 정각은 아직 기한 안이다.
    clock.set(new Date(dueAt))
    expect((await detail(claimId)).claim.overdue).toBe(false)

    clock.set(new Date(dueAt + 1))
    expect((await detail(claimId)).claim.overdue).toBe(true)

    // 압축 축이 실제로 읽히는가 — 배송·구매확정과 **같은 축**(`FULFILLMENT_PACE`)이다.
    const requestedAt = Date.parse(before.claim.requestedAt)

    expect(dueAt - requestedAt).toBe(CLAIM_HANDLING_DEMO_MS)
  })

  it('counts two business days in the realistic pace, weekend skipped', async () => {
    const claimId = await seedClaim(1, 'CANCEL_REQUESTED')

    // 금요일 15시(KST)에 신청했다고 두면 기한은 화요일 15시다. 토·일을 세면
    // 일요일이 되고, 그러면 지연이 이틀 일찍 뜬다.
    const requestedAt = new Date('2026-09-04T15:00:00+09:00')

    await db.execute(`UPDATE "ClaimRequest" SET "createdAt" = $2 WHERE "id" = $1`, [
      claimId,
      requestedAt.toISOString(),
    ])

    const answered = await realistic.clientAs(store.seller).request({
      path: `/seller-claims/${claimId}`,
      schema: sellerClaimDetailResponseSchema,
    })

    expect(answered.claim.dueAt).toBe(claimDueAt(requestedAt, 'realistic').toISOString())
    expect(answered.claim.dueAt).toBe(new Date('2026-09-08T15:00:00+09:00').toISOString())

    realisticClock.set(new Date('2026-09-08T15:00:00+09:00'))
    expect(
      (
        await realistic.clientAs(store.seller).request({
          path: `/seller-claims/${claimId}`,
          schema: sellerClaimDetailResponseSchema,
        })
      ).claim.overdue,
    ).toBe(false)

    realisticClock.set(new Date('2026-09-08T15:00:00.001+09:00'))
    expect(
      (
        await realistic.clientAs(store.seller).request({
          path: `/seller-claims/${claimId}`,
          schema: sellerClaimDetailResponseSchema,
        })
      ).claim.overdue,
    ).toBe(true)
  })

  it('marks the delayed ones in the list, and they sit at the top of the waiting tab', async () => {
    await seedAll()

    clock.advance(CLAIM_HANDLING_DEMO_MS + 1)

    const waiting = (await list('?stage=WAITING&limit=50')).claims

    expect(waiting.every((row) => row.overdue)).toBe(true)
  })
})

describe('예산 (A1 · A5)', () => {
  const P95_BUDGET_MS = 300
  const SAMPLES = 20
  const SAMPLING_BUDGET_MS = 120_000

  function p95Of(durations: readonly number[]): number {
    const sorted = [...durations].sort((left, right) => left - right)

    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
  }

  it('lists ten claims in the same number of statements as one', async () => {
    const [first, ...rest] = SEEDED

    if (first === undefined) throw new Error('심을 상태가 없습니다.')

    await seedClaim(1, first)

    const forOne = await recordStatements(statements, () => list('?limit=50'))

    // 지우고 다시 심지 않고 **덧붙인다.** `ClaimItem → OrderItem` 은 `Restrict` 라
    // 주문만 지우면 그 제약이 막고, 클레임부터 지우는 순서를 스펙이 알고 있어야 할
    // 이유가 없다.
    for (const [index, status] of rest.entries()) await seedClaim(index + 2, status)

    const forTen = await recordStatements(statements, () => list('?limit=50'))

    // 열 줄을 그리는 데 열한 번 왕복하지 않는다. 항목 개수·수량 합계와 대표 상품이
    // **횡단 조인**으로 붙기 때문이고, `include` 로 항목을 통째로 가져왔다면 여기서
    // 갈렸을 것이다.
    expect(forTen.length).toBe(forOne.length)
  })

  it(
    'answers the list and the badge inside the p95 budget',
    async () => {
      await seedAll()

      const durations: number[] = []

      for (let sample = 0; sample < SAMPLES; sample += 1) {
        const started = performance.now()

        await list('?stage=WAITING&limit=20')
        durations.push(performance.now() - started)
      }

      expect(p95Of(durations)).toBeLessThanOrEqual(P95_BUDGET_MS)
    },
    SAMPLING_BUDGET_MS,
  )
})
