/**
 * 쿠폰 콘솔의 순수 판단 — 예상 비용과, 목록을 좁히는 질의 (TASK-0073).
 *
 * `docs/tasks/QUALITY-GATES.md` Q5 의 「순수 로직」 줄이 이 파일의 이유다: 여기 있는
 * 것은 **틀려도 조용하다.** 예상 비용을 잘못 세면 화면은 그럴듯한 숫자를 하나 그리고,
 * 사람은 그것을 보고 발행 버튼을 누른다. 렌더링 검사는 그 숫자가 「나오는지」는 보지만
 * 「맞는지」는 보지 못한다.
 *
 * 그래서 이 검사는 입력과 출력만 본다. 화면도, 대역도, 문구도 없다.
 */

import type { BulkIssueResponse, CouponListEntry } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  bulkIssueCountOf,
  bulkIssueOutcomeOf,
  EMPTY_PLATFORM_COUPON_FILTERS,
  estimateCouponCost,
  integerFrom,
  isNarrowed,
  mayBulkIssue,
  queryOf,
  usageRate,
} from '@/lib/coupons/platform-coupons'

describe('발급 수량 × 최대 할인액 (F3)', () => {
  it('multiplies the ceiling by the quantity for a fixed coupon', () => {
    const estimate = estimateCouponCost({
      discountType: 'FIXED',
      discountValue: 3000,
      maxDiscountAmount: null,
      issueLimit: 1000,
    })

    expect(estimate).toEqual({ count: 1000, kind: 'estimated', perCoupon: 3000, total: 3_000_000 })
  })

  /** 정률의 한 장당 최대는 **상한**이지 할인율이 아니다. */
  it('uses the ceiling, not the percentage, for a percentage coupon', () => {
    const estimate = estimateCouponCost({
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountAmount: 5000,
      issueLimit: 200,
    })

    expect(estimate).toEqual({ count: 200, kind: 'estimated', perCoupon: 5000, total: 1_000_000 })
  })

  /**
   * 이 파일에서 가장 중요한 줄.
   *
   * 상한 없는 정률 쿠폰 한 장이 깎는 금액은 주문 금액이 정하고 그 금액에는 위가
   * 없으므로, 최대 비용은 **무한대**다. 「10 × 1,000 = 10,000원」은 계산이 아니라
   * 퍼센트와 원을 곱한 값이고, 그것을 화면에 적으면 발행자는 만원짜리 위험을
   * 승인했다고 믿는다.
   */
  it('refuses to put a number on a percentage coupon with no ceiling', () => {
    const estimate = estimateCouponCost({
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountAmount: null,
      issueLimit: 1000,
    })

    expect(estimate).toEqual({ gaps: ['no_ceiling'], kind: 'unbounded' })
  })

  it('refuses to put a number on an unlimited quantity', () => {
    const estimate = estimateCouponCost({
      discountType: 'FIXED',
      discountValue: 3000,
      maxDiscountAmount: null,
      issueLimit: null,
    })

    expect(estimate).toEqual({ gaps: ['no_limit'], kind: 'unbounded' })
  })

  /** 구멍이 둘이면 둘 다 말한다 — 하나만 채워도 여전히 계산할 수 없기 때문이다. */
  it('names both gaps when both are open', () => {
    const estimate = estimateCouponCost({
      discountType: 'PERCENT',
      discountValue: 10,
      maxDiscountAmount: null,
      issueLimit: null,
    })

    expect(estimate).toEqual({ gaps: ['no_ceiling', 'no_limit'], kind: 'unbounded' })
  })

  it('says nothing at all until a type and a value are there', () => {
    const noType = estimateCouponCost({
      discountType: null,
      discountValue: 3000,
      maxDiscountAmount: null,
      issueLimit: 100,
    })
    const noValue = estimateCouponCost({
      discountType: 'FIXED',
      discountValue: null,
      maxDiscountAmount: null,
      issueLimit: 100,
    })
    const zero = estimateCouponCost({
      discountType: 'FIXED',
      discountValue: 0,
      maxDiscountAmount: null,
      issueLimit: 100,
    })

    expect([noType.kind, noValue.kind, zero.kind]).toEqual([
      'incomplete',
      'incomplete',
      'incomplete',
    ])
  })
})

describe('사람이 친 숫자', () => {
  it('takes digits and nothing else', () => {
    expect(integerFrom(' 1200 ')).toBe(1200)
    expect(integerFrom('')).toBeNull()
    // 빈 칸은 「무제한」이고 `0` 은 「없음」이다. `Number('')` 가 그 둘을 뭉갠다.
    expect(integerFrom('   ')).toBeNull()
    expect(integerFrom('1e3')).toBeNull()
    expect(integerFrom('-5')).toBeNull()
    expect(integerFrom('1.5')).toBeNull()
  })
})

describe('목록을 좁히는 질의', () => {
  it('leaves the key out entirely when nothing is chosen', () => {
    expect(queryOf(EMPTY_PLATFORM_COUPON_FILTERS)).toEqual({})
    expect(isNarrowed(EMPTY_PLATFORM_COUPON_FILTERS)).toBe(false)
  })

  /** 계약의 `lifecycle` 은 목록이지만 화면이 고르는 것은 하나다. */
  it('sends the one chosen state as the list the contract takes', () => {
    const filters = { ...EMPTY_PLATFORM_COUPON_FILTERS, lifecycle: 'SUSPENDED' } as const

    expect(queryOf(filters)).toEqual({ lifecycle: ['SUSPENDED'] })
    expect(isNarrowed(filters)).toBe(true)
  })

  /**
   * 사람이 고르는 것은 하루이고 계약이 받는 것은 순간이다.
   *
   * 한국 시간의 하루 — 9월 5일은 UTC 로 9월 4일 15시에 시작해 9월 5일 14시 59분
   * 59.999초에 끝난다. 오프셋을 빼면 브라우저의 시간대가 그 자리를 대신해 같은
   * 「9월 5일」이 사람마다 다른 구간이 된다.
   */
  it('turns the chosen days into the instants the contract takes', () => {
    expect(queryOf({ ...EMPTY_PLATFORM_COUPON_FILTERS, from: '2026-09-05' })).toEqual({
      from: '2026-09-04T15:00:00.000Z',
    })
    expect(queryOf({ ...EMPTY_PLATFORM_COUPON_FILTERS, to: '2026-09-05' })).toEqual({
      to: '2026-09-05T14:59:59.999Z',
    })
  })

  /** 어느 한쪽만 채워도 좁혀진 목록이다 — 「비었다」와 다른 말을 해야 한다. */
  it('counts each axis on its own as narrowed', () => {
    expect(isNarrowed({ ...EMPTY_PLATFORM_COUPON_FILTERS, from: '2026-09-01' })).toBe(true)
    expect(isNarrowed({ ...EMPTY_PLATFORM_COUPON_FILTERS, to: '2026-09-30' })).toBe(true)
  })
})

describe('한 번의 일괄 지급이 무슨 일이었나', () => {
  function result(issued: number, skipped: number, remaining: number): BulkIssueResponse {
    return { issued, remaining, skipped }
  }

  /**
   * 「0장 나갔습니다」가 셋으로 갈린다. 이 판정이 틀리면 화면은 수량이 다 찬 사람에게
   * 「대상을 바꿔 보세요」라고 말하고, 그 사람은 조건을 바꾸며 계속 실패한다.
   */
  it('reads the three numbers as the four things they can mean', () => {
    expect(bulkIssueOutcomeOf(result(300, 0, 0))).toBe('issued')
    // 나간 것이 있으면 그것이 먼저다 — 건너뛴 사람이 있어도 그렇다.
    expect(bulkIssueOutcomeOf(result(300, 50, 1))).toBe('issued')
    expect(bulkIssueOutcomeOf(result(0, 50, 0))).toBe('all_held')
    // 이미 갖고 있다가 수량을 가린다: 다 가진 사람들에게 수량 이야기를 하면
    // 발행자는 수량을 늘리러 간다.
    expect(bulkIssueOutcomeOf(result(0, 50, 3))).toBe('all_held')
    expect(bulkIssueOutcomeOf(result(0, 0, 1))).toBe('quantity_gone')
    expect(bulkIssueOutcomeOf(result(0, 0, 0))).toBe('nobody')
  })

  it('points the sentence at the number that sentence is about', () => {
    expect(bulkIssueCountOf('issued', result(300, 50, 0))).toBe(300)
    expect(bulkIssueCountOf('all_held', result(0, 50, 0))).toBe(50)
    // 나머지 둘의 문장에는 셀 것이 없다 — 자리 표시자 자체가 없다.
    expect(bulkIssueCountOf('quantity_gone', result(0, 0, 1))).toBe(0)
    expect(bulkIssueCountOf('nobody', result(0, 0, 0))).toBe(0)
  })
})

describe('사용률', () => {
  function entry(issuedCount: number, usedCount: number): CouponListEntry {
    return {
      coupon: {
        id: '019598a0-0001-7000-8000-00000000000f',
        issuerType: 'PLATFORM',
        sellerId: null,
        name: '쿠폰',
        code: null,
        discountType: 'FIXED',
        discountValue: 1000,
        maxDiscountAmount: null,
        minOrderAmount: 0,
        scopeType: 'ALL',
        scopeIds: [],
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: '2026-09-30T00:00:00.000Z',
        issueLimit: null,
        audience: 'ALL',
        suspendedAt: null,
        issuedCount,
      },
      lifecycle: 'ACTIVE',
      stats: { usedCount, discountTotal: 0 },
    }
  }

  it('rounds the share of issued coupons that were spent', () => {
    expect(usageRate(entry(240, 120))).toBe(50)
    expect(usageRate(entry(3, 1))).toBe(33)
  })

  /** 아직 한 장도 나가지 않은 쿠폰이 분모 0이다. `NaN%` 는 아무것도 말하지 않는다. */
  it('answers zero rather than dividing by nothing', () => {
    expect(usageRate(entry(0, 0))).toBe(0)
  })
})

describe('아직 지급할 수 있는가', () => {
  /**
   * 서버가 거절하는 **둘**을 그대로 막는다 (`CouponConsoleService.bulkIssue`) — 끝난
   * 쿠폰과 멈춘 쿠폰.
   *
   * 소진된 쿠폰이 여기 없는 것이 요점이다. 그 요청은 거절이 아니라 「0장 나갔다」로
   * 정상 응답하고, 그때 발행자가 알아야 할 것은 **수량이 다 찼다**는 사실이다 —
   * 화면이 미리 막으면 그 문장을 볼 자리가 사라진다.
   */
  it('blocks exactly what the server blocks', () => {
    expect(mayBulkIssue('ENDED')).toBe(false)
    expect(mayBulkIssue('SUSPENDED')).toBe(false)
    expect(mayBulkIssue('SCHEDULED')).toBe(true)
    expect(mayBulkIssue('EXHAUSTED')).toBe(true)
    expect(mayBulkIssue('ACTIVE')).toBe(true)
  })
})
