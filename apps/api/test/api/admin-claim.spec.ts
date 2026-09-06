import { randomUUID } from 'node:crypto'

import type {
  AdminClaimListResponse,
  AdminFailedRefundListResponse,
  AdminOverdueClaimsResponse,
  Claim,
  ClaimResponse,
  OrderStatus,
} from '@shopping/shared'
import {
  adminClaimListResponseSchema,
  adminFailedRefundListResponseSchema,
  adminOverdueClaimsResponseSchema,
  ApiClientError,
  claimResponseSchema,
  claimTransitionResponseSchema,
  returnResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { fixedClock } from '../support/clock.js'
import { useDatabase } from '../support/database.js'
import {
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 관리자의 클레임 개입 (TASK-0071), 이 워커의 실제 데이터베이스에 대고.
 *
 * 순수 판단이 옳은지는 `admin-claim-rules.spec.ts` 가 잰다. **여기서 재는 것은 그
 * 판단이 실제 행과 실제 권한에 적용되는가**이고, TASK 의 완료 기준에 붙은 것들이다.
 *
 * | 무엇을 | 왜 그것이 증거인가 |
 * | --- | --- |
 * | 거절을 뒤집으면 **새 클레임**이 서고 원본을 가리킨다 | 이 TASK 의 설계 판단이 실제로 그 모양인가 (F3) |
 * | 개입 이력에 **누가·왜**가 있다 | 판매자의 돈이 나가는 일이라 근거가 남아야 한다 (F6) |
 * | 확정된 주문이 반품으로 `RETURNED` 가 된다 | 4.0 이 연 화살표를 실제로 지나는 코드가 있는가 (F4) |
 * | **판매자는 그 마지막 걸음을 못 밟는다** | 주체가 `ADMIN` 뿐이라는 것이 표에만 있는 값이 아닌가 |
 * | 구매자에게는 확정 후 반품이 여전히 막혀 있다 | `claimEligibility` 를 고치지 않았다는 유일한 증거 |
 * | **데모 관리자가 실계정 건에서 403, 데모 건에서 성공** | `demo` 스코프가 실제로 무는가 (F5 · F5b) |
 * | 구매자가 `/admin/claims` 를 부르면 403 | `claim.read:own` 은 모두가 갖고 있다 |
 * | 지연 목록이 영업일 판정을 지나 나온다 | 컷오프가 SQL 이고 판정이 순수 함수인 조합이 실제로 맞물리는가 (F7) |
 *
 * **결제사도 붙이지 않는다.** 이 TASK 가 재는 것에 실제 환불이 없기 때문이다 —
 * 승인 뒤의 환불은 TASK-0068 의 스펙(`refund.spec.ts`)이 이미 재고, 여기서 한 번 더
 * 재면 같은 것을 두 곳에서 세게 된다. 실패한 환불 목록만 행을 직접 심어 잰다.
 */

const db = useDatabase()
const NOW = '2026-09-08T05:00:00.000Z'
const clock = fixedClock(NOW)
const api = useApiApp({ database: db, authenticate: true, clock })

interface Store {
  readonly sellerId: string
  readonly ownerId: string
  readonly seller: TestCaller
  readonly variantId: string
  readonly productId: string
}

interface Seeded {
  readonly orderId: string
  readonly sellerOrderId: string
  readonly orderItemId: string
}

let categoryId: number
let operator: TestCaller
let demoAdmin: TestCaller
let realBuyer: TestCaller
let demoBuyer: TestCaller
let realStore: Store
let demoStore: Store

beforeEach(async () => {
  clock.set(NOW)
  categoryId = (await createCategory(db, {})).id

  operator = { userId: (await createUser(db, {})).id, roles: ['ADMIN_OPERATOR'] }
  demoAdmin = { userId: (await demoAccount()).id, roles: ['DEMO_ADMIN'] }
  realBuyer = { userId: (await createUser(db, {})).id, roles: ['BUYER'] }
  demoBuyer = { userId: (await demoAccount()).id, roles: ['BUYER'] }
  realStore = await storefront(false)
  demoStore = await storefront(true)
})

/** 데모 계정 하나. 두 컬럼이 함께 채워져야 `User_demo_expiry_check` 를 지난다. */
async function demoAccount() {
  return createUser(db, {
    isDemo: true,
    demoExpiresAt: new Date(Date.parse(NOW) + 24 * 60 * 60 * 1_000),
  })
}

/**
 * 팔 것이 있는 가게 하나.
 *
 * **주인이 데모인가가 인자다.** 스코프가 읽는 것은 스토어가 아니라 그 스토어를 가진
 * 계정의 플래그이고(`sellerOwnership`), 그 차이가 F5 와 F5b 를 가른다.
 */
async function storefront(isDemo: boolean): Promise<Store> {
  const owner = isDemo ? await demoAccount() : await createUser(db, {})
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
    stock: 100,
    isActive: true,
  })

  return {
    sellerId: seller.id,
    ownerId: owner.id,
    seller: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: seller.id },
    productId: product.id,
    variantId: variant.id,
  }
}

let sequence = 0

/**
 * 주문 한 몫을 **원하는 상태로** 심는다.
 *
 * 체크아웃부터 걷지 않는 이유는 이 스펙이 재는 것이 그 앞이 아니기 때문이다 —
 * 결제까지 실제로 태우면 `CONFIRMED` 하나를 만드는 데 결제사 대역과 시뮬레이터가
 * 필요하고, 그것들은 자기 스펙이 이미 재고 있다.
 *
 * `deliveredAt` 을 이력에 함께 심는 것은 **반품 기간을 그 이력에서 읽기** 때문이다
 * (TASK-0064 4.1). 없으면 구매자의 반품 신청이 언제나 기간 밖으로 판정된다.
 */
async function seedOrder(options: {
  readonly store: Store
  readonly buyerId: string
  readonly status: OrderStatus
  readonly quantity?: number
  readonly deliveredAt?: Date
}): Promise<Seeded> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()
  const orderItemId = randomUUID()
  const quantity = options.quantity ?? 2

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             $4, $4, now())`,
    [orderId, `20260908-${String(sequence).padStart(8, '0')}`, options.buyerId, quantity * 10_000],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "updatedAt")
     VALUES ($1, $2, $3, $4::"SellerOrderStatus", '가상브랜드', $5, $5, 3000, now())`,
    [sellerOrderId, orderId, options.store.sellerId, options.status, quantity * 10_000],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productId", "productSnapshot", "unitPrice",
        "quantity", "productAmount", "claimedQuantity", "commissionRateBp", "updatedAt")
     SELECT $1, $2, $3, pv."productId", $4::jsonb, 10000, $5, $6, 0, 1000, now()
       FROM "ProductVariant" pv WHERE pv."id" = $3`,
    [
      orderItemId,
      sellerOrderId,
      options.store.variantId,
      JSON.stringify({
        productId: options.store.productId,
        productName: '울 코트',
        optionLabel: '블랙 / M',
        sku: `SKU-${String(sequence)}`,
        thumbnailUrl: 'https://cdn.test.invalid/coat.jpg',
        brandName: '가상브랜드',
      }),
      quantity,
      quantity * 10_000,
    ],
  )

  if (options.deliveredAt !== undefined) {
    await db.execute(
      `INSERT INTO "OrderStatusHistory"
         ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "createdAt")
       VALUES (gen_random_uuid(), $1, 'SHIPPED'::"SellerOrderStatus",
               'DELIVERED'::"SellerOrderStatus", 'SYSTEM'::"OrderActor", $2::timestamptz)`,
      [sellerOrderId, options.deliveredAt.toISOString()],
    )
  }

  return { orderId, sellerOrderId, orderItemId }
}

/** 구매자가 신청하고 판매자가 거절한 취소 하나. 실제 라우트를 그대로 걷는다. */
async function rejectedCancel(store: Store, buyer: TestCaller): Promise<Claim> {
  const seeded = await seedOrder({ store, buyerId: buyer.userId, status: 'PREPARING' })
  const { claim } = await api.clientAs(buyer).request({
    path: '/claims',
    method: 'POST',
    body: {
      sellerOrderId: seeded.sellerOrderId,
      items: [{ orderItemId: seeded.orderItemId, quantity: 2 }],
      reason: '색상이 화면과 달라요.',
      fault: 'CUSTOMER',
    },
    schema: claimResponseSchema,
  })

  await api.clientAs(store.seller).request({
    path: `/claims/${claim.id}/transitions`,
    method: 'POST',
    body: { to: 'CANCEL_REJECTED', reason: '이미 포장을 마쳤어요.' },
    schema: claimTransitionResponseSchema,
  })

  return (await claimOf(buyer, claim.id)).claim
}

/**
 * 구매자가 낸 반품 하나와 그 거절 — **단순 변심이라 사진이 없다.**
 *
 * 사진이 없는 것이 이 조합의 요점이다. 관리자가 이것을 **하자로** 뒤집으면 사유가
 * 바뀌고, 하자·오배송은 사진이 필수다(`returnPhotoDecision`) — 원본에는 붙일 것이
 * 없으므로 관리자가 자기 계정으로 올려 붙이는 수밖에 없다.
 *
 * 배송완료 시각을 1분 전으로 심는 것은 **구매자 쪽 문**을 지나기 위해서다. 반품
 * 기간은 압축 모드에서 5분이고(`autoConfirmWindowMsOf`), 그 창이 닫힌 뒤에도 관리자는
 * 뒤집을 수 있지만 구매자는 애초에 신청을 낼 수 없다.
 */
async function rejectedReturn(store: Store, buyer: TestCaller): Promise<Claim> {
  const seeded = await seedOrder({
    store,
    buyerId: buyer.userId,
    status: 'DELIVERED',
    deliveredAt: new Date(Date.parse(NOW) - 60_000),
  })
  const { claim } = await api.clientAs(buyer).request({
    path: '/claims',
    method: 'POST',
    body: {
      sellerOrderId: seeded.sellerOrderId,
      items: [{ orderItemId: seeded.orderItemId, quantity: 2 }],
      reason: '생각한 색이 아니에요.',
      return: { returnReason: 'CHANGE_OF_MIND', photoKeys: [] },
    },
    schema: claimResponseSchema,
  })

  await api.clientAs(store.seller).request({
    path: `/claims/${claim.id}/transitions`,
    method: 'POST',
    body: { to: 'RETURN_REJECTED', reason: '사용 흔적이 있습니다.' },
    schema: claimTransitionResponseSchema,
  })

  return (await claimOf(buyer, claim.id)).claim
}

function claimOf(caller: TestCaller, claimId: string): Promise<ClaimResponse> {
  return api.clientAs(caller).request({ path: `/claims/${claimId}`, schema: claimResponseSchema })
}

function adminList(query = '', caller: TestCaller = operator): Promise<AdminClaimListResponse> {
  return api
    .clientAs(caller)
    .request({ path: `/admin/claims${query}`, schema: adminClaimListResponseSchema })
}

async function statusOf(sellerOrderId: string): Promise<string> {
  const row = await db.one<{ status: string }>(
    `SELECT "status" FROM "SellerOrder" WHERE "id" = $1`,
    [sellerOrderId],
  )

  return row.status
}

async function statusIs(caller: TestCaller, claimId: string): Promise<string> {
  return (await claimOf(caller, claimId)).claim.status
}

/**
 * 이 사람이 올린 사진 한 장의 열쇠.
 *
 * **주인이 접두어에 있다** (`isOwnPhotoKey`). 관리자 개입에서 그 주인은 신청을 내는
 * 사람 — 곧 관리자다. 구매자가 붙였던 사진을 그대로 실을 수 없는 것이 이 형식의
 * 결과이고, 두 갈래(확정 후 반품 · 거절 뒤집기)가 같은 열쇠를 쓴다.
 */
const photo = (userId: string): string => `returns/${userId}/${randomUUID()}.jpg`

/** 던진 것이 API 오류이면 그 상태 코드, 아니면 다시 던진다. */
async function statusOfFailure(work: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await work()
  } catch (error) {
    if (error instanceof ApiClientError) return error.status

    throw error
  }

  throw new Error('요청이 거절되지 않았습니다.')
}

/**
 * 거절의 **상태와 코드**.
 *
 * 상태만으로 모자란 자리가 하나 있다 — 사진의 거절은 다섯이 저마다 다른 코드로
 * 나가고(TASK-0067 F2), 화면이 갈리는 것도 그 코드다. 400 하나로 재면 「사진이
 * 없다」와 「사진을 붙일 수 없다」가 같은 답이 된다.
 */
async function refusalOf(
  work: () => Promise<unknown>,
): Promise<{ readonly status: number | undefined; readonly code: string | null }> {
  try {
    await work()
  } catch (error) {
    if (error instanceof ApiClientError) return { status: error.status, code: error.code }

    throw error
  }

  throw new Error('요청이 거절되지 않았습니다.')
}

// --------------------------------------------------------------- 1. 강제 처리

describe('1. 거절을 뒤집으면 새 클레임이 서고 원본을 가리킨다 (F3 · F6)', () => {
  it('creates an approved intervention that names the rejection it overturns', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)

    const { claim } = await api.clientAs(operator).request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: rejected.sellerOrderId,
        items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 2 }],
        reason: '판매자 귀책이 확인되어 취소를 승인합니다.',
        fault: 'SELLER',
        overturnsClaimId: rejected.id,
      },
      schema: claimResponseSchema,
    })

    expect({
      id: claim.id === rejected.id,
      status: claim.status,
      overturns: claim.overturnsClaimId,
    }).toEqual({ id: false, status: 'CANCEL_APPROVED', overturns: rejected.id })

    // **원본은 거절된 채 남는다.** 관리자는 판매자가 거절했다는 사실을 없앤 것이
    // 아니라 다른 결론을 낸 것이고, 그 둘을 잇는 것이 이 두 필드다.
    const original = await claimOf(realBuyer, rejected.id)

    expect({
      status: original.claim.status,
      overturnedBy: original.claim.overturnedByClaimIds,
    }).toEqual({ status: 'CANCEL_REJECTED', overturnedBy: [claim.id] })
  })

  /**
   * **개입 이력에 누가·왜가 있다** (F6).
   *
   * 관리자가 판매자 결정을 뒤집는 것은 판매자의 돈이 나가는 일이다. 근거가 남지
   * 않으면 분쟁이 관리자로 옮겨갈 뿐이다 (TASK 문서 4장).
   */
  it('records the administrator and the reason on every step of the intervention', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)
    const { claim } = await api.clientAs(operator).request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: rejected.sellerOrderId,
        items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 1 }],
        reason: '하자 사진이 명확합니다.',
        fault: 'SELLER',
        overturnsClaimId: rejected.id,
      },
      schema: claimResponseSchema,
    })

    expect(
      claim.history.map((entry) => ({
        to: entry.toStatus,
        actor: entry.actor,
        by: entry.actorId,
        reason: entry.reason,
      })),
    ).toEqual([
      {
        to: 'CANCEL_REQUESTED',
        actor: 'ADMIN',
        by: operator.userId,
        reason: '하자 사진이 명확합니다.',
      },
      {
        to: 'CANCEL_APPROVED',
        actor: 'ADMIN',
        by: operator.userId,
        reason: '하자 사진이 명확합니다.',
      },
    ])
  })

  it('refuses to overturn a claim that has not concluded yet', async () => {
    const seeded = await seedOrder({
      store: realStore,
      buyerId: realBuyer.userId,
      status: 'PREPARING',
    })
    const { claim } = await api.clientAs(realBuyer).request({
      path: '/claims',
      method: 'POST',
      body: {
        sellerOrderId: seeded.sellerOrderId,
        items: [{ orderItemId: seeded.orderItemId, quantity: 1 }],
        reason: '변심이에요.',
        fault: 'CUSTOMER',
      },
      schema: claimResponseSchema,
    })

    const status = await statusOfFailure(() =>
      api.clientAs(operator).request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: seeded.sellerOrderId,
          items: [{ orderItemId: seeded.orderItemId, quantity: 1 }],
          reason: '개입합니다.',
          fault: 'SELLER',
          overturnsClaimId: claim.id,
        },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(409)
  })

  it('refuses a rejection that belongs to another order', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)
    const other = await seedOrder({
      store: realStore,
      buyerId: realBuyer.userId,
      status: 'PREPARING',
    })

    const status = await statusOfFailure(() =>
      api.clientAs(operator).request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: other.sellerOrderId,
          items: [{ orderItemId: other.orderItemId, quantity: 1 }],
          reason: '개입합니다.',
          fault: 'SELLER',
          overturnsClaimId: rejected.id,
        },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(409)
  })

  /**
   * **판매자는 이 문으로 들어올 수 없다.**
   *
   * `claim.handle:own` 은 자기 가게의 클레임에 대해 통과하므로 퍼미션만으로는 부족하고,
   * 막는 것은 주체 확인(`requireActor`)이다. 없으면 판매자가 **자기 거절을 자기가
   * 뒤집는** 행을 만들 수 있다.
   */
  /**
   * **반품 거절을 하자로 뒤집으려면 사진이 필요하다.**
   *
   * 이 조합이 스펙에 없어서 구멍이 보이지 않았다 — 뒤집기 검사는 취소만 뒤집었고,
   * 사진을 재는 검사는 확정 후 반품(2장)과 구매자 신청(`return-flow.spec.ts`)에만
   * 있었다. 그동안 관리자 콘솔은 `photoKeys: []` 를 보내고 있었고, 프론트 대역이 이
   * 갈래에서 판정을 지나지 않아 **실 서버에서만** 400 이었다.
   *
   * 유형을 요청이 주장하지 않는다는 것도 여기서 함께 드러난다 — 원본이 단순 변심
   * 반품이어도 개입은 사유를 다시 정하고, 그 사유가 사진을 요구한다.
   */
  it('refuses to overturn a rejected return as a defect with no photo', async () => {
    const rejected = await rejectedReturn(realStore, realBuyer)

    const refused = await refusalOf(() =>
      api.clientAs(operator).request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: rejected.sellerOrderId,
          items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 2 }],
          reason: '구매자가 보낸 사진에서 하자가 확인됩니다.',
          return: { returnReason: 'DEFECTIVE', photoKeys: [] },
          overturnsClaimId: rejected.id,
        },
        schema: claimResponseSchema,
      }),
    )

    expect(refused).toEqual({ status: 400, code: 'RETURN_PHOTO_REQUIRED' })

    // 거절된 요청은 **아무것도 남기지 않는다.** 원본은 거절된 채 그대로다.
    expect((await claimOf(realBuyer, rejected.id)).claim.overturnedByClaimIds).toEqual([])
  })

  it('stands the intervention when the administrator attaches one', async () => {
    const rejected = await rejectedReturn(realStore, realBuyer)

    const { claim } = await api.clientAs(operator).request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: rejected.sellerOrderId,
        items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 2 }],
        reason: '구매자가 보낸 사진에서 하자가 확인됩니다.',
        return: { returnReason: 'DEFECTIVE', photoKeys: [photo(operator.userId)] },
        overturnsClaimId: rejected.id,
      },
      schema: claimResponseSchema,
    })

    // 사유가 귀책을 정한다 — 단순 변심이던 원본이 판매자 귀책으로 다시 판정된다.
    expect({
      status: claim.status,
      fault: claim.fault,
      overturns: claim.overturnsClaimId,
    }).toEqual({ status: 'RETURN_APPROVED', fault: 'SELLER', overturns: rejected.id })
  })

  /** 사진의 주인은 **신청을 내는 사람**이다 — 구매자의 열쇠를 실을 수 없다. */
  it('refuses a photo key that belongs to the buyer rather than the administrator', async () => {
    const rejected = await rejectedReturn(realStore, realBuyer)

    const refused = await refusalOf(() =>
      api.clientAs(operator).request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: rejected.sellerOrderId,
          items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 2 }],
          reason: '구매자가 보낸 사진을 그대로 붙입니다.',
          return: { returnReason: 'DEFECTIVE', photoKeys: [photo(realBuyer.userId)] },
          overturnsClaimId: rejected.id,
        },
        schema: claimResponseSchema,
      }),
    )

    expect(refused).toEqual({ status: 400, code: 'RETURN_PHOTO_FOREIGN' })
  })

  it('never lets a seller overturn their own rejection', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)

    const status = await statusOfFailure(() =>
      api.clientAs(realStore.seller).request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: rejected.sellerOrderId,
          items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 1 }],
          reason: '제가 다시 봤습니다.',
          fault: 'SELLER',
          overturnsClaimId: rejected.id,
        },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(403)
  })
})

// ------------------------------------------------------ 2. 구매확정 후 하자 반품

describe('2. 구매확정 후 하자 반품 (F4)', () => {
  /**
   * 관리자가 수거와 입고를 **혼자** 민다.
   *
   * 뒤집힌 판매자에게 「수거를 눌러라」를 요구할 수 없고, 확정 후 하자 반품에는
   * 애초에 판매자의 걸음이 없다. 두 걸음의 문이 다른 것은 앞엣것이 회수 운송장을
   * 발급하기 때문이고(`claimActionRouteOf`), 그 나눔은 TASK-0070 의 것이다.
   */
  async function walkToInspecting(claimId: string): Promise<void> {
    await api.clientAs(operator).request({
      path: `/returns/${claimId}/pickup`,
      method: 'POST',
      schema: returnResponseSchema,
    })
    await api.clientAs(operator).request({
      path: `/claims/${claimId}/transitions`,
      method: 'POST',
      body: { to: 'INSPECTING' },
      schema: claimTransitionResponseSchema,
    })
  }

  async function confirmedReturn(): Promise<{ readonly claim: Claim; readonly seeded: Seeded }> {
    const seeded = await seedOrder({
      store: realStore,
      buyerId: realBuyer.userId,
      status: 'CONFIRMED',
    })
    const { claim } = await api.clientAs(operator).request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: seeded.sellerOrderId,
        items: [{ orderItemId: seeded.orderItemId, quantity: 2 }],
        reason: '확정 뒤에 하자가 확인되었습니다.',
        return: { returnReason: 'DEFECTIVE', photoKeys: [photo(operator.userId)] },
      },
      schema: claimResponseSchema,
    })

    return { claim, seeded }
  }

  /** 구매자에게는 여전히 막혀 있다 — `claimEligibility` 를 고치지 않았다는 증거다. */
  it('still refuses the buyer, which is what the untouched rule answers', async () => {
    const seeded = await seedOrder({
      store: realStore,
      buyerId: realBuyer.userId,
      status: 'CONFIRMED',
    })

    const status = await statusOfFailure(() =>
      api.clientAs(realBuyer).request({
        path: '/claims',
        method: 'POST',
        body: {
          sellerOrderId: seeded.sellerOrderId,
          items: [{ orderItemId: seeded.orderItemId, quantity: 1 }],
          reason: '하자가 있어요.',
          return: { returnReason: 'DEFECTIVE', photoKeys: [photo(realBuyer.userId)] },
        },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(409)
  })

  it('opens an approved return on a confirmed order for the administrator', async () => {
    const { claim, seeded } = await confirmedReturn()

    expect({
      type: claim.type,
      status: claim.status,
      order: await statusOf(seeded.sellerOrderId),
    }).toEqual({ type: 'RETURN', status: 'RETURN_APPROVED', order: 'CONFIRMED' })
  })

  /**
   * **결론이 주문을 옮긴다.**
   *
   * 이 화살표(`CONFIRMED → RETURNED`)를 지나는 코드가 없던 동안 「환불·재고는
   * 돌아가는데 주문은 확정」인 상태가 가능했다 — 4.0 이 거부한 바로 그 모양이다.
   */
  it('moves the order to RETURNED once the goods have passed inspection', async () => {
    const { claim, seeded } = await confirmedReturn()

    await walkToInspecting(claim.id)
    await api.clientAs(operator).request({
      path: `/returns/${claim.id}/inspection`,
      method: 'POST',
      body: { passed: true },
      schema: returnResponseSchema,
    })

    // 클레임이 `RETURN_COMPLETED` 에서 멈춘 것이 정상이다 — 이 주문에는 결제가 없어
    // 환불이 나갈 곳이 없고, 실제 환불은 `refund.spec.ts` 가 잰다. 여기서 재는 것은
    // **결론이 주문을 옮겼는가** 하나다.
    expect({
      claim: await statusIs(operator, claim.id),
      order: await statusOf(seeded.sellerOrderId),
    }).toEqual({ claim: 'RETURN_COMPLETED', order: 'RETURNED' })
  })

  /**
   * **판매자는 그 마지막 걸음을 못 밟는다** — 주체가 `ADMIN` 뿐이다 (4.0).
   *
   * 그리고 거절된 요청은 **아무것도 남기지 않는다**: 검수 기록과 전이가 한
   * 트랜잭션이라 주문도 클레임도 그대로다.
   */
  it('refuses the seller the last step, and leaves nothing behind when it does', async () => {
    const { claim, seeded } = await confirmedReturn()

    await walkToInspecting(claim.id)

    const refused = await statusOfFailure(() =>
      api.clientAs(realStore.seller).request({
        path: `/returns/${claim.id}/inspection`,
        method: 'POST',
        body: { passed: true },
        schema: returnResponseSchema,
      }),
    )

    expect({
      refused: refused !== undefined,
      claim: await statusIs(operator, claim.id),
      order: await statusOf(seeded.sellerOrderId),
    }).toEqual({ refused: true, claim: 'INSPECTING', order: 'CONFIRMED' })
  })
})

// --------------------------------------------------------------- 3. 이의 제기

describe('3. 이의 제기 (F2)', () => {
  it('lets the buyer appeal a rejection and leaves the claim where it was', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)

    const { claim } = await api.clientAs(realBuyer).request({
      path: `/claims/${rejected.id}/appeal`,
      method: 'POST',
      body: { reason: '포장 전이었다는 증거가 있어요.' },
      schema: claimResponseSchema,
    })

    expect({
      status: claim.status,
      filedBy: claim.appeal?.filedById,
      reviewedAt: claim.appeal?.reviewedAt,
      outcome: claim.appeal?.outcome,
    }).toEqual({
      status: 'CANCEL_REJECTED',
      filedBy: realBuyer.userId,
      reviewedAt: null,
      outcome: null,
    })
  })

  it('refuses a second appeal on the same rejection', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)
    const appeal = { reason: '다시 봐 주세요.' }

    await api.clientAs(realBuyer).request({
      path: `/claims/${rejected.id}/appeal`,
      method: 'POST',
      body: appeal,
      schema: claimResponseSchema,
    })

    const status = await statusOfFailure(() =>
      api.clientAs(realBuyer).request({
        path: `/claims/${rejected.id}/appeal`,
        method: 'POST',
        body: appeal,
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(409)
  })

  it('refuses an appeal on a claim nobody has concluded', async () => {
    const seeded = await seedOrder({
      store: realStore,
      buyerId: realBuyer.userId,
      status: 'PREPARING',
    })
    const { claim } = await api.clientAs(realBuyer).request({
      path: '/claims',
      method: 'POST',
      body: {
        sellerOrderId: seeded.sellerOrderId,
        items: [{ orderItemId: seeded.orderItemId, quantity: 1 }],
        reason: '변심이에요.',
        fault: 'CUSTOMER',
      },
      schema: claimResponseSchema,
    })

    const status = await statusOfFailure(() =>
      api.clientAs(realBuyer).request({
        path: `/claims/${claim.id}/appeal`,
        method: 'POST',
        body: { reason: '아직 답이 없어요.' },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(409)
  })

  it('never lets the seller appeal against their own decision', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)

    const status = await statusOfFailure(() =>
      api.clientAs(realStore.seller).request({
        path: `/claims/${rejected.id}/appeal`,
        method: 'POST',
        body: { reason: '다시 봅니다.' },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(403)
  })

  /**
   * **인용은 강제 처리 그 자체다.**
   *
   * 인용 버튼을 따로 두면 「인용됐는데 아무 개입도 없는 이의」가 만들어진다. 개입과
   * 같은 트랜잭션에서 닫히는지가 여기서 확인된다.
   */
  it('upholds the appeal in the same breath as the intervention', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)

    await api.clientAs(realBuyer).request({
      path: `/claims/${rejected.id}/appeal`,
      method: 'POST',
      body: { reason: '포장 전이었어요.' },
      schema: claimResponseSchema,
    })
    await api.clientAs(operator).request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: rejected.sellerOrderId,
        items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 1 }],
        reason: '이의를 받아들입니다.',
        fault: 'SELLER',
        overturnsClaimId: rejected.id,
      },
      schema: claimResponseSchema,
    })

    const original = await claimOf(realBuyer, rejected.id)

    expect({
      outcome: original.claim.appeal?.outcome,
      by: original.claim.appeal?.reviewedById,
      note: original.claim.appeal?.reviewNote,
    }).toEqual({ outcome: 'UPHELD', by: operator.userId, note: null })
  })

  it('dismisses an appeal with a reason, and refuses to dismiss it twice', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)

    await api.clientAs(realBuyer).request({
      path: `/claims/${rejected.id}/appeal`,
      method: 'POST',
      body: { reason: '억울해요.' },
      schema: claimResponseSchema,
    })

    const { claim } = await api.clientAs(operator).request({
      path: `/admin/claims/${rejected.id}/appeal/dismiss`,
      method: 'POST',
      body: { reason: '발송 기록이 확인되어 거절을 유지합니다.' },
      schema: claimResponseSchema,
    })

    expect({ outcome: claim.appeal?.outcome, note: claim.appeal?.reviewNote }).toEqual({
      outcome: 'DISMISSED',
      note: '발송 기록이 확인되어 거절을 유지합니다.',
    })

    const status = await statusOfFailure(() =>
      api.clientAs(operator).request({
        path: `/admin/claims/${rejected.id}/appeal/dismiss`,
        method: 'POST',
        body: { reason: '한 번 더.' },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(409)
  })
})

// -------------------------------------------------------------- 4. 데모 스코프

describe('4. 데모 관리자는 데모가 만든 것만 바꾼다 (F5 · F5b)', () => {
  it('refuses to force a claim on a real account (F5)', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)

    const status = await statusOfFailure(() =>
      api.clientAs(demoAdmin).request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: rejected.sellerOrderId,
          items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 1 }],
          reason: '개입합니다.',
          fault: 'SELLER',
          overturnsClaimId: rejected.id,
        },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(403)
  })

  it('forces a claim both of whose sides are demo accounts (F5b)', async () => {
    const rejected = await rejectedCancel(demoStore, demoBuyer)

    const { claim } = await api.clientAs(demoAdmin).request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: rejected.sellerOrderId,
        items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 1 }],
        reason: '데모 개입입니다.',
        fault: 'SELLER',
        overturnsClaimId: rejected.id,
      },
      schema: claimResponseSchema,
    })

    expect(claim.status).toBe('CANCEL_APPROVED')
  })

  /**
   * **양쪽을 다 묻는다는 것의 증거.**
   *
   * 데모 가게이지만 산 사람이 실계정이면 강제 처리는 그 사람의 돈을 움직인다. 가게
   * 쪽만 보는 구현은 여기서 통과하고, 그 통과는 조용하다.
   */
  it('refuses a demo store when the buyer is a real account', async () => {
    const rejected = await rejectedCancel(demoStore, realBuyer)

    const status = await statusOfFailure(() =>
      api.clientAs(demoAdmin).request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: rejected.sellerOrderId,
          items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 1 }],
          reason: '개입합니다.',
          fault: 'SELLER',
          overturnsClaimId: rejected.id,
        },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(403)
  })

  /** **읽기는 좁혀지지 않는다** — 데모 관리자도 플랫폼 전체를 본다. */
  it('still shows a demo administrator every claim on the platform', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)
    const { claims } = await adminList('', demoAdmin)

    expect(claims.map((claim) => claim.id)).toEqual([rejected.id])
  })
})

// ------------------------------------------------------------------- 5. 조회

describe('5. 전체 조회와 그 필터 (F1)', () => {
  it('refuses a buyer, who holds claim.read at their own scope', async () => {
    await rejectedCancel(realStore, realBuyer)

    expect(await statusOfFailure(() => adminList('', realBuyer))).toBe(403)
    expect(await statusOfFailure(() => adminList('', realStore.seller))).toBe(403)
  })

  it('answers 401 without a caller', async () => {
    const status = await statusOfFailure(() =>
      api.client.request({ path: '/admin/claims', schema: adminClaimListResponseSchema }),
    )

    expect(status).toBe(401)
  })

  it('shows claims from every store, with who sold and who bought', async () => {
    const mine = await rejectedCancel(realStore, realBuyer)
    const theirs = await rejectedCancel(demoStore, demoBuyer)
    const { claims } = await adminList()

    expect(
      claims
        .map((claim) => ({ id: claim.id, seller: claim.sellerId, buyer: claim.buyerId }))
        .toSorted((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      [
        { id: mine.id, seller: realStore.sellerId, buyer: realBuyer.userId },
        { id: theirs.id, seller: demoStore.sellerId, buyer: demoBuyer.userId },
      ].toSorted((left, right) => left.id.localeCompare(right.id)),
    )
  })

  it('narrows by seller, by buyer, by status and by period', async () => {
    const mine = await rejectedCancel(realStore, realBuyer)
    const theirs = await rejectedCancel(demoStore, demoBuyer)

    const bySeller = await adminList(`?sellerId=${realStore.sellerId}`)
    const byBuyer = await adminList(`?buyerId=${demoBuyer.userId}`)
    const byStatus = await adminList('?status=CANCEL_APPROVED')
    const before = await adminList(`?to=${encodeURIComponent('2026-09-01T00:00:00.000Z')}`)

    expect({
      bySeller: bySeller.claims.map((claim) => claim.id),
      byBuyer: byBuyer.claims.map((claim) => claim.id),
      byStatus: byStatus.claims.length,
      before: before.claims.length,
    }).toEqual({ bySeller: [mine.id], byBuyer: [theirs.id], byStatus: 0, before: 0 })
  })

  it('marks a pending appeal and narrows to it', async () => {
    const appealed = await rejectedCancel(realStore, realBuyer)

    await rejectedCancel(realStore, realBuyer)
    await api.clientAs(realBuyer).request({
      path: `/claims/${appealed.id}/appeal`,
      method: 'POST',
      body: { reason: '다시 봐 주세요.' },
      schema: claimResponseSchema,
    })

    const { claims } = await adminList('?appealed=true')

    expect(claims.map((claim) => ({ id: claim.id, pending: claim.appealPending }))).toEqual([
      { id: appealed.id, pending: true },
    ])
  })

  /** 커서를 끝까지 따라가도 중복도 누락도 없다. */
  it('pages through every claim exactly once', async () => {
    const seeded = [
      await rejectedCancel(realStore, realBuyer),
      await rejectedCancel(realStore, realBuyer),
      await rejectedCancel(demoStore, demoBuyer),
    ]
    const walked: string[] = []
    let cursor: string | null = null

    do {
      const page: AdminClaimListResponse = await adminList(
        `?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
      )

      walked.push(...page.claims.map((claim) => claim.id))
      cursor = page.nextCursor
    } while (cursor !== null)

    expect(walked.toSorted()).toEqual(seeded.map((claim) => claim.id).toSorted())
  })
})

// ------------------------------------------------------------- 6. 지연 · 환불

describe('6. 처리 지연과 나가지 못한 환불 (F7)', () => {
  function overdueList(caller: TestCaller = operator): Promise<AdminOverdueClaimsResponse> {
    return api
      .clientAs(caller)
      .request({ path: '/admin/claims/overdue', schema: adminOverdueClaimsResponseSchema })
  }

  /**
   * 압축된 기한은 10분이다 (`CLAIM_HANDLING_DEMO_MS`). 시계를 한 시간 앞으로 옮기면
   * 방금 낸 신청이 지연이 되고, 그 판정은 **SQL 이 아니라 순수 함수**가 한다.
   */
  it('lists a claim whose deadline has passed while it waited', async () => {
    const seeded = await seedOrder({
      store: realStore,
      buyerId: realBuyer.userId,
      status: 'PREPARING',
    })
    const { claim } = await api.clientAs(realBuyer).request({
      path: '/claims',
      method: 'POST',
      body: {
        sellerOrderId: seeded.sellerOrderId,
        items: [{ orderItemId: seeded.orderItemId, quantity: 1 }],
        reason: '변심이에요.',
        fault: 'CUSTOMER',
      },
      schema: claimResponseSchema,
    })

    expect((await overdueList()).claims).toEqual([])

    clock.set(new Date(Date.parse(NOW) + 60 * 60_000).toISOString())

    const late = await overdueList()

    expect({
      ids: late.claims.map((entry) => entry.id),
      overdue: late.claims.map((entry) => entry.overdue),
      truncated: late.truncated,
    }).toEqual({ ids: [claim.id], overdue: [true], truncated: false })
  })

  it('leaves a concluded claim out of the queue', async () => {
    await rejectedCancel(realStore, realBuyer)
    clock.set(new Date(Date.parse(NOW) + 60 * 60_000).toISOString())

    expect((await overdueList()).claims).toEqual([])
  })

  it('refuses the overdue queue to anyone without a platform-wide read', async () => {
    expect(await statusOfFailure(() => overdueList(realBuyer))).toBe(403)
  })

  /**
   * 실패한 환불의 조회 (TASK-0068 R3 이 넘긴 항목).
   *
   * 행을 직접 심는 이유는 **실패를 재현하려면 결제사를 죽여야 하기 때문**이고, 그
   * 재현은 `refund.spec.ts` 가 이미 한다. 여기서 재는 것은 그 행이 관리자에게
   * 보이는가 하나다.
   */
  it('shows a refund that never went out, with why and for how long', async () => {
    const rejected = await rejectedCancel(realStore, realBuyer)
    const { claim } = await api.clientAs(operator).request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: rejected.sellerOrderId,
        items: [{ orderItemId: rejected.items[0]?.orderItemId, quantity: 1 }],
        reason: '개입합니다.',
        fault: 'SELLER',
        overturnsClaimId: rejected.id,
      },
      schema: claimResponseSchema,
    })

    // **행이 이미 있을 수 있다.** 승인 뒤에 환불이 곧바로 시도되고, 결제가 없는 이
    // 주문에서는 그 시도가 실패하며 자기 실패 기록을 남긴다 — 그 위에 우리가 재고
    // 싶은 값을 덮는다.
    await db.execute(
      `INSERT INTO "ClaimRefund"
         ("claimId", "itemsAmount", "shippingAmount", "amount", "attempts", "lastError",
          "lastAttemptAt", "updatedAt")
       VALUES ($1, 10000, 0, 10000, 3, '결제사에 닿지 못했습니다.', now(), now())
       ON CONFLICT ("claimId") DO UPDATE
          SET "itemsAmount" = 10000, "shippingAmount" = 0, "amount" = 10000, "attempts" = 3,
              "lastError" = '결제사에 닿지 못했습니다.', "lastAttemptAt" = now(),
              "refundedAt" = NULL, "updatedAt" = now()`,
      [claim.id],
    )

    const answer: AdminFailedRefundListResponse = await api.clientAs(operator).request({
      path: '/admin/claim-refunds/failed',
      schema: adminFailedRefundListResponseSchema,
    })

    expect(
      answer.refunds.map((refund) => ({
        claimId: refund.claimId,
        amount: refund.amount,
        attempts: refund.attempts,
        error: refund.lastError,
        seller: refund.sellerId,
      })),
    ).toEqual([
      {
        claimId: claim.id,
        amount: 10_000,
        attempts: 3,
        error: '결제사에 닿지 못했습니다.',
        seller: realStore.sellerId,
      },
    ])
    expect(answer.hasMore).toBe(false)
  })
})
