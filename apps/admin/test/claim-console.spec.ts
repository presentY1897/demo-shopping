/**
 * 관리자 클레임 화면의 순수 판단 (TASK-0071).
 *
 * **이 파일이 재는 것은 전부 「틀려도 조용한」 것들이다.** 뒤집을 수 있는 상태를
 * 잘못 적으면 화면은 누를 수 없는 버튼을 내거나 눌러야 할 버튼을 감추고, 개입 요청을
 * 잘못 조립하면 다른 주문의 항목으로 환불이 나간다 — 어느 쪽도 빨간 검사로 나타나지
 * 않으므로, `vitest.config.mjs` 가 이 모듈을 **분기 100%** 로 잡는다.
 *
 * 세 표(`CLAIM_OVERTURNABLE` · `RETURN_FAULT` · `RETURN_PHOTO_RULE`)는 `apps/api` 의
 * 거울이다. 브라우저가 저쪽을 들여올 수 없어 생긴 사본이므로, 여기서 확인하는 것은
 * **그 사본이 스스로 일관된가**이고 최종 판정은 언제나 서버가 한다.
 */

import type { Claim } from '@shopping/shared'
import { claimStatuses, returnReasons } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { AdminClaimFilters } from '@/lib/claims/claim-console'
import {
  CLAIM_OVERTURNABLE,
  canOverturn,
  dayEnd,
  dayStart,
  EMPTY_ADMIN_CLAIM_FILTERS,
  EMPTY_FORCE_INPUT,
  faultOf,
  forceIssues,
  forcePhotoRule,
  forceRequestOf,
  interventionBlockOf,
  isNarrowed,
  queryOf,
  RETURN_FAULT,
  RETURN_PHOTO_RULE,
} from '@/lib/claims/claim-console'

/** 관리자가 올린 사진 한 장의 열쇠. 주인이 접두어에 있는 형식이다. */
const PHOTO_KEY =
  'returns/019596d0-1f1c-7c2e-9a0e-4a5a3a2f0003/019597a0-0009-7000-8000-000000000001.png'

/** 거절된 취소 하나, 상세가 받는 모양 그대로. */
function claimOf(overrides: Partial<Claim> = {}): Claim {
  return {
    id: '019597a0-0001-7000-8000-000000000202',
    sellerOrderId: '019597a0-0004-7000-8000-000000000202',
    orderId: '019597a0-0004-7000-8000-000000000202',
    orderNumber: '20260905-00000002',
    type: 'CANCEL',
    status: 'CANCEL_REJECTED',
    reason: '주문을 잘못했어요.',
    fault: 'CUSTOMER',
    requestedById: '019597a0-0003-7000-8000-000000000202',
    requestedAt: '2026-09-05T21:00:00.000Z',
    updatedAt: '2026-09-05T22:00:00.000Z',
    items: [
      {
        id: '019597a0-0005-7000-8000-000000000202',
        orderItemId: '019597a0-0005-7000-8000-0000000002aa',
        variantId: '019597a0-0005-7000-8000-0000000002bb',
        snapshot: {
          productId: '019597a0-0004-7000-8000-0000000002cc',
          productName: '울 블렌드 코트',
          optionLabel: '블랙 / M',
          sku: 'SKU-02',
          thumbnailUrl: null,
          brandName: '루미에르',
        },
        quantity: 2,
        refundAmount: 0,
      },
    ],
    history: [],
    overturnsClaimId: null,
    overturnedByClaimIds: [],
    appeal: null,
    ...overrides,
  }
}

describe('무엇을 뒤집을 수 있는가', () => {
  it('covers every status the contract can answer with', () => {
    // 상태가 하나 늘면 컴파일이 막는다는 성질을, 값의 개수로 한 번 더 확인한다.
    expect(Object.keys(CLAIM_OVERTURNABLE).toSorted()).toEqual([...claimStatuses].toSorted())
  })

  it('opens only the two conclusions a seller can reach', () => {
    const overturnable = claimStatuses.filter((status) => canOverturn(status))

    expect(overturnable).toEqual(['CANCEL_REJECTED', 'RETURN_REJECTED'])
  })

  it.each([
    { status: 'CANCEL_REJECTED', block: null },
    { status: 'RETURN_REJECTED', block: null },
    // 기다리면 열린다.
    { status: 'CANCEL_REQUESTED', block: 'not_concluded' },
    { status: 'INSPECTING', block: 'not_concluded' },
    // 영영 열리지 않는다 — 나간 돈을 도로 받는 절차가 없다.
    { status: 'REFUNDED', block: 'settled' },
  ] as const)('$status 은 $block 로 막힌다', ({ status, block }) => {
    expect(interventionBlockOf(status)).toBe(block)
  })
})

describe('귀책', () => {
  it('takes the operator’s judgment for a cancellation', () => {
    expect(faultOf('CANCEL', { ...EMPTY_FORCE_INPUT, fault: 'CUSTOMER' })).toBe('CUSTOMER')
  })

  it('derives it from the reason for a return, which is where the shipping fee is decided', () => {
    expect(faultOf('RETURN', { ...EMPTY_FORCE_INPUT, returnReason: 'CHANGE_OF_MIND' })).toBe(
      'CUSTOMER',
    )
    expect(faultOf('RETURN', { ...EMPTY_FORCE_INPUT, returnReason: 'WRONG_ITEM' })).toBe('SELLER')
    expect(RETURN_FAULT.DEFECTIVE).toBe('SELLER')
  })
})

describe('개입 요청 조립', () => {
  it('carries the rejection’s own items and points back at it', () => {
    const claim = claimOf()

    expect(
      forceRequestOf(claim, { ...EMPTY_FORCE_INPUT, reason: '배송 기록이 다릅니다.' }),
    ).toEqual({
      sellerOrderId: claim.sellerOrderId,
      items: [{ orderItemId: claim.items[0]?.orderItemId, quantity: 2 }],
      reason: '배송 기록이 다릅니다.',
      fault: 'SELLER',
      return: null,
      overturnsClaimId: claim.id,
    })
  })

  it('sends the return details instead of a fault when the rejection was a return', () => {
    const claim = claimOf({ type: 'RETURN', status: 'RETURN_REJECTED' })

    const request = forceRequestOf(claim, { ...EMPTY_FORCE_INPUT, reason: '하자가 확인됩니다.' })

    // 계약이 **정확히 하나**를 요구한다 — 둘 다 실으면 「오배송인데 구매자 귀책」이
    // 표현 가능해지고, 둘 다 비면 환불액을 아무도 계산할 수 없다.
    expect({ fault: request.fault, return: request.return }).toEqual({
      fault: null,
      return: { returnReason: 'DEFECTIVE', photoKeys: [] },
    })
  })
})

describe('사진', () => {
  it('covers every reason the contract can answer with', () => {
    // 사유가 하나 늘면 컴파일이 막힌다는 성질을, 값의 개수로 한 번 더 확인한다.
    expect(Object.keys(RETURN_PHOTO_RULE).toSorted()).toEqual([...returnReasons].toSorted())
  })

  it.each([
    { type: 'RETURN', reason: 'DEFECTIVE', rule: 'required' },
    { type: 'RETURN', reason: 'WRONG_ITEM', rule: 'required' },
    // 뒤집을 것이 없는 주장에 증거를 받지 않는다. 붙이면 서버가 거절한다.
    { type: 'RETURN', reason: 'CHANGE_OF_MIND', rule: 'forbidden' },
    // 취소에는 붙일 자리가 없다 — 계약이 `return` 을 싣지 않는다.
    { type: 'CANCEL', reason: 'DEFECTIVE', rule: 'forbidden' },
  ] as const)('$type · $reason 이면 사진은 $rule 이다', ({ type, reason, rule }) => {
    expect(forcePhotoRule(type, reason)).toBe(rule)
  })

  /**
   * **비활성 버튼을 대신하는 값이다.** 화면은 이 목록으로 문장을 고르고, 버튼은 살아
   * 있다 (TASK-0063 4.1).
   */
  it('names what a defect overturn is still short of', () => {
    expect(forceIssues('RETURN', EMPTY_FORCE_INPUT)).toEqual(['photo_required'])
    expect(
      forceIssues('RETURN', { ...EMPTY_FORCE_INPUT, photoKeys: [PHOTO_KEY], uploading: true }),
    ).toEqual(['photo_uploading'])
    // 둘이 동시에 참일 수 있다. 하나만 돌려주면 사람은 한 번에 하나씩만 알게 된다.
    expect(forceIssues('RETURN', { ...EMPTY_FORCE_INPUT, uploading: true })).toEqual([
      'photo_required',
      'photo_uploading',
    ])
    expect(forceIssues('RETURN', { ...EMPTY_FORCE_INPUT, photoKeys: [PHOTO_KEY] })).toEqual([])
  })

  it('asks nothing of the paths that take no photo at all', () => {
    expect(forceIssues('CANCEL', EMPTY_FORCE_INPUT)).toEqual([])
    expect(forceIssues('RETURN', { ...EMPTY_FORCE_INPUT, returnReason: 'CHANGE_OF_MIND' })).toEqual(
      [],
    )
  })

  it('carries the attached photos on a defect overturn', () => {
    const claim = claimOf({ type: 'RETURN', status: 'RETURN_REJECTED' })

    const request = forceRequestOf(claim, {
      ...EMPTY_FORCE_INPUT,
      reason: '하자가 확인됩니다.',
      photoKeys: [PHOTO_KEY],
    })

    expect(request.return).toEqual({ returnReason: 'DEFECTIVE', photoKeys: [PHOTO_KEY] })
  })

  /**
   * **칸을 감추는 것만으로는 모자란다.** 하자로 골라 붙였다가 단순 변심으로 바꾼
   * 사람의 열쇠가 그대로 나가면 서버가 `RETURN_PHOTO_NOT_ALLOWED` 로 거절한다.
   */
  it('leaves them behind when the chosen reason forbids them', () => {
    const claim = claimOf({ type: 'RETURN', status: 'RETURN_REJECTED' })

    const request = forceRequestOf(claim, {
      ...EMPTY_FORCE_INPUT,
      reason: '변심 반품을 그대로 승인합니다.',
      returnReason: 'CHANGE_OF_MIND',
      photoKeys: [PHOTO_KEY],
    })

    expect(request.return).toEqual({ returnReason: 'CHANGE_OF_MIND', photoKeys: [] })
  })
})

describe('필터', () => {
  it('says nothing is narrowed when nothing is set', () => {
    expect(isNarrowed(EMPTY_ADMIN_CLAIM_FILTERS)).toBe(false)
    expect(queryOf(EMPTY_ADMIN_CLAIM_FILTERS)).toEqual({})
  })

  it.each([
    ['sellerId', { sellerId: '019597a0-0002-7000-8000-000000000101' }],
    ['buyerId', { buyerId: '019597a0-0003-7000-8000-000000000202' }],
    ['status', { status: 'REFUNDED' as const }],
    ['stage', { stage: 'WAITING' as const }],
    ['type', { type: 'RETURN' as const }],
    ['from', { from: '2026-09-05' }],
    ['to', { to: '2026-09-06' }],
    ['appealed', { appealed: true }],
  ])('%s 하나만 걸어도 좁힌 것이다', (_name, patch: Partial<AdminClaimFilters>) => {
    expect(isNarrowed({ ...EMPTY_ADMIN_CLAIM_FILTERS, ...patch })).toBe(true)
  })

  it('turns a day into the instants that day covers, in the console’s time zone', () => {
    // 「9월 5일까지」가 그날 저녁까지라는 뜻이 되는 자리. 오프셋을 빼면 브라우저의
    // 시간대가 그 자리를 대신하고, 같은 날짜가 사람마다 다른 구간이 된다.
    expect(dayStart('2026-09-05')).toBe('2026-09-04T15:00:00.000Z')
    expect(dayEnd('2026-09-05')).toBe('2026-09-05T14:59:59.999Z')
  })

  it('builds the query the contract takes, with one status in a list', () => {
    expect(
      queryOf({
        sellerId: '019597a0-0002-7000-8000-000000000101',
        sellerName: '루미에르',
        buyerId: '019597a0-0003-7000-8000-000000000202',
        status: 'RETURN_REJECTED',
        stage: 'CLOSED',
        type: 'RETURN',
        from: '2026-09-05',
        to: '2026-09-06',
        appealed: true,
      }),
    ).toEqual({
      sellerId: '019597a0-0002-7000-8000-000000000101',
      buyerId: '019597a0-0003-7000-8000-000000000202',
      status: ['RETURN_REJECTED'],
      stage: 'CLOSED',
      type: 'RETURN',
      from: '2026-09-04T15:00:00.000Z',
      to: '2026-09-06T14:59:59.999Z',
      appealed: true,
    })
  })

  it('leaves the store’s name out of the query, because the contract has no such axis', () => {
    const query = queryOf({ ...EMPTY_ADMIN_CLAIM_FILTERS, sellerName: '루미에르' })

    expect(query).toEqual({})
  })
})
