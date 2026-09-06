/**
 * 정산 화면의 순수 판단 (TASK-0082 F1 · F2 · F3).
 *
 * **틀려도 조용하다.** 계산 근거의 부호를 뒤집으면 합이 맞지 않는 표가 그려질 뿐이고,
 * `sellerId` 를 빠뜨린 질의는 403 으로 돌아와 「권한이 없어요」가 된다 — 판매자가
 * 실제로 겪는 것은 「내 정산서가 안 보인다」이고, 어느 검사도 빨개지지 않는다.
 * `vitest.config.mjs` 가 이 모듈을 분기 100% 로 잡는 이유다.
 */

import type { Settlement } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  calculationLineKeys,
  calculationLines,
  EMPTY_SETTLEMENT_FILTERS,
  inclusiveEnd,
  isNarrowed,
  sellerSettlementQuery,
  settlementHref,
} from '@/lib/settlements/settlement-console'

import { MOCK_SELLER_ID } from './support/settlement-fixtures'

/** `pricing.md` 6장의 예시 그대로. 네 항이 전부 0이 아니다. */
const settlement = {
  approvedAt: null,
  brandName: '루미에르',
  commissionAmount: 189_000,
  createdAt: '2026-09-01T00:00:00.000Z',
  heldAt: null,
  holdReason: null,
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f3001',
  paidAt: null,
  payoutAmount: 1_551_000,
  periodEnd: '2026-08-31T15:00:00.000Z',
  periodStart: '2026-08-24T15:00:00.000Z',
  returnAdjustmentAmount: -120_000,
  salesAmount: 1_890_000,
  sellerCouponAmount: 30_000,
  sellerId: MOCK_SELLER_ID,
  status: 'PENDING',
} satisfies Settlement

describe('inclusiveEnd', () => {
  it('steps back off the exclusive boundary', () => {
    // 계약의 `periodEnd` 는 다음 회차의 시작과 같은 순간이다. 그대로 그리면 하루가
    // 두 회차에 걸쳐 있는 것처럼 읽힌다.
    expect(inclusiveEnd('2026-08-31T15:00:00.000Z')).toBe('2026-08-31T14:59:59.999Z')
  })
})

describe('sellerSettlementQuery', () => {
  it('always carries the seller id', () => {
    // 빠지면 서버는 플랫폼 전체 목록 요청으로 읽고 403 으로 답한다 (F1). 그 거절이
    // 판매자를 남의 정산서에서 떼어 놓는 장치다.
    expect(sellerSettlementQuery(MOCK_SELLER_ID, EMPTY_SETTLEMENT_FILTERS)).toEqual({
      sellerId: MOCK_SELLER_ID,
    })
  })

  it('wraps a chosen status in the contract list', () => {
    expect(sellerSettlementQuery(MOCK_SELLER_ID, { status: 'HOLD' })).toEqual({
      sellerId: MOCK_SELLER_ID,
      status: ['HOLD'],
    })
  })

  it('omits the key entirely rather than sending undefined', () => {
    // `URLSearchParams` 가 `status=undefined` 를 만들면 서버는 그것을 잘못된 상태로
    // 읽어 400 으로 답한다.
    expect('status' in sellerSettlementQuery(MOCK_SELLER_ID, { status: null })).toBe(false)
  })
})

describe('isNarrowed', () => {
  it('tells "there are none" apart from "there are none like this"', () => {
    expect(isNarrowed(EMPTY_SETTLEMENT_FILTERS)).toBe(false)
    expect(isNarrowed({ status: 'PAID' })).toBe(true)
  })
})

describe('settlementHref', () => {
  it("points at this console's own detail route", () => {
    expect(settlementHref(settlement.id)).toBe(`/settlements/${settlement.id}`)
  })
})

describe('calculationLines', () => {
  it('breaks the payout into the five lines pricing.md names', () => {
    expect(calculationLines(settlement).map((line) => line.key)).toEqual([...calculationLineKeys])
  })

  it('keeps commission and the seller coupon as separate lines', () => {
    // 3장 요구사항 5. 「차감 219,000원」 한 줄로 합치면 이 화면이 답하려던 물음 —
    // 「플랫폼이 떼 간 것은 얼마고 내가 낸 것은 얼마냐」 — 이 사라진다.
    const lines = calculationLines(settlement)

    expect(lines.find((line) => line.key === 'commission')?.amount).toBe(-189_000)
    expect(lines.find((line) => line.key === 'sellerCoupon')?.amount).toBe(-30_000)
  })

  it('flips the two positive deductions and leaves the already-negative one', () => {
    const lines = calculationLines(settlement)

    expect(lines.find((line) => line.key === 'returnAdjustment')?.amount).toBe(-120_000)
    expect(lines.find((line) => line.key === 'sales')?.amount).toBe(1_890_000)
  })

  it('takes the payout from the server rather than adding the four up', () => {
    // F3. 화면이 합을 다시 계산하면 판매자 콘솔과 관리자 콘솔이 같은 정산서에 다른
    // 숫자를 적는 날이 오고, 그때 옳은 것은 언제나 서버 쪽이다.
    const payout = calculationLines(settlement).find((line) => line.key === 'payout')

    expect(payout?.amount).toBe(settlement.payoutAmount)
    expect(payout?.total).toBe(true)
  })

  it('still reports the payout the server sent when the four do not add up', () => {
    const drifted = { ...settlement, payoutAmount: 1 }
    const lines = calculationLines(drifted)

    expect(lines.find((line) => line.key === 'payout')?.amount).toBe(1)
  })

  it('marks only the last line as the total', () => {
    expect(calculationLines(settlement).filter((line) => line.total)).toHaveLength(1)
  })
})
