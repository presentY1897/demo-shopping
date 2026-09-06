import type { BulkIssueResponse, CouponListResponse, CouponResponse } from '@shopping/shared'
import {
  BULK_ISSUE_MAX_RECIPIENTS,
  bulkIssueResponseSchema,
  couponListResponseSchema,
  couponResponseSchema,
  createApiClient,
  isApiClientError,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { httpFailureOn } from './failures'
import { sessionAdminSuper, sessionDemoAdmin } from './fixtures/session'
import {
  MOCK_PLATFORM_COUPON_IDS,
  platformCouponHandlers,
  resetPlatformCouponStore,
} from './handlers/platform-coupons'
import { resetSessionStore } from './handlers/session'
import { setupTestServer } from './node'
import { mockPaths } from './paths'

/**
 * 플랫폼 쿠폰 대역이 **실 API 와 같은 것을 답하는가** (TASK-0073, C2).
 *
 * 응답이 계약을 지나는지는 클라이언트의 파싱이 이미 본다(모든 요청이
 * `couponListResponseSchema` 같은 것을 지난다). 여기서 재는 것은 **대역이 상태를 옳게
 * 다루는가**이고, 그것이 얼어붙은 픽스처와 다른 점이다 — 이 화면이 묻는 질문이 전부
 * 상태에 대한 것이기 때문이다: 멈추면 상태가 바뀌는가, 다시 열면 돌아오는가, 한꺼번에
 * 지급하면 발급 수가 늘고 남은 대상이 줄어드는가.
 */

const { server } = setupTestServer()

const client = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

beforeEach(() => {
  resetPlatformCouponStore()
  resetSessionStore(sessionAdminSuper)
  server.use(...platformCouponHandlers)
})

function list(query = ''): Promise<CouponListResponse> {
  return client.request({ path: `/coupons${query}`, schema: couponListResponseSchema })
}

function suspend(couponId: string, suspended: boolean): Promise<CouponResponse> {
  return client.request({
    path: `/coupons/${couponId}`,
    method: 'PATCH',
    body: { suspended },
    schema: couponResponseSchema,
  })
}

function bulkIssue(couponId: string, target = 'ALL'): Promise<BulkIssueResponse> {
  return client.request({
    path: `/coupons/${couponId}/issues/bulk`,
    method: 'POST',
    body: { target },
    schema: bulkIssueResponseSchema,
  })
}

async function refusalOf(
  work: () => Promise<unknown>,
): Promise<{ readonly status: number | undefined; readonly code: string | undefined }> {
  try {
    await work()
  } catch (error) {
    if (!isApiClientError(error)) throw error

    return { code: error.body?.error.code, status: error.status }
  }

  throw new Error('요청이 거절되지 않았습니다.')
}

function entryOf(page: CouponListResponse, couponId: string) {
  const entry = page.coupons.find((row) => row.coupon.id === couponId)

  if (entry === undefined) throw new Error('그 쿠폰이 목록에 없습니다.')

  return entry
}

describe('목록', () => {
  it('answers newest first, which is the axis the cursor rides', async () => {
    const { coupons } = await list()

    expect(coupons.map((entry) => entry.coupon.id)).toEqual(
      coupons.map((entry) => entry.coupon.id).toSorted((left, right) => right.localeCompare(left)),
    )
  })

  /** 다섯 상태가 **계산되는 값**이라, 씨앗의 기간과 수량만으로 전부 나와야 한다. */
  it('works the lifecycle out of the period, the suspension and the quantity', async () => {
    const page = await list()

    expect(entryOf(page, MOCK_PLATFORM_COUPON_IDS.active).lifecycle).toBe('ACTIVE')
    expect(entryOf(page, MOCK_PLATFORM_COUPON_IDS.scheduled).lifecycle).toBe('SCHEDULED')
    expect(entryOf(page, MOCK_PLATFORM_COUPON_IDS.suspended).lifecycle).toBe('SUSPENDED')
    expect(entryOf(page, MOCK_PLATFORM_COUPON_IDS.exhausted).lifecycle).toBe('EXHAUSTED')
    expect(entryOf(page, MOCK_PLATFORM_COUPON_IDS.ended).lifecycle).toBe('ENDED')
  })

  it('narrows by lifecycle, several at once', async () => {
    const page = await list('?lifecycle=SUSPENDED,ENDED')

    expect(page.coupons.map((entry) => entry.coupon.id)).toEqual([
      MOCK_PLATFORM_COUPON_IDS.suspended,
      MOCK_PLATFORM_COUPON_IDS.ended,
    ])
  })

  /**
   * 기간은 **겹침**이다 — 「시작일이 이 사이」가 아니다.
   *
   * 8월 1일에 시작해 12월까지 가는 쿠폰은 「9월 5일」을 묻는 사람이 찾는 그 쿠폰이고,
   * 시작일로 걸렀다면 사라졌을 것이다. 경계는 양쪽 다 포함이다.
   */
  it('answers the coupons whose period overlaps the range, not those that started in it', async () => {
    const page = await list('?from=2026-09-05T00:00:00.000Z&to=2026-09-05T23:59:59.999Z')
    const ids = page.coupons.map((entry) => entry.coupon.id)

    expect(ids).toContain(MOCK_PLATFORM_COUPON_IDS.unlimited)
    // 8월에 끝났다 — 9월 5일에 걸치지 않는다.
    expect(ids).not.toContain(MOCK_PLATFORM_COUPON_IDS.ended)
    // 9월 20일에 시작한다 — 아직 걸치지 않는다.
    expect(ids).not.toContain(MOCK_PLATFORM_COUPON_IDS.scheduled)
  })

  it('takes either bound on its own', async () => {
    const until = await list('?to=2026-08-31T14:59:59.999Z')
    const since = await list('?from=2026-10-01T00:00:00.000Z')

    expect(until.coupons.map((entry) => entry.coupon.id)).toEqual([
      MOCK_PLATFORM_COUPON_IDS.unlimited,
      MOCK_PLATFORM_COUPON_IDS.ended,
    ])
    expect(since.coupons.map((entry) => entry.coupon.id)).toEqual([
      MOCK_PLATFORM_COUPON_IDS.unlimited,
      MOCK_PLATFORM_COUPON_IDS.scheduled,
    ])
  })

  /**
   * 누계는 **필터와 페이지에 무관하다.**
   *
   * 보이는 줄들의 합이면 다음 장을 넘길 때마다 「지금까지 부담한 금액」이 달라진다.
   */
  it('answers standing totals that neither the filter nor the page moves', async () => {
    const all = await list()
    const narrowed = await list('?lifecycle=SUSPENDED')
    const firstPage = await list('?limit=2')

    expect(narrowed.totals).toEqual(all.totals)
    expect(firstPage.totals).toEqual(all.totals)
    expect(all.totals.discountTotal).toBe(
      all.coupons.reduce((sum, entry) => sum + entry.stats.discountTotal, 0),
    )
  })

  it('pages through every row exactly once', async () => {
    const all = await list()
    const walked: string[] = []
    let cursor: string | null = null

    do {
      const page: CouponListResponse = await list(
        `?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`,
      )

      walked.push(...page.coupons.map((entry) => entry.coupon.id))
      cursor = page.nextCursor
    } while (cursor !== null)

    expect(walked).toEqual(all.coupons.map((entry) => entry.coupon.id))
  })

  /**
   * 스토어의 목록은 이 대역의 것이 아니다 — 판매자 쿠폰 대역(TASK-0074)이 답한다.
   *
   * 여기서 빈 목록으로 답해 버리면 등록 순서에 따라 그쪽이 조용히 가려진다. 그래서
   * **뒤에 선 핸들러가 답하는지**를 잰다: 이 대역을 앞에 세우고 뒤에 다른 답을 놓은
   * 뒤, 스토어를 지정한 질의가 뒤엣것에 닿는지를 본다.
   */
  it('leaves a store list to the double behind it', async () => {
    server.resetHandlers()
    server.use(httpFailureOn('get', mockPaths.coupons, 404, 'NOT_FOUND', '뒤의 대역입니다.'))
    server.use(...platformCouponHandlers)

    const refusal = await refusalOf(() => list('?sellerId=019596d0-1f1c-7c2e-9a0e-5a0000000001'))

    expect(refusal.status).toBe(404)
    // 플랫폼 목록은 그대로 이 대역이 답한다 — 넘기는 것은 스토어를 지정한 질의뿐이다.
    expect((await list()).coupons.length).toBeGreaterThan(0)
  })
})

describe('발행 중단과 재개', () => {
  it('moves the row to 중단 and back, and touches nothing that was issued', async () => {
    const before = entryOf(await list(), MOCK_PLATFORM_COUPON_IDS.active)

    await suspend(MOCK_PLATFORM_COUPON_IDS.active, true)

    const suspended = entryOf(await list(), MOCK_PLATFORM_COUPON_IDS.active)

    expect(suspended.lifecycle).toBe('SUSPENDED')
    expect(suspended.coupon.suspendedAt).not.toBeNull()
    // 「더 나가지 않게」이지 「나간 것을 무르게」가 아니다.
    expect(suspended.coupon.issuedCount).toBe(before.coupon.issuedCount)
    expect(suspended.stats).toEqual(before.stats)

    await suspend(MOCK_PLATFORM_COUPON_IDS.active, false)

    expect(entryOf(await list(), MOCK_PLATFORM_COUPON_IDS.active).lifecycle).toBe('ACTIVE')
  })

  it('refuses a coupon a real administrator issued, to a demo administrator', async () => {
    resetSessionStore(sessionDemoAdmin)

    const refusal = await refusalOf(() => suspend(MOCK_PLATFORM_COUPON_IDS.active, true))

    expect(refusal.status).toBe(403)
  })

  it('lets a demo administrator manage the coupon a demo account issued', async () => {
    resetSessionStore(sessionDemoAdmin)

    const { coupon } = await suspend(MOCK_PLATFORM_COUPON_IDS.demo, true)

    expect(coupon.suspendedAt).not.toBeNull()
  })
})

describe('일괄 지급', () => {
  it('raises the issued count by what actually went out', async () => {
    const before = entryOf(await list(), MOCK_PLATFORM_COUPON_IDS.active)
    const result = await bulkIssue(MOCK_PLATFORM_COUPON_IDS.active)
    const after = entryOf(await list(), MOCK_PLATFORM_COUPON_IDS.active)

    expect(result.issued).toBeGreaterThan(0)
    expect(after.coupon.issuedCount).toBe(before.coupon.issuedCount + result.issued)
  })

  /**
   * 두 번 눌러도 두 장이 되지 않는다 — 이미 가진 사람은 대상에서 빠진다.
   *
   * **빠지지만 세기는 한다.** 「0장 나갔습니다」만으로는 아무도 대상이 아닌 것과 모두가
   * 이미 가진 것을 가를 수 없고, 그 둘에 발행자가 할 일이 다르다.
   */
  it('counts everybody who already holds it when it is pressed again', async () => {
    const first = await bulkIssue(MOCK_PLATFORM_COUPON_IDS.demo)

    expect(first.skipped).toBe(0)

    const second = await bulkIssue(MOCK_PLATFORM_COUPON_IDS.demo)

    expect(second.issued).toBe(0)
    expect(second.skipped).toBe(first.issued)
    expect(second.remaining).toBe(0)
  })

  /** 조건에 맞는 사람이 아예 없는 자리. 위와 **다른 사건**이다. */
  it('answers zero and zero when the condition matches nobody', async () => {
    const result = await bulkIssue(MOCK_PLATFORM_COUPON_IDS.demo, 'HAS_ORDERED')

    expect(result).toEqual({ issued: 0, skipped: 0, remaining: 0 })
  })

  /** 한 번의 상한에 걸리면 남은 것이 있다고 답하고, 다시 누르면 이어서 나간다. */
  it('stops at the per-call limit and says there is more', async () => {
    const first = await bulkIssue(MOCK_PLATFORM_COUPON_IDS.unlimited)

    expect(first.issued).toBe(BULK_ISSUE_MAX_RECIPIENTS)
    expect(first.remaining).toBeGreaterThan(0)

    const second = await bulkIssue(MOCK_PLATFORM_COUPON_IDS.unlimited)

    expect(second.issued).toBeGreaterThan(0)
  })

  /** 준비된 수량이 다 찼으면 더 나가지 않는다. 대상이 남아 있어도 그렇다. */
  it('gives nothing away once the quantity is gone', async () => {
    const result = await bulkIssue(MOCK_PLATFORM_COUPON_IDS.exhausted)

    expect(result.issued).toBe(0)
    expect(result.remaining).toBeGreaterThan(0)
  })

  it('refuses a coupon whose period has ended, by its own code', async () => {
    const refusal = await refusalOf(() => bulkIssue(MOCK_PLATFORM_COUPON_IDS.ended))

    expect(refusal.status).toBe(403)
    expect(refusal.code).toBe('COUPON_ENDED')
  })

  /**
   * 멈춘 쿠폰은 한꺼번에도 나가지 않는다. 중단의 뜻이 「더 나가지 않게」이므로 한
   * 장씩 막고 한꺼번에는 열어 두면 그 뜻이 문마다 달라진다.
   */
  it('refuses a suspended coupon, by a different code', async () => {
    const refusal = await refusalOf(() => bulkIssue(MOCK_PLATFORM_COUPON_IDS.suspended))

    expect(refusal.status).toBe(403)
    expect(refusal.code).toBe('COUPON_SUSPENDED')
  })

  /** 멈춘 것을 다시 열면 이어서 나간다 — 그것이 「중단」과 「종료」의 차이다. */
  it('lets the same coupon through once it is resumed', async () => {
    await suspend(MOCK_PLATFORM_COUPON_IDS.suspended, false)

    const result = await bulkIssue(MOCK_PLATFORM_COUPON_IDS.suspended)

    expect(result.issued).toBeGreaterThan(0)
  })
})

describe('발행', () => {
  function create(body: Record<string, unknown>): Promise<CouponResponse> {
    return client.request({
      path: '/coupons',
      method: 'POST',
      body: {
        sellerId: null,
        name: '새 쿠폰',
        discountType: 'FIXED',
        discountValue: 1000,
        scopeType: 'ALL',
        validFrom: '2026-09-10T00:00:00.000Z',
        validUntil: '2026-09-20T00:00:00.000Z',
        ...body,
      },
      schema: couponResponseSchema,
    })
  }

  it('puts the new coupon at the top of the list, with nothing issued yet', async () => {
    const { coupon } = await create({ name: '가을 정액 2,000원', discountValue: 2000 })
    const page = await list()

    expect(page.coupons[0]?.coupon.id).toBe(coupon.id)
    expect(coupon.issuedCount).toBe(0)
    expect(coupon.issuerType).toBe('PLATFORM')
  })

  /** 코드는 **서버가 만든다.** 발행자가 고르는 값이 아니다. */
  it('makes the code itself when one was asked for', async () => {
    const withCode = await create({ withCode: true })
    const without = await create({ name: '지급 전용' })

    expect(withCode.coupon.code).not.toBeNull()
    expect(without.coupon.code).toBeNull()
  })

  /** 방문자의 관리자가 낸 쿠폰은 체험 그룹의 것이다 (D-224). */
  it('marks what a demo administrator issues as the demo group', async () => {
    resetSessionStore(sessionDemoAdmin)

    const { coupon } = await create({ name: '체험용 쿠폰' })

    expect(coupon.audience).toBe('DEMO')
  })

  it('marks what a real administrator issues as everybody', async () => {
    const { coupon } = await create({})

    expect(coupon.audience).toBe('ALL')
  })

  /** 판매자 쿠폰의 발행은 판매자 대역의 문이다 — 위의 목록과 같은 이유로 넘긴다. */
  it('leaves a store coupon to the double behind it', async () => {
    server.resetHandlers()
    server.use(httpFailureOn('post', mockPaths.coupons, 404, 'NOT_FOUND', '뒤의 대역입니다.'))
    server.use(...platformCouponHandlers)

    const refusal = await refusalOf(() =>
      create({ sellerId: '019596d0-1f1c-7c2e-9a0e-5a0000000001', scopeType: 'SELLER' }),
    )

    expect(refusal.status).toBe(404)
  })
})
