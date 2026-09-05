import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { PrismaService } from '../../src/prisma/prisma.service.js'
import type { Reservation } from '../../src/reservation/reservation.service.js'
import { ReservationService } from '../../src/reservation/reservation.service.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * 재고 예약 (TASK-0048), 이 워커의 실제 데이터베이스에 대해.
 *
 * 서비스를 앱에서 꺼내 쓴다 — 예약에는 자기 엔드포인트가 없고(4.2 ①) 부르는 쪽은
 * 주문 생성(TASK-0049)이다. 시험 대상은 **서비스와 데이터베이스**이고 컨트롤러가
 * 아니다(QUALITY-GATES Q5).
 *
 * 다만 F6 만은 HTTP 로 잰다. 예약이 상품 상세에 실제로 비치는지가 그 기준이고,
 * 그것은 응답의 모양에 대한 이야기라 계약(C3)이 함께 걸린다.
 *
 * **동시성의 근거는 여기서 처음 만들어지지 않았다.** TASK-0106 이
 * `test/db/stock-contention.spec.ts` 에서 「읽고 쓰는」 잘못된 구현이 이 하네스에서
 * 실제로 오버셀을 **재현하는지**를 먼저 보였다. 그래서 아래의 「하나만 통과했다」는
 * 운이 아니라 구현에 대한 증거다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let slugCounter = 0
let skuCounter = 0

function uniqueSlug(prefix: string): string {
  slugCounter += 1
  return `${prefix}-${String(slugCounter)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

function uniqueSkuPrefix(): string {
  skuCounter += 1
  return `RSV${String(process.env.VITEST_POOL_ID ?? '1')}X${String(skuCounter)}`
}

function reservations(): ReservationService {
  return api.resolve<ReservationService>(ReservationService)
}

function prisma(): PrismaService {
  return api.resolve<PrismaService>(PrismaService)
}

let categoryId: number
let seller: TestCaller
let buyer: string

beforeEach(async () => {
  const { category } = await api.clientAs(callers.operator).createCategory({
    parentId: null,
    name: '의류',
    slug: uniqueSlug('clothing'),
  })

  categoryId = category.id

  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
  buyer = (await createUser(db)).id
})

function client(caller: TestCaller = seller): ApiClient {
  return api.clientAs(caller)
}

/** 옵션 하나짜리 상품 하나. 그 하나의 variant id 를 돌려준다. */
async function variantOf(opening: number): Promise<{ productId: string; variantId: string }> {
  const { product } = await client().createProduct({
    categoryId,
    name: '오버사이즈 티셔츠',
    skuPrefix: uniqueSkuPrefix(),
    status: 'ACTIVE',
    variantDefaults: { price: 19_000, stock: opening },
  })

  return { productId: product.id, variantId: product.variants[0]?.id ?? '' }
}

/** 표에서 바로 읽은 실물 재고와 예약분. */
async function levelsOf(variantId: string): Promise<{ stock: number; reserved: number }> {
  return db.one(`SELECT "stock", "reserved" FROM "ProductVariant" WHERE "id" = $1`, [variantId])
}

/** 한 건 잡는다. `checkoutId` 는 주문서 시도마다 부르는 쪽이 새로 만든다 (4.1). */
function hold(
  variantId: string,
  quantity: number,
  options: { readonly checkoutId?: string; readonly ttlMs?: number } = {},
): Promise<Reservation> {
  return reservations().hold({
    variantId,
    quantity,
    userId: buyer,
    checkoutId: options.checkoutId ?? randomUUID(),
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
  })
}

/** 서비스가 던진 거부의 상태와 도메인 코드. */
interface Refusal {
  readonly status: number
  readonly code: string
}

/** 거부 하나를 읽는다. 여러 건이 한꺼번에 진 경우에도 쓰인다. */
function refusalOf(error: unknown): Refusal {
  if (error === null || typeof error !== 'object' || !('getStatus' in error)) {
    throw new Error(`거부를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const exception = error as { getStatus: () => number; getResponse: () => unknown }
  const payload = exception.getResponse()
  const code =
    typeof payload === 'object' && payload !== null && 'code' in payload ? String(payload.code) : ''

  return { status: exception.getStatus(), code }
}

async function refusal(work: Promise<unknown>): Promise<Refusal> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  return refusalOf(error)
}

describe('예약 (F1)', () => {
  it('takes the quantity out of what is available and leaves the shelf alone', async () => {
    const { variantId } = await variantOf(10)

    const held = await hold(variantId, 3)

    expect(held.status).toBe('HELD')
    expect(held.quantity).toBe(3)
    // 재고 10에서 3개 예약 → 가용재고 7. `stock` 은 움직이지 않는다: 원장이 사실이고
    // `stock` 은 그 결과라는 규약(TASK-0036)을 예약이 깨뜨리지 않는다.
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 3 })
  })

  it('refuses more than is available, and says how much is left', async () => {
    const { variantId } = await variantOf(4)

    await hold(variantId, 3)

    const refused = await refusal(hold(variantId, 2))

    expect(refused).toEqual({ status: 409, code: 'RESERVATION_SOLD_OUT' })
    // 진 쪽은 아무것도 남기지 않는다.
    expect(await levelsOf(variantId)).toEqual({ stock: 4, reserved: 3 })
  })

  it('tells a missing combination apart from a sold-out one', async () => {
    const refused = await refusal(hold(randomUUID(), 1))

    expect(refused.status).toBe(404)
  })
})

describe('동시성 (F2 · A7)', () => {
  it('lets exactly one of ten simultaneous shoppers have the last unit', async () => {
    const { variantId } = await variantOf(1)

    const results = await concurrently(10, () => hold(variantId, 1))

    expect(fulfilled(results)).toHaveLength(1)
    expect(rejected(results)).toHaveLength(9)
    expect(await levelsOf(variantId)).toEqual({ stock: 1, reserved: 1 })

    // 아홉은 전부 품절이다. 서로 다른 이유로 진 것이 아니다.
    const codes = rejected(results).map((reason) => refusalOf(reason).code)

    expect(codes).toEqual(Array.from({ length: 9 }, () => 'RESERVATION_SOLD_OUT'))
  })

  it('holds four transactions open at once, so the overlap is arranged rather than hoped for', async () => {
    const { variantId } = await variantOf(1)
    // 넷인 이유는 시험용 앱의 풀이 5이기 때문이다(`test/support/app-config.ts`).
    // 열을 세우면 다섯이 연결을 기다리는 동안 넷은 장벽에서 기다려 아무도 못 나간다.
    const gate = barrier(4)

    const results = await concurrently(4, () =>
      prisma().$transaction(async (tx) => {
        await gate.arrive()

        return reservations().reserve(tx, {
          variantId,
          quantity: 1,
          userId: buyer,
          checkoutId: randomUUID(),
        })
      }),
    )

    expect(fulfilled(results)).toHaveLength(1)
    expect(await levelsOf(variantId)).toEqual({ stock: 1, reserved: 1 })
  })
})

describe('확정 (F3 · F4)', () => {
  it('writes the ledger, takes the stock down and gives the hold back', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3)

    const { entry } = await reservations().confirmHold(held.id, { actorId: buyer })

    expect(entry?.type).toBe('RESERVE_CONFIRM')
    expect(entry?.quantity).toBe(-3)
    expect(entry?.balanceAfter).toBe(7)
    expect(entry?.refType).toBe('STOCK_RESERVATION')
    expect(entry?.refId).toBe(held.id)
    // 예약분은 돌아가고 재고가 실제로 줄었다. 둘 다 줄어야 가용재고가 7 그대로다.
    expect(await levelsOf(variantId)).toEqual({ stock: 7, reserved: 0 })
  })

  it('deducts once however many times the approval arrives (F4)', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3)

    await reservations().confirmHold(held.id)
    const again = await reservations().confirmHold(held.id)

    // 두 번째는 원장에 아무것도 적지 않는다 — 결제 승인 웹훅은 두 번 온다.
    expect(again.entry).toBeNull()
    expect(again.reservation.status).toBe('CONFIRMED')
    expect(await levelsOf(variantId)).toEqual({ stock: 7, reserved: 0 })
    expect(await ledgerCount(variantId, 'RESERVE_CONFIRM')).toBe(1)
  })

  it('deducts once when two approvals arrive at the same instant (A7)', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3)
    const gate = barrier(2)

    const results = await concurrently(2, () =>
      prisma().$transaction(async (tx) => {
        await gate.arrive()

        return reservations().confirm(tx, held.id)
      }),
    )

    expect(fulfilled(results)).toHaveLength(2)
    expect(fulfilled(results).filter((result) => result.entry !== null)).toHaveLength(1)
    expect(await levelsOf(variantId)).toEqual({ stock: 7, reserved: 0 })
    expect(await ledgerCount(variantId, 'RESERVE_CONFIRM')).toBe(1)
  })

  it('refuses to confirm a hold the scheduler already let go', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3)

    await reservations().releaseHold(held.id)

    // 결제가 승인됐는데 재고는 이미 남에게 갔다. 조용히 성공시키면 없는 재고를 판다.
    expect(await refusal(reservations().confirmHold(held.id))).toEqual({
      status: 409,
      code: 'RESERVATION_RELEASED',
    })
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 0 })
  })

  it('confirms a hold whose clock ran out but which nobody has released', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3, { ttlMs: -1_000 })

    // 아직 `HELD` 라면 `reserved` 가 여전히 이 예약을 세고 있으므로 재고는 이 예약의
    // 것이다. 결제가 승인된 뒤에 「15분이 지났습니다」로 거절할 이유가 없다 (4.2 ⑤).
    const { entry } = await reservations().confirmHold(held.id)

    expect(entry?.balanceAfter).toBe(7)
  })
})

describe('해제 (F5)', () => {
  it('restores what the hold was keeping', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3)

    const { restored } = await reservations().releaseHold(held.id)

    expect(restored).toBe(3)
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 0 })
    // 풀린 몫은 다음 사람이 실제로 잡을 수 있다.
    await expect(hold(variantId, 10)).resolves.toMatchObject({ quantity: 10 })
  })

  it('restores once when the scheduler and the shopper both let go at the same instant', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3)
    const gate = barrier(2)

    const results = await concurrently(2, () =>
      prisma().$transaction(async (tx) => {
        await gate.arrive()

        return reservations().release(tx, held.id)
      }),
    )

    expect(
      fulfilled(results)
        .map((result) => result.restored)
        .sort(),
    ).toEqual([0, 3])
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 0 })
  })

  it('refuses to release what has already been sold', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3)

    await reservations().confirmHold(held.id)

    expect(await refusal(reservations().releaseHold(held.id))).toEqual({
      status: 409,
      code: 'RESERVATION_CONFIRMED',
    })
    expect(await levelsOf(variantId)).toEqual({ stock: 7, reserved: 0 })
  })

  it('lets one checkout attempt go in a single call, and leaves other attempts alone', async () => {
    const { variantId } = await variantOf(10)
    const abandoned = randomUUID()

    await hold(variantId, 2, { checkoutId: abandoned })
    await hold(variantId, 3, { checkoutId: abandoned })
    await hold(variantId, 1, { checkoutId: randomUUID() })

    const restored = await reservations().releaseCheckout(abandoned)

    expect(restored).toBe(5)
    expect(await levelsOf(variantId)).toEqual({ stock: 10, reserved: 1 })
  })

  it('lets the rest of an attempt go even when one line of it has been paid for', async () => {
    const { variantId } = await variantOf(10)
    const attempt = randomUUID()
    const paid = await hold(variantId, 2, { checkoutId: attempt })

    await hold(variantId, 3, { checkoutId: attempt })
    await reservations().confirmHold(paid.id)

    // 확정된 한 건 때문에 나머지가 잠긴 채로 남으면 안 된다.
    expect(await reservations().releaseCheckout(attempt)).toBe(3)
    expect(await levelsOf(variantId)).toEqual({ stock: 8, reserved: 0 })
  })

  it('refuses a reservation that never existed', async () => {
    expect((await refusal(reservations().releaseHold(randomUUID()))).status).toBe(404)
  })
})

describe('연장', () => {
  it('pushes the deadline out while the hold is still live', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3, { ttlMs: 1_000 })

    const extended = await reservations().extend(held.id)

    expect(extended.expiresAt.getTime()).toBeGreaterThan(held.expiresAt.getTime())
    expect(extended.status).toBe('HELD')
  })

  it('will not resurrect a hold whose clock has run out', async () => {
    const { variantId } = await variantOf(10)
    const held = await hold(variantId, 3, { ttlMs: -1_000 })

    // 되살리면 스케줄러가 이미 집어 든 행을 두고 경합하게 된다 — 늘어난 줄 알았는데
    // 다음 순간 풀리는 결과다 (4.2 ⑤).
    expect(await refusal(reservations().extend(held.id))).toEqual({
      status: 409,
      code: 'RESERVATION_EXPIRED',
    })
  })

  it('will not extend a hold that has already been settled either way', async () => {
    const { variantId } = await variantOf(10)
    const confirmed = await hold(variantId, 1)
    const released = await hold(variantId, 1)

    await reservations().confirmHold(confirmed.id)
    await reservations().releaseHold(released.id)

    expect((await refusal(reservations().extend(confirmed.id))).code).toBe('RESERVATION_CONFIRMED')
    expect((await refusal(reservations().extend(released.id))).code).toBe('RESERVATION_RELEASED')
  })

  it('refuses a reservation that never existed', async () => {
    expect((await refusal(reservations().extend(randomUUID()))).status).toBe(404)
  })
})

describe('조회 반영 (F6)', () => {
  it('shows a shopper what is left, not what is on the shelf', async () => {
    const { productId, variantId } = await variantOf(10)

    const before = await client().getStorefrontProduct(productId)

    expect(before.product.variants[0]).toMatchObject({ stock: 10, availableStock: 10 })

    await hold(variantId, 4)

    const after = await client().getStorefrontProduct(productId)

    // 실물 재고는 그대로다. 구매자가 볼 수 있는 수만 줄었다.
    expect(after.product.variants[0]).toMatchObject({ stock: 10, availableStock: 6 })
  })
})

describe('정합성 (F7 · R1)', () => {
  it('keeps the cache equal to the sum of the holds across a hundred rounds', async () => {
    const { variantId } = await variantOf(400)
    const service = reservations()

    for (let round = 0; round < 100; round += 1) {
      const held = await hold(variantId, 1 + (round % 3))

      // 셋 중 하나는 확정, 하나는 해제, 하나는 잡아 둔 채로 남긴다 — 남는 것이
      // 없으면 등식이 0 = 0 으로만 참이 되어 아무것도 재지 않는다.
      if (round % 3 === 0) await service.confirmHold(held.id)
      if (round % 3 === 1) await service.releaseHold(held.id)
    }

    expect(await service.reconcile()).toEqual([])

    // 대조: 캐시를 손으로 어긋내면 점검이 그것을 찾아낸다.
    await db.query(`UPDATE "ProductVariant" SET "reserved" = "reserved" + 1 WHERE "id" = $1`, [
      variantId,
    ])

    expect(await service.reconcile()).toHaveLength(1)
  })
})

/** 이 variant 의 원장에 그 유형이 몇 줄 있는가. */
async function ledgerCount(variantId: string, type: string): Promise<number> {
  const row = await db.one<{ count: number }>(
    `SELECT count(*)::int AS "count" FROM "StockLedger" WHERE "variantId" = $1 AND "type" = $2::"StockLedgerType"`,
    [variantId, type],
  )

  return row.count
}
