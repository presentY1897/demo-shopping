import { HttpException } from '@nestjs/common'
import type {
  ApiClient,
  DemoCarrierCode,
  OrderStatus,
  SellerOrderTransitionResponse,
} from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  demoCarrierNames,
  orderResponseSchema,
  orderStatuses,
  sellerOrderActionsResponseSchema,
  sellerOrderTransitionResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import type { RequestPrincipal } from '../../src/auth/request-principal.js'
import { OrderService } from '../../src/orders/order.service.js'
import type {
  SellerOrderActor,
  TransitionRefusal,
} from '../../src/orders/seller-order-transitions.js'
import { sellerOrderActors, transitionDecision } from '../../src/orders/seller-order-transitions.js'
import { SellerOrderService } from '../../src/orders/seller-order.service.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { ReservationSweeperService } from '../../src/reservation/reservation-sweeper.service.js'
import { useApiApp } from '../support/api-app.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
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

/**
 * 주문 상태 머신 (TASK-0059), 이 워커의 실제 데이터베이스에 대고.
 *
 * **이 파일이 지키는 것은 「상태는 이 문으로만 바뀐다」이다.** 규칙 표가 옳은지는
 * `seller-order-transitions.spec.ts` 가 순수 함수로 재고, 여기서 재는 것은 그 표가
 * **행에 실제로 적용되는가**다 — 잠금이 먼저인가(F6), 거절이 아무것도 남기지
 * 않는가(F2·F3·F4), 이력이 빠짐없이 남는가(F5), 그리고 **결제와 만료 스케줄러도 이
 * 문을 지나는가**.
 *
 * 마지막 항목이 이 TASK 의 값의 절반이다. 그 둘이 예전처럼 `updateMany` 로 상태를
 * 직접 쓰면 「정의되지 않은 전이는 불가능하다」는 **새 코드에만 적용되는 규칙**이
 * 되고, 그때 이 파일의 다른 검사는 전부 초록이다.
 *
 * 서비스를 앱에서 꺼내 쓰는 검사와 실제 HTTP 로 지나가는 검사가 섞여 있다. 앞의 것은
 * 전이 매트릭스처럼 **조합이 수백 개**여서 왕복을 줄여야 하는 자리이고, 뒤의 것은
 * 라우트·권한·응답 계약처럼 컨트롤러를 지나야만 뜻이 있는 자리다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 전이 매트릭스 전수의 예산. 조합이 288개라 한 요청의 기본 5초로는 모자란다. */
const MATRIX_BUDGET_MS = 120_000

/** 표본 루프 전체의 예산. 실패가 「p95 초과」로 보고돼야지 타임아웃으로 나오면 안 된다. */
const SAMPLING_BUDGET_MS = 120_000

const SAMPLES = 20

/** A1. 로컬 부하 측정 p95. */
const P95_BUDGET_MS = 300

/** 예약 TTL(15분)을 넉넉히 넘긴다. */
const PAST_TTL_MS = 20 * 60_000

/**
 * 상태 머신이 「붙어 있다」를 읽을 운송장.
 *
 * **번호의 출처는 이제 `Shipment` 다** (TASK-0061). 그래서 아래 {@link reset} 은 이
 * 값을 몫에 적어 넣기 전에 **배송 행부터 만든다** — `SellerOrder_trackingNumber_shipment_fkey`
 * 가 자기 배송의 번호가 아닌 값을 거절하기 때문이고, 그 거절이 곧 「발송했다는데
 * 운송장이 없다」를 구조적으로 막는 장치다. 상태 머신이 보는 것은 여전히 「붙어
 * 있는가」 하나이고, 이 파일이 재는 것도 그것 하나다.
 *
 * 발급 경로 자체(운송장이 어떻게 만들어지고 첫 추적 이벤트가 언제 남는가)는
 * `shipment.spec.ts` 가 잰다.
 */
const TRACKING_CARRIER: DemoCarrierCode = 'GA'
const TRACKING_NUMBER = `DEMO-${TRACKING_CARRIER}-000000000001`

let buyer: TestCaller
let addressId: string
let categoryId: number
let placed: Placed

interface Placed {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly seller: TestCaller
}

interface RowState {
  readonly status: string
  readonly history: number
}

interface HistoryRow {
  readonly fromStatus: string | null
  readonly toStatus: string
  readonly actor: string
  readonly actorId: string | null
  readonly reason: string | null
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

function service(): SellerOrderService {
  return api.resolve<SellerOrderService>(SellerOrderService)
}

function prisma(): PrismaService {
  return api.resolve<PrismaService>(PrismaService)
}

function orders(): OrderService {
  return api.resolve<OrderService>(OrderService)
}

function sweeper(): ReservationSweeperService {
  return api.resolve<ReservationSweeperService>(ReservationSweeperService)
}

/** 헤더로 오는 것과 같은 주체를, 서비스를 직접 부를 때 쓰려고. */
function principalOf(caller: TestCaller): RequestPrincipal {
  return {
    app: 'admin',
    userId: caller.userId,
    roles: [...caller.roles],
    sellerId: caller.sellerId ?? null,
  }
}

/** 팔 수 있는 조합 하나와 그 가게의 주인. */
async function listing(): Promise<{ variantId: string; seller: TestCaller }> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    status: 'ACTIVE',
    minPrice: 10_000,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: 10_000,
    stock: 10,
    isActive: true,
  })

  return {
    variantId: variant.id,
    seller: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: seller.id },
  }
}

/**
 * 진짜 주문 하나. 장바구니 → 주문.
 *
 * 표에 직접 넣지 않는 이유는 이 파일이 재는 것이 **실제 주문의 상태**이기 때문이다.
 * 예약도 함께 잡혀야 만료 스케줄러 검사(아래)가 뜻을 갖는다.
 */
async function place(): Promise<Placed> {
  const store = await listing()
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId: store.variantId, quantity: 1 },
    schema: cartResponseSchema,
  })
  const line = cart.groups.flatMap((group) => group.items).at(0)

  if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds: [line.id], addressId },
    schema: orderResponseSchema,
  })
  const sellerOrderId = order.sellerOrders.at(0)?.id

  if (sellerOrderId === undefined) throw new Error('판매자 몫을 찾지 못했습니다.')

  return { orderId: order.id, sellerOrderId, seller: store.seller }
}

/**
 * 이 몫을 어느 상태에서 다시 출발시킨다.
 *
 * 이력까지 지우는 이유는 매트릭스가 「이번 시도가 이력을 남겼는가」를 세기 때문이다.
 * 한 문장인 것은 두 문장 사이에 다른 검사가 끼어들 여지를 없애려는 것이 아니라,
 * 288번 도는 루프에서 왕복 하나가 그대로 288번이기 때문이다.
 */
async function reset(status: OrderStatus, tracking: string | null = null): Promise<void> {
  await db.query(
    `WITH cleared AS (DELETE FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1)
     UPDATE "SellerOrder"
        SET "status" = $2::"SellerOrderStatus", "trackingNumber" = NULL
      WHERE "id" = $1`,
    [placed.sellerOrderId, status],
  )

  if (tracking === null) return

  // **배송 행이 먼저다.** 몫에 남는 번호는 그 행의 사본이고, 사본을 먼저 적으려 들면
  // 복합 외래키가 거절한다 (TASK-0061). 발급 경로를 흉내 내는 것이 아니라 상태
  // 머신이 읽을 사실 하나를 만드는 것이므로 SQL 로 만든다 — 여기서 재는 것은
  // 「운송장이 붙으면 발송이 열린다」이지 「운송장이 어떻게 만들어지는가」가 아니다.
  await db.query(`DELETE FROM "Shipment" WHERE "sellerOrderId" = $1`, [placed.sellerOrderId])
  await db.query(
    `INSERT INTO "Shipment"
       ("id", "sellerOrderId", "carrierCode", "carrierName", "trackingNumber", "shippedAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now())`,
    [placed.sellerOrderId, TRACKING_CARRIER, demoCarrierNames[TRACKING_CARRIER], tracking],
  )
  await db.query(`UPDATE "SellerOrder" SET "trackingNumber" = $2 WHERE "id" = $1`, [
    placed.sellerOrderId,
    tracking,
  ])
}

function stateOf(sellerOrderId: string = placed.sellerOrderId): Promise<RowState> {
  return db.one<RowState>(
    `SELECT "status"::text AS "status",
            (SELECT count(*)::int FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1) AS "history"
       FROM "SellerOrder" WHERE "id" = $1`,
    [sellerOrderId],
  )
}

function historyOf(sellerOrderId: string = placed.sellerOrderId): Promise<HistoryRow[]> {
  return db.query<HistoryRow>(
    `SELECT "fromStatus"::text AS "fromStatus", "toStatus"::text AS "toStatus",
            "actor"::text AS "actor", "actorId", "reason"
       FROM "OrderStatusHistory" WHERE "sellerOrderId" = $1 ORDER BY "id"`,
    [sellerOrderId],
  )
}

const REFUSAL_BY_CODE: Readonly<Record<string, TransitionRefusal>> = {
  ORDER_TRANSITION_UNDEFINED: 'undefined_transition',
  ORDER_TRANSITION_FORBIDDEN: 'actor_forbidden',
  ORDER_TRANSITION_REQUIREMENT: 'requirement_unmet',
}

/**
 * 거절을 **도메인 코드로** 되읽는다.
 *
 * 예외 클래스로 판단하지 않는 이유는 그것이 검사와 구현을 같은 편으로 만들기
 * 때문이다. 코드는 부르는 쪽이 실제로 보는 것이고, 셋이 서로 다른 코드로 나가는 것이
 * 이 TASK 가 약속한 바다.
 */
function refusalOf(error: unknown): TransitionRefusal {
  const payload: unknown = error instanceof HttpException ? error.getResponse() : null
  const code =
    typeof payload === 'object' && payload !== null && 'code' in payload ? String(payload.code) : ''
  const refusal = REFUSAL_BY_CODE[code]

  if (refusal === undefined) throw error

  return refusal
}

function callerAs(actor: Exclude<SellerOrderActor, 'SYSTEM'>): TestCaller {
  switch (actor) {
    case 'BUYER':
      return buyer
    case 'SELLER':
      return placed.seller
    // 운영자(`ADMIN_OPERATOR`)에게는 `order.write` 가 없다 — 지금 매트릭스에서
    // `ADMIN` 을 대표할 수 있는 것은 전부에 닿는 `ADMIN_SUPER` 뿐이다.
    case 'ADMIN':
      return callers.superAdmin
  }
}

/** 이 주체로 전이를 시도하고, 통과했는지 어떤 이유로 거절됐는지만 돌려준다. */
async function run(
  actor: SellerOrderActor,
  to: OrderStatus,
): Promise<'allowed' | TransitionRefusal> {
  try {
    if (actor === 'SYSTEM') {
      // `SYSTEM` 은 HTTP 로 닿지 않는다. 결제와 스케줄러가 지나는 자리를 그대로 쓴다.
      await prisma().$transaction((tx) =>
        service().applyWithin(tx, placed.sellerOrderId, to, { actor: 'SYSTEM', actorId: null }),
      )
    } else {
      await service().transition(principalOf(callerAs(actor)), placed.sellerOrderId, { to })
    }

    return 'allowed'
  } catch (error) {
    return refusalOf(error)
  }
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
}

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
  }
}

function transitionOver(caller: TestCaller, body: unknown): Promise<SellerOrderTransitionResponse> {
  return client(caller).request({
    path: `/seller-orders/${placed.sellerOrderId}/transitions`,
    method: 'POST',
    body,
    schema: sellerOrderTransitionResponseSchema,
  })
}

function actionsOver(caller: TestCaller) {
  return client(caller).request({
    path: `/seller-orders/${placed.sellerOrderId}/actions`,
    method: 'GET',
    schema: sellerOrderActionsResponseSchema,
  })
}

function p95Of(durations: readonly number[]): number {
  const sorted = [...durations].sort((left, right) => left - right)

  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0
}

beforeEach(async () => {
  api.clock.set('2026-09-03T00:00:00.000Z')

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
  placed = await place()
})

describe('전이 매트릭스 전수 (F8)', () => {
  /**
   * 9개 상태 × 9개 상태 × 4개 주체.
   *
   * **기대값을 손으로 다시 적지 않는다.** 표를 검사에 복사하면 그 사본이 곧 두 번째
   * 진실이 되고, 표가 바뀌는 날 둘 중 어느 쪽이 맞는지 아무도 모른다.
   *
   * **그래서 못 잡는 것이 하나 있다: 표 자체가 틀린 경우.** 표가 설계서
   * (`docs/design/state-machines.md` 1장)와 어긋나면 이 검사는 표 편을 든다. 그 몫은
   * 두 곳이 맡는다 — 순수 규칙을 재는 `seller-order-transitions.spec.ts`, 그리고 아래
   * 「설계서에 못 박은 네 줄」이다. 여기서 재는 것은 **서비스가 표를 실제로 지키는가**
   * 이고, 그것은 표가 옳은지와 다른 질문이다.
   *
   * 거절이 **아무것도 남기지 않는 것**까지 함께 본다. 「거절됐다」만 보면 상태를
   * 옮겨 놓고 예외를 던지는 구현이 통과한다.
   */
  it(
    'lets through exactly the table, and refuses without a trace otherwise',
    async () => {
      let attempts = 0

      for (const from of orderStatuses) {
        for (const to of orderStatuses) {
          if (to === from) continue

          for (const actor of sellerOrderActors) {
            const label = `${from} → ${to} (${actor})`
            const expected = transitionDecision({ from, to, actor, hasTracking: false })

            await reset(from)

            const outcome = await run(actor, to)
            const after = await stateOf()

            expect(`${label}: ${outcome}`).toBe(
              `${label}: ${expected.outcome === 'allowed' ? 'allowed' : expected.reason}`,
            )
            expect({ label, ...after }).toEqual(
              expected.outcome === 'allowed'
                ? { label, status: to, history: 1 }
                : { label, status: from, history: 0 },
            )
            attempts += 1
          }
        }
      }

      // 9개 상태 × (자기 자신을 뺀) 8개 목적지 × 4개 주체. 손으로 적어 두는 이유는
      // 루프가 파생이라 **조용히 줄어들 수 있기** 때문이다 — 상태가 하나 늘거나
      // 주체가 하나 빠지면 이 줄이 그것을 알리고, 그때 사람이 표를 한 번 본다.
      expect(attempts).toBe(288)
    },
    MATRIX_BUDGET_MS,
  )

  /**
   * 설계서에 못 박은 네 줄.
   *
   * 위의 전수 검사가 표에서 파생되는 이상, **표가 문서와 어긋나는 경우**는 손으로
   * 적은 기대값만이 잡는다. 넷을 고른 기준은 「틀렸을 때 가장 비싼 것」이다.
   */
  it('holds the four lines the design document names', async () => {
    await reset('PAID')
    expect(await run('SELLER', 'PREPARING')).toBe('allowed')

    // 배송을 건너뛰고 배송완료로 갈 수 없다 (F2).
    await reset('PAID')
    expect(await run('SELLER', 'DELIVERED')).toBe('undefined_transition')

    // 구매확정은 산 사람의 것이다. 판매자가 자기 물건을 확정할 수 없다.
    await reset('DELIVERED')
    expect(await run('SELLER', 'CONFIRMED')).toBe('actor_forbidden')

    // 종착 상태에서는 아무 데도 못 간다.
    await reset('CONFIRMED')
    expect(await run('ADMIN', 'CANCELED')).toBe('undefined_transition')
  })
})

describe('권한 (F3 · A3 · A4)', () => {
  it('refuses a seller reaching into another store’s order', async () => {
    const stranger = (await listing()).seller

    await reset('PAID')

    const refused = await failure(transitionOver(stranger, { to: 'PREPARING' }))

    // 도메인 코드가 아니라 소유권 거절이다. 상태 머신은 이 요청을 본 적도 없다 —
    // 남의 주문에 어떤 전이가 열려 있는지 알려 주지 않는 것이 옳다.
    expect(refused).toMatchObject({ status: 403, code: 'FORBIDDEN' })
    expect(await stateOf()).toEqual({ status: 'PAID', history: 0 })
  })

  it('ignores an actor claimed in the body', async () => {
    await reset('PAYMENT_PENDING')

    // `PAYMENT_PENDING → PAID` 는 `SYSTEM` 만 지난다. 본문으로 주체를 주장할 수
    // 있었다면 구매자가 결제 없이 자기 주문을 결제 완료로 만들 수 있다.
    const refused = await failure(transitionOver(buyer, { to: 'PAID', actor: 'SYSTEM' }))

    expect(refused).toMatchObject({ status: 403, code: 'ORDER_TRANSITION_FORBIDDEN' })
    expect(await stateOf()).toEqual({ status: 'PAYMENT_PENDING', history: 0 })
  })

  it('answers 401 to a caller with no session', async () => {
    const refused = await failure(
      api.client.request({
        path: `/seller-orders/${placed.sellerOrderId}/actions`,
        method: 'GET',
        schema: sellerOrderActionsResponseSchema,
      }),
    )

    expect(refused.status).toBe(401)
  })
})

describe('조건 (F4)', () => {
  it('refuses SHIPPED without a tracking number, and lets it through once one is attached', async () => {
    await reset('PREPARING')

    const refused = await failure(transitionOver(placed.seller, { to: 'SHIPPED' }))

    expect(refused).toMatchObject({ status: 409, code: 'ORDER_TRANSITION_REQUIREMENT' })
    // 셋 중 유일하게 **채우면 되는** 거절이라, 무엇을 채워야 하는지가 입력 이름으로
    // 나간다. 화면은 그 입력에 오류를 붙일 수 있다.
    expect(refused.details).toContainEqual(
      expect.objectContaining({ field: 'trackingNumber', code: 'ORDER_TRANSITION_REQUIREMENT' }),
    )
    expect(await stateOf()).toEqual({ status: 'PREPARING', history: 0 })

    await reset('PREPARING', TRACKING_NUMBER)

    expect(await transitionOver(placed.seller, { to: 'SHIPPED' })).toMatchObject({
      status: 'SHIPPED',
      changed: true,
    })
  })
})

describe('멱등과 동시성 (F6)', () => {
  it('answers the retry with success and leaves the history alone', async () => {
    await reset('PAID')

    const first = await transitionOver(placed.seller, { to: 'PREPARING' })
    const again = await transitionOver(placed.seller, { to: 'PREPARING' })

    expect(first).toMatchObject({ status: 'PREPARING', changed: true })
    // 「정의되지 않은 전이」로 거절하면 재시도한 화면이 오류를 보는데, 그 사람이
    // 원한 결과는 이미 이뤄져 있다.
    expect(again).toMatchObject({ status: 'PREPARING', changed: false })
    expect(await stateOf()).toEqual({ status: 'PREPARING', history: 1 })
  })

  it('moves once and logs once when the same transition arrives twice at once', async () => {
    await reset('PAID')

    const gate = barrier(2)
    const results = await concurrently(2, async () => {
      await gate.arrive()

      return service().transition(principalOf(placed.seller), placed.sellerOrderId, {
        to: 'PREPARING',
      })
    })

    expect(rejected(results)).toEqual([])

    // 둘 다 성공으로 답하지만 **옮긴 것은 하나**다. 행 잠금이 없으면 둘 다
    // `changed: true` 를 받고 이력이 두 줄이 되며, 아무것도 실패하지 않는다.
    expect(fulfilled(results).filter((result) => result.changed)).toHaveLength(1)
    expect(await stateOf()).toEqual({ status: 'PREPARING', history: 1 })
  })
})

describe('이력 (F5)', () => {
  it('records who moved it, from where to where, and why', async () => {
    await reset('PAID')

    await transitionOver(placed.seller, { to: 'PREPARING' })
    await reset('PREPARING', TRACKING_NUMBER)
    await transitionOver(placed.seller, { to: 'SHIPPED', reason: '오늘 출고분' })
    await transitionOver(placed.seller, { to: 'DELIVERED' })
    await transitionOver(buyer, { to: 'CONFIRMED' })

    // `reset` 이 이력을 지우므로 남는 것은 운송장을 붙인 뒤의 셋이다.
    expect(await historyOf()).toEqual([
      {
        fromStatus: 'PREPARING',
        toStatus: 'SHIPPED',
        actor: 'SELLER',
        actorId: placed.seller.userId,
        reason: '오늘 출고분',
      },
      {
        fromStatus: 'SHIPPED',
        toStatus: 'DELIVERED',
        actor: 'SELLER',
        actorId: placed.seller.userId,
        reason: null,
      },
      {
        fromStatus: 'DELIVERED',
        toStatus: 'CONFIRMED',
        actor: 'BUYER',
        actorId: buyer.userId,
        reason: null,
      },
    ])
  })

  it('marks the row a buyer created as the buyer’s', async () => {
    // 생성 줄은 전이가 아니라 태어남이다(`fromStatus` 가 없다). 그래도 주체는
    // 있다 — 주문서를 만든 것은 산 사람이고, 그것을 `SYSTEM` 으로 적으면 이력이
    // 「기계가 주문했다」고 말한다.
    expect(await historyOf()).toEqual([
      {
        fromStatus: null,
        toStatus: 'PAYMENT_PENDING',
        actor: 'BUYER',
        actorId: null,
        reason: null,
      },
    ])
  })
})

describe('가능 액션 (F7)', () => {
  it('answers a seller with what a seller can press', async () => {
    await reset('PAID')

    expect(await actionsOver(placed.seller)).toEqual({
      status: 'PAID',
      actions: [
        { to: 'PREPARING', enabled: true, blockedBy: null },
        { to: 'CANCELED', enabled: true, blockedBy: null },
      ],
    })
  })

  it('keeps a blocked action in the list and says what it needs', async () => {
    await reset('PREPARING')

    // **버튼을 감추지 않는다.** 운송장이 없다고 발송 버튼을 지우면 판매자는 그
    // 버튼을 찾다가 포기한다 — 보이고, 무엇이 필요한지 말해 주는 편이 낫다.
    expect(await actionsOver(placed.seller)).toEqual({
      status: 'PREPARING',
      actions: [
        { to: 'SHIPPED', enabled: false, blockedBy: 'tracking' },
        { to: 'CANCELED', enabled: true, blockedBy: null },
      ],
    })

    await reset('PREPARING', TRACKING_NUMBER)

    expect((await actionsOver(placed.seller)).actions.at(0)).toEqual({
      to: 'SHIPPED',
      enabled: true,
      blockedBy: 'tracking',
    })
  })

  it('answers the same order differently depending on who is asking', async () => {
    await reset('PAID')
    // 산 사람은 결제된 주문에 할 것이 없다 — 취소는 클레임 절차를 지난다(M10).
    expect((await actionsOver(buyer)).actions).toEqual([])

    await reset('DELIVERED')
    expect((await actionsOver(buyer)).actions).toEqual([
      { to: 'CONFIRMED', enabled: true, blockedBy: null },
    ])
    expect((await actionsOver(placed.seller)).actions).toEqual([
      { to: 'RETURNED', enabled: true, blockedBy: null },
    ])
  })
})

describe('이미 있던 두 곳도 이 문을 지난다', () => {
  it('marks an order paid as SYSTEM, through the state machine', async () => {
    await orders().markPaid(placed.orderId)

    expect(await stateOf()).toEqual({ status: 'PAID', history: 2 })
    expect((await historyOf()).at(1)).toEqual({
      fromStatus: 'PAYMENT_PENDING',
      toStatus: 'PAID',
      // 사람이 「결제됨」을 누르는 화면은 없다. 없는 사람을 지어내지도 않는다.
      actor: 'SYSTEM',
      actorId: null,
      reason: null,
    })

    // 멱등은 그대로다. 두 번째 호출은 아무것도 더하지 않는다 (TASK-0056).
    await orders().markPaid(placed.orderId)
    expect(await stateOf()).toEqual({ status: 'PAID', history: 2 })
  })

  it('fails a stranded order as SYSTEM, through the state machine', async () => {
    api.clock.advance(PAST_TTL_MS)

    expect(await sweeper().sweep()).toMatchObject({ released: 1, failedOrders: 1, skipped: false })
    expect(await stateOf()).toEqual({ status: 'PAYMENT_FAILED', history: 2 })
    expect((await historyOf()).at(1)).toMatchObject({
      fromStatus: 'PAYMENT_PENDING',
      toStatus: 'PAYMENT_FAILED',
      actor: 'SYSTEM',
      actorId: null,
    })
  })

  it('refuses to drag a paid order backwards', async () => {
    await reset('PREPARING')

    // 스케줄러가 늦게 도착해도 준비중인 주문을 결제 실패로 만들지 못한다. 예전의
    // `updateMany` 는 조건이 `PAYMENT_PENDING` 이라 조용히 아무것도 안 했지만,
    // 이제는 문이 그것을 **규칙으로** 막는다.
    expect(await run('SYSTEM', 'PAYMENT_FAILED')).toBe('undefined_transition')
    expect(await stateOf()).toEqual({ status: 'PREPARING', history: 0 })
  })
})

describe('응답 시간 (A1)', () => {
  it(
    'answers a transition under the p95 budget',
    async () => {
      const durations: number[] = []

      for (let sample = 0; sample < SAMPLES; sample += 1) {
        await reset('PAID')

        const started = performance.now()

        await transitionOver(placed.seller, { to: 'PREPARING' })
        durations.push(performance.now() - started)
      }

      expect(p95Of(durations)).toBeLessThanOrEqual(P95_BUDGET_MS)
    },
    SAMPLING_BUDGET_MS,
  )
})
