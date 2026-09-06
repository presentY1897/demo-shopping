/**
 * 정산 금액 (TASK-0080 6.2, Q5 강화). 입력 → 출력, 분기 100%.
 *
 * **여기가 틀리면 사람이 손해를 보고, 그 손해는 조용하다.** 판매자에게 덜 주면 그는
 * 몇 주 뒤 정산서의 숫자 하나로만 그것을 알 수 있고, 더 주면 플랫폼이 받아야 할 것을
 * 못 받는데 그쪽은 아무도 신고하지 않는다.
 *
 * R1 이 요구한 「부담 주체별 전수」는 두 곳에 나뉘어 있다. **누가 부담했는가**의
 * 판정은 계산기가 하고(`packages/shared/test/pricing.spec.ts` 의 「부담 주체별
 * 안분」), 여기서 재는 것은 **그 몫만 빠지는가**다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'

import type { SettlementItemSource } from './settlement-calc.js'
import {
  amountsOf,
  differenceOf,
  NO_AMOUNTS,
  sumOf,
  totalsOf,
  weekBefore,
} from './settlement-calc.js'

function item(overrides: Partial<SettlementItemSource> = {}): SettlementItemSource {
  return {
    unitPrice: 10_000,
    quantity: 1,
    returnedQuantity: 0,
    commissionRateBp: 1_000,
    sellerCouponDiscountAmount: 0,
    ...overrides,
  }
}

describe('회차의 경계 (R2)', () => {
  /** 수요일에 봐도 「지난주」는 지난 월요일부터 이번 월요일까지다. */
  it('완전히 끝난 마지막 주를 고른다', () => {
    // 2026-09-09 은 수요일 (KST).
    const period = weekBefore(new Date('2026-09-09T05:00:00.000Z'))

    // 2026-08-31(월) 00:00 KST = 2026-08-30T15:00Z
    expect(period.start.toISOString()).toBe('2026-08-30T15:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-09-06T15:00:00.000Z')
  })

  /** 월요일 새벽에 돌면 방금 끝난 주다. 배치가 도는 시각이다. */
  it('월요일 새벽에는 방금 끝난 주를 고른다', () => {
    const period = weekBefore(new Date('2026-09-06T16:00:00.000Z'))

    expect(period.start.toISOString()).toBe('2026-08-30T15:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-09-06T15:00:00.000Z')
  })

  /** 일요일은 그 주의 마지막 날이다 — 요일 계산이 어긋나면 여기서 하루가 밀린다. */
  it('일요일에도 그 주를 아직 정산하지 않는다', () => {
    const period = weekBefore(new Date('2026-09-06T14:59:59.000Z'))

    expect(period.end.toISOString()).toBe('2026-08-30T15:00:00.000Z')
  })

  /** 끝은 열려 있다 — 다음 회차의 시작과 정확히 맞물린다. */
  it('두 회차가 틈도 겹침도 없이 이어진다', () => {
    const later = weekBefore(new Date('2026-09-09T05:00:00.000Z'))
    const earlier = weekBefore(new Date('2026-09-02T05:00:00.000Z'))

    expect(earlier.end.getTime()).toBe(later.start.getTime())
  })

  it('한 회차는 정확히 7일이다', () => {
    const period = weekBefore(new Date('2026-09-09T05:00:00.000Z'))

    expect(period.end.getTime() - period.start.getTime()).toBe(7 * 24 * 60 * 60 * 1_000)
  })
})

describe('한 몫의 정산액', () => {
  it('판매액에서 수수료를 뺀다 (F2)', () => {
    expect(amountsOf([item()])).toEqual({
      salesAmount: 10_000,
      commissionAmount: 1_000,
      sellerCouponAmount: 0,
      payoutAmount: 9_000,
    })
  })

  /** **판매자 부담 쿠폰만 빠진다** (F3). 플랫폼 쿠폰은 입력에 아예 없다. */
  it('판매자 부담 쿠폰이 빠진다 (F3)', () => {
    const amounts = amountsOf([item({ sellerCouponDiscountAmount: 2_000 })])

    expect(amounts.sellerCouponAmount).toBe(2_000)
    expect(amounts.payoutAmount).toBe(7_000)
  })

  /**
   * **판매액은 정가다** (F4 · F5, D-029).
   *
   * 플랫폼 쿠폰과 적립금은 이 함수의 입력에 **존재하지 않는다.** 그것이 「차감하지
   * 않는다」의 가장 강한 표현이다 — 빼는 코드를 안 쓴 것이 아니라 뺄 값이 없다.
   */
  it('플랫폼 부담은 판매액을 깎지 않는다 (F4 · F5)', () => {
    const amounts = amountsOf([item({ unitPrice: 10_000 })])

    expect(amounts.salesAmount).toBe(10_000)
  })

  it('항목마다 다른 요율로 계산한다', () => {
    const amounts = amountsOf([
      item({ unitPrice: 10_000, commissionRateBp: 300 }),
      item({ unitPrice: 10_000, commissionRateBp: 500 }),
    ])

    expect(amounts.commissionAmount).toBe(300 + 500)
  })

  it('항목이 없으면 0이다', () => {
    expect(amountsOf([])).toEqual(NO_AMOUNTS)
  })
})

describe('반품된 몫', () => {
  it('반품된 수량은 판매액에서 빠진다', () => {
    const amounts = amountsOf([item({ quantity: 3, returnedQuantity: 1 })])

    expect(amounts.salesAmount).toBe(20_000)
    expect(amounts.commissionAmount).toBe(2_000)
  })

  it('전량 반품이면 아무것도 남지 않는다', () => {
    expect(amountsOf([item({ quantity: 2, returnedQuantity: 2 })])).toEqual(NO_AMOUNTS)
  })

  /**
   * 클레임 수량 제약이 막고 있지만, 막는 쪽이 하나 늘어나는 날 이 함수가 음수
   * 판매액을 만들면 그 몫은 **정산서에서 다른 몫의 지급액을 깎는다.**
   */
  it('반품 수량이 주문 수량을 넘어도 음수가 되지 않는다', () => {
    expect(amountsOf([item({ quantity: 1, returnedQuantity: 5 })])).toEqual(NO_AMOUNTS)
  })

  /** 남은 몫에 붙어 있던 할인만 뺀다 — 반품된 몫의 할인은 그가 부담한 적 없다. */
  it('판매자 쿠폰도 남은 수량만큼만 빠지고, 내린다', () => {
    const amounts = amountsOf([
      item({ quantity: 3, returnedQuantity: 1, sellerCouponDiscountAmount: 1_000 }),
    ])

    // 1,000 × 2/3 = 666.67 → 666
    expect(amounts.sellerCouponAmount).toBe(666)
  })
})

describe('누계에서 빼는 장치 (F7)', () => {
  /** 이미 정산된 것과 지금 정산돼야 하는 것의 차이. 언제나 음수이거나 0이다. */
  it('이미 정산된 몫이 반품되면 그만큼이 음수로 나온다', () => {
    const settled = amountsOf([item({ quantity: 2 })])
    const now = amountsOf([item({ quantity: 2, returnedQuantity: 1 })])

    expect(differenceOf(now, settled)).toEqual({
      salesAmount: -10_000,
      commissionAmount: -1_000,
      sellerCouponAmount: 0,
      payoutAmount: -9_000,
    })
  })

  it('반품이 없으면 차이가 0이다', () => {
    const settled = amountsOf([item()])

    expect(differenceOf(settled, settled)).toEqual(NO_AMOUNTS)
  })

  /**
   * **나눠 반품한 사람의 합이 한 번에 반품한 사람과 같아야 한다.**
   *
   * 각각을 따로 계산한 두 번의 내림은 한꺼번에 계산한 한 번의 내림과 어긋날 수
   * 있다. 이 검사는 그 어긋남이 없다는 것을 재고, 전량 반품 하나만 재는 검사로는
   * 절대 밟히지 않는다.
   */
  it('나눠 반품해도 합이 한 번에 반품한 것과 같다', () => {
    const source = { quantity: 3, unitPrice: 10_000, sellerCouponDiscountAmount: 1_000 }
    const sold = amountsOf([item(source)])
    const afterFirst = amountsOf([item({ ...source, returnedQuantity: 1 })])
    const afterSecond = amountsOf([item({ ...source, returnedQuantity: 2 })])

    const stepwise = sumOf([
      sold,
      differenceOf(afterFirst, sold),
      differenceOf(afterSecond, afterFirst),
    ])
    const atOnce = amountsOf([item({ ...source, returnedQuantity: 2 })])

    expect(stepwise).toEqual(atOnce)
  })
})

describe('정산서의 합계 (F8)', () => {
  it('판매 줄의 합이 그대로 합계다', () => {
    const totals = totalsOf([amountsOf([item()]), amountsOf([item()])], [])

    expect(totals.salesAmount).toBe(20_000)
    expect(totals.payoutAmount).toBe(18_000)
    expect(totals.returnAdjustmentAmount).toBe(0)
  })

  /**
   * 차감을 판매액에 섞지 않는 이유는 그러면 정산서에서 **「이번 주에 얼마 팔았나」를
   * 읽을 수 없기** 때문이다 — 지난주 반품이 이번 주 판매액을 깎아 놓는다.
   */
  it('차감은 지급액에만 들어가고 판매액을 건드리지 않는다', () => {
    const adjustment = differenceOf(NO_AMOUNTS, amountsOf([item()]))
    const totals = totalsOf([amountsOf([item()])], [adjustment])

    expect(totals.salesAmount).toBe(10_000)
    expect(totals.returnAdjustmentAmount).toBe(-9_000)
    expect(totals.payoutAmount).toBe(0)
  })

  /**
   * **음수가 될 수 있다.** 지난 회차의 반품이 이번 주 판매보다 크면 그렇다 — 0으로
   * 자르면 그 차액이 사라지고, 사라진 돈은 아무 데도 나타나지 않는다.
   */
  it('차감이 판매보다 크면 지급액이 음수다', () => {
    const big = differenceOf(NO_AMOUNTS, amountsOf([item({ unitPrice: 100_000 })]))
    const totals = totalsOf([amountsOf([item()])], [big])

    expect(totals.payoutAmount).toBeLessThan(0)
  })

  it('아무것도 없으면 0이다', () => {
    expect(totalsOf([], [])).toEqual({ ...NO_AMOUNTS, returnAdjustmentAmount: 0 })
  })
})

/**
 * 설계 문서에서 6장만 잘라 온다 (D2).
 *
 * 식을 여기 다시 적으면 이 검사는 **코드를 코드와 비교하게 된다.** 문서가 기준이고
 * (CLAUDE.md 1장), 문서가 바뀌었는데 코드가 안 바뀌면 여기가 빨개져야 한다.
 */
function settlementChapter(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  const document = readFileSync(join(root, 'docs', 'design', 'pricing.md'), 'utf8')
  const chapter = /^## 6\. 정산 금액[\s\S]*?(?=^## )/mu.exec(document)

  if (chapter === null) throw new Error('pricing.md 의 6장을 찾지 못했습니다.')

  return chapter[0]
}

describe('설계 문서와 같은 것을 말하는가 (D2)', () => {
  /** 네 항이 전부 문서에 있고, 이 파일이 그 넷을 그대로 계산한다. */
  it.each([
    '판매액(실제 구매확정 금액)',
    '− 플랫폼 수수료 (판매액 × 수수료율)',
    '− 판매자 부담 쿠폰 안분액',
    '− 반품으로 확정 취소된 금액',
  ])('식의 「%s」이 문서에 적혀 있다', (term) => {
    expect(settlementChapter()).toContain(term)
  })

  /**
   * **플랫폼 부담을 빼지 않는 것이 이 계산의 핵심이다** (D-029). 이 문장이 문서에서
   * 사라지면 판매자가 정가 기준으로 정산받는다는 근거가 코드에만 남는다.
   */
  it('플랫폼 부담을 차감하지 않는다는 것이 문서에 적혀 있다', () => {
    expect(settlementChapter()).toContain('**플랫폼 부담**이라 차감하지 않는다')
  })
})
