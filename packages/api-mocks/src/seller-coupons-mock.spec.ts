/**
 * 판매자 쿠폰 대역이 재현한다고 말하는 것을, 대역 자신에 대고 잰다 (TASK-0074).
 *
 * 이 파일이 있는 이유는 화면의 검사가 이 대역을 **믿고** 통과하기 때문이다. 「중단하면
 * 그 줄이 중단으로 옮겨 간다」를 화면에서 확인해 봐야, 그 확인은 대역이 정말 그렇게
 * 답할 때만 값을 한다 — 대역이 `suspendedAt` 만 바꾸고 상태를 그대로 두면 화면은
 * 아무것도 다시 그리지 않으면서 초록이 되고, 실 서버 앞에서만 어긋난다.
 *
 * 모든 호출이 `createApiClient` 를 지난다. 응답은 계약 스키마로 파싱된 뒤에야
 * 도착하므로, **아래의 성공 하나하나가 곧 「계약을 지났다」의 증거**다 (C1 · C2).
 */

import type { CouponListResponse, CouponResponse, CreateCouponRequest } from '@shopping/shared'
import {
  couponListResponseSchema,
  couponResponseSchema,
  createApiClient,
  isApiClientError,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { sellerCouponPage } from './fixtures/seller-coupons'
import {
  MOCK_COUPON_SELLER_ID,
  MOCK_OTHER_SELLER_ID,
  mockSellerCouponSeedAt,
  resetSellerCouponStore,
  sellerCouponHandlers,
  sellerCouponSnapshot,
} from './handlers'
import { sellerProductId } from './index'
import { setupTestServer } from './node'

// 이 대역은 `defaultHandlers` 에 없다. 같은 `/coupons` 라우트를 관리자 콘솔도 쓰고,
// 기본 목록에서는 먼저 등록된 쪽이 이기기 때문이다 — 그래서 여기서 명시적으로 세운다.
setupTestServer(...sellerCouponHandlers)

const client = createApiClient({ appId: 'seller', baseUrl: 'http://api.test.invalid' })

const list = (search: string): Promise<CouponListResponse> =>
  client.request({ path: `/coupons${search}`, schema: couponListResponseSchema })

const mine = (extra = ''): Promise<CouponListResponse> =>
  list(`?sellerId=${MOCK_COUPON_SELLER_ID}${extra}`)

const create = (body: Partial<CreateCouponRequest>): Promise<CouponResponse> =>
  client.request({
    path: '/coupons',
    method: 'POST',
    body: {
      sellerId: MOCK_COUPON_SELLER_ID,
      name: '새 쿠폰',
      discountType: 'FIXED',
      discountValue: 1_000,
      scopeType: 'SELLER',
      validFrom: '2026-09-10T00:00:00.000Z',
      validUntil: '2026-09-20T00:00:00.000Z',
      ...body,
    },
    schema: couponResponseSchema,
  })

const patch = (id: string, suspended: boolean): Promise<CouponResponse> =>
  client.request({
    path: `/coupons/${id}`,
    method: 'PATCH',
    body: { suspended },
    schema: couponResponseSchema,
  })

/** 거절 하나를 값으로 받는다. 던지게 두면 `expect` 가 무엇을 잴지 정하지 못한다. */
async function refusalOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => null,
    (error: unknown) => error,
  )
}

beforeEach(() => {
  resetSellerCouponStore()
})

describe('GET /coupons?sellerId=…', () => {
  it('answers the whole first page, in the fixture order', async () => {
    const page = await mine()

    expect(page.coupons.map((entry) => entry.coupon.id)).toEqual(
      sellerCouponPage.coupons.map((entry) => entry.coupon.id),
    )
    expect(page.nextCursor).toBeNull()
  })

  it('refuses another store with FORBIDDEN rather than an empty list', async () => {
    // 빈 목록으로 답하면 화면은 「아직 쿠폰이 없어요」를 그리고, 남의 목록을 들여다본
    // 사람에게 그것은 **성공한 요청**으로 보인다 (F6).
    const error = await refusalOf(list(`?sellerId=${MOCK_OTHER_SELLER_ID}`))

    expect(isApiClientError(error) && error.status).toBe(403)
    expect(isApiClientError(error) && error.code).toBe('FORBIDDEN')
  })

  it('narrows to one lifecycle', async () => {
    const page = await mine('&lifecycle=SUSPENDED')

    expect(page.coupons.map((entry) => entry.lifecycle)).toEqual(['SUSPENDED'])
  })

  it('walks the whole list with the cursor, no row twice and none missing', async () => {
    const seen: string[] = []
    let cursor: string | null = null

    do {
      const page: CouponListResponse = await mine(
        `&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
      )

      seen.push(...page.coupons.map((entry) => entry.coupon.id))
      cursor = page.nextCursor
    } while (cursor !== null)

    expect(seen).toEqual(sellerCouponPage.coupons.map((entry) => entry.coupon.id))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('refuses a cursor that is not one of ours rather than restarting', async () => {
    // 조용히 첫 페이지로 되돌리면 커서가 깨진 화면이 1페이지를 무한히 반복한다.
    const error = await refusalOf(mine('&cursor=notacursor'))

    expect(isApiClientError(error) && error.status).toBe(400)
  })
})

describe('POST /coupons', () => {
  it('adds a seller coupon that the list then answers with', async () => {
    const { coupon } = await create({ name: '가을 3,000원', discountValue: 3_000 })

    expect(coupon.issuerType).toBe('SELLER')
    expect(coupon.sellerId).toBe(MOCK_COUPON_SELLER_ID)
    expect(coupon.issuedCount).toBe(0)
    expect(sellerCouponSnapshot().map((entry) => entry.coupon.id)).toContain(coupon.id)
  })

  it('makes the code itself when one was asked for', async () => {
    // 발행자가 코드를 고르게 두면 정규화(`I`→`1`)가 사람이 의도한 낱말을 망가뜨린다.
    // 계약에 코드를 담는 칸이 없는 것이 그 결정이고, 대역도 같은 자리에서 만든다.
    const { coupon } = await create({ withCode: true })

    expect(coupon.code).toMatch(/^[0-9A-Z]{10}$/u)
  })

  it('drops a ceiling sent with a fixed coupon', async () => {
    // 계약이 「정액에서는 언제나 null」 이라고 못박은 값이다. 그대로 저장하면 목록이
    // 계약상 존재할 수 없는 줄을 보여 준다.
    const { coupon } = await create({ discountType: 'FIXED', maxDiscountAmount: 5_000 })

    expect(coupon.maxDiscountAmount).toBeNull()
  })

  it.each(['ALL', 'CATEGORY'] as const)('refuses %s scope, naming scopeType', async (scopeType) => {
    const error = await refusalOf(create({ scopeType, scopeIds: ['3'] }))

    expect(isApiClientError(error) && error.status).toBe(403)
    expect(isApiClientError(error) && error.code).toBe('COUPON_SCOPE_FORBIDDEN')
    expect(isApiClientError(error) && fieldOf(error.details)).toBe('scopeType')
  })

  it("refuses another store's product, naming scopeIds", async () => {
    const error = await refusalOf(
      create({ scopeType: 'PRODUCT', scopeIds: ['0f000000-0000-4000-8000-000000000001'] }),
    )

    expect(isApiClientError(error) && error.code).toBe('COUPON_SCOPE_FORBIDDEN')
    expect(isApiClientError(error) && fieldOf(error.details)).toBe('scopeIds')
  })

  it('accepts a product of this store', async () => {
    const { coupon } = await create({ scopeType: 'PRODUCT', scopeIds: [sellerProductId(3)] })

    expect(coupon.scopeIds).toEqual([sellerProductId(3)])
  })
})

describe('PATCH /coupons/:id', () => {
  it('suspends and resumes, moving the row between lifecycles', async () => {
    const active = mockSellerCouponSeedAt(0).coupon

    const suspended = await patch(active.id, true)
    expect(suspended.coupon.suspendedAt).not.toBeNull()
    expect(lifecycleOf(sellerCouponSnapshot(), active.id)).toBe('SUSPENDED')

    const resumed = await patch(active.id, false)
    expect(resumed.coupon.suspendedAt).toBeNull()
    expect(lifecycleOf(sellerCouponSnapshot(), active.id)).toBe('ACTIVE')
  })

  it('leaves what already went out alone', async () => {
    // 중단은 「더 나가지 않게」이지 「나간 것을 무르게」가 아니다. 통계가 함께 움직이면
    // 화면은 중단을 회수처럼 그리게 된다.
    const active = mockSellerCouponSeedAt(0)
    const before = statsOf(sellerCouponSnapshot(), active.coupon.id)

    await patch(active.coupon.id, true)

    expect(statsOf(sellerCouponSnapshot(), active.coupon.id)).toEqual(before)
    expect(couponOf(sellerCouponSnapshot(), active.coupon.id).issuedCount).toBe(
      active.coupon.issuedCount,
    )
  })

  it('answers 404 for a coupon nobody has', async () => {
    const error = await refusalOf(patch('3c0a0000-0000-4000-8000-000000009999', true))

    expect(isApiClientError(error) && error.status).toBe(404)
  })
})

/** 거절이 가리킨 칸. 화면이 문장을 어디에 붙일지가 여기서 정해진다. */
function fieldOf(details: readonly unknown[]): string | undefined {
  const entry = details[0]

  return typeof entry === 'object' && entry !== null && 'field' in entry
    ? String(entry.field)
    : undefined
}

function couponOf(entries: ReturnType<typeof sellerCouponSnapshot>, id: string) {
  const entry = entries.find((candidate) => candidate.coupon.id === id)

  if (entry === undefined) throw new Error(`쿠폰 ${id} 이(가) 저장소에 없습니다.`)

  return entry.coupon
}

function lifecycleOf(entries: ReturnType<typeof sellerCouponSnapshot>, id: string) {
  const entry = entries.find((candidate) => candidate.coupon.id === id)

  if (entry === undefined) throw new Error(`쿠폰 ${id} 이(가) 저장소에 없습니다.`)

  return entry.lifecycle
}

function statsOf(entries: ReturnType<typeof sellerCouponSnapshot>, id: string) {
  const entry = entries.find((candidate) => candidate.coupon.id === id)

  if (entry === undefined) throw new Error(`쿠폰 ${id} 이(가) 저장소에 없습니다.`)

  return entry.stats
}
