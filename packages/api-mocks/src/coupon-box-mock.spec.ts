/**
 * 쿠폰함 대역이 화면에 약속하는 것 (TASK-0077).
 *
 * `apps/shop` 의 검사가 「탭 배지가 3장이라고 말한다」와 「받고 나면 목록 맨 위에
 * 있다」를 단언하는데, 그 단언은 여기 적힌 규칙만큼만 값어치가 있다. 상태로 좁힐 때
 * `counts` 까지 함께 좁히는 대역이라면, 화면 검사는 **정반대로 동작하는 API** 를 상대로
 * 초록이 된다.
 *
 * 모든 호출이 앱이 쓰는 `createApiClient` 를 지나므로, 계약에서 벗어난 몸통은 화면에
 * 닿기 전에 `malformed_response` 로 죽는다 (C1 · C2).
 */

import type { UserCouponListResponse, UserCouponResponse } from '@shopping/shared'
import {
  createApiClient,
  isApiClientError,
  userCouponListResponseSchema,
  userCouponResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  couponBoxSnapshot,
  MOCK_CLAIMABLE_COUPON_CODE,
  MOCK_COUPON_BOX_PAGE_SIZE,
  mockCouponBoxSeedAt,
  mockCouponBoxSeeds,
  resetCouponBoxStore,
} from './handlers'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'shop', baseUrl: 'http://api.test.invalid' })

function box(query = ''): Promise<UserCouponListResponse> {
  return client.request({ path: `/me/coupons${query}`, schema: userCouponListResponseSchema })
}

function claim(code: string): Promise<UserCouponResponse> {
  return client.request({
    path: '/coupons/claims',
    method: 'POST',
    body: { code },
    schema: userCouponResponseSchema,
  })
}

/** 거절의 `error.code`, 또는 성공했으면 `null`. */
async function refusalOf(code: string): Promise<string | null> {
  return claim(code).then(
    () => null,
    (error: unknown) => (isApiClientError(error) ? (error.code ?? null) : null),
  )
}

const EXPIRING = mockCouponBoxSeedAt(0)
const SPENT = mockCouponBoxSeedAt(3)

beforeEach(() => {
  resetCouponBoxStore()
})

describe('쿠폰함 목록', () => {
  it('answers newest first', async () => {
    const { coupons } = await box()

    expect(coupons[0]?.id).toBe(EXPIRING.id)
  })

  it('carries the policy inline, so a row needs no second request', async () => {
    const { coupons } = await box()

    expect(coupons[0]?.coupon.name).toBe(EXPIRING.coupon.name)
    expect(coupons[0]?.coupon.discountValue).toBe(EXPIRING.coupon.discountValue)
  })

  it('narrows the list by status', async () => {
    const { coupons } = await box('?status=USED')

    expect(coupons.map((entry) => entry.id)).toEqual([SPENT.id])
  })

  it('keeps counts the same whichever tab asked (계약)', async () => {
    const all = await box()
    const used = await box('?status=USED')

    // 이 한 줄이 이 파일의 존재 이유다. 좁혀서 세는 대역이었다면 화면의 탭 배지는
    // 고른 탭만 0이 아니게 되고, 화면 검사는 그것을 정상으로 배운다.
    expect(used.counts).toEqual(all.counts)
    expect(all.counts).toEqual({ ISSUED: 3, USED: 1, EXPIRED: 1 })
  })

  it('sends all three keys even at zero', async () => {
    resetCouponBoxStore([])

    const { counts } = await box()

    expect(counts).toEqual({ ISSUED: 0, USED: 0, EXPIRED: 0 })
  })

  it('pages through one tab without repeating a card', async () => {
    const first = await box('?status=ISSUED')

    expect(first.coupons).toHaveLength(MOCK_COUPON_BOX_PAGE_SIZE)
    expect(first.nextCursor).not.toBeNull()

    const second = await box(`?status=ISSUED&cursor=${String(first.nextCursor)}`)
    const seen = [...first.coupons, ...second.coupons].map((entry) => entry.id)

    expect(new Set(seen).size).toBe(seen.length)
    expect(second.nextCursor).toBeNull()
  })
})

describe('코드 등록', () => {
  it('takes the code as a person copies it — hyphens, spaces and lower case', async () => {
    const { userCoupon } = await claim(` ${MOCK_CLAIMABLE_COUPON_CODE.toLowerCase()} `)

    expect(userCoupon.status).toBe('ISSUED')
  })

  it('puts the new card at the top of the box', async () => {
    const { userCoupon } = await claim(MOCK_CLAIMABLE_COUPON_CODE)
    const { coupons, counts } = await box()

    expect(coupons[0]?.id).toBe(userCoupon.id)
    expect(counts.ISSUED).toBe(4)
    expect(couponBoxSnapshot()).toHaveLength(mockCouponBoxSeeds.length + 1)
  })

  it('refuses the same code the second time as already issued', async () => {
    await claim(MOCK_CLAIMABLE_COUPON_CODE)

    expect(await refusalOf(MOCK_CLAIMABLE_COUPON_CODE)).toBe('COUPON_ALREADY_ISSUED')
  })

  it.each([
    ['WE1C0MEB2X', 'COUPON_ALREADY_ISSUED'],
    ['S00N4K2M9P', 'COUPON_NOT_STARTED'],
    ['PAST5R3T7Q', 'COUPON_ENDED'],
    ['G0NE8H4J2V', 'COUPON_ISSUE_EXHAUSTED'],
    ['H0PD6N3P5W', 'COUPON_SUSPENDED'],
    ['DEM0Y2K4M8', 'COUPON_DEMO_ONLY'],
  ])('refuses %s with %s', async (code, expected) => {
    expect(await refusalOf(code)).toBe(expected)
  })

  it('answers a code that is not a code the same way as one that does not exist', async () => {
    // 갈라 답하면 코드를 찍어 보는 쪽에 「형식은 맞다」는 힌트가 된다 (계약).
    expect(await refusalOf('짧다')).toBe('COUPON_CODE_UNKNOWN')
    expect(await refusalOf('ZZZZZZZZZZ')).toBe('COUPON_CODE_UNKNOWN')
  })
})
