/**
 * 확정 후 하자 반품의 순수 판단 (TASK-0071 F4).
 *
 * `claim-console.spec.ts` 와 같은 이유로 자기 파일을 갖는다: 여기 있는 것들은 **틀려도
 * 조용하다.** 진입 조건을 잘못 읽으면 화면은 확정되지 않은 주문에 반품 폼을 그리거나
 * 확정된 주문에 「여기가 아니다」를 말하고, 요청을 잘못 조립하면 **다른 항목이 반품으로
 * 나간다** — 어느 쪽도 빨간 검사로 나타나지 않는다.
 *
 * `vitest.config.mjs` 가 이 파일이 재는 모듈을 **분기 100%** 로 잡고 있다.
 */

import type { ClaimableItem, ClaimableResponse, ClaimRefusal } from '@shopping/shared'
import {
  CLAIM_REASON_MAX_LENGTH,
  RETURN_PHOTO_MAX_COUNT,
  returnReasons,
  UPLOAD_MAX_BYTES,
  uploadContentTypes,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  claimableTargets,
  DEFECT_RETURN_REASONS,
  defectQuantityChoices,
  defectReturnBlockOf,
  defectReturnIssues,
  defectReturnLines,
  defectReturnRequestOf,
  defectReturnTargetOf,
  EMPTY_DEFECT_RETURN_DRAFT,
  isDefectReturnReason,
  withDefectQuantity,
  withDefectTarget,
} from '@/lib/claims/defect-return'
import { checkReturnPhoto, RETURN_PHOTO_ACCEPT } from '@/lib/claims/return-photos'

const SELLER_ORDER_ID = '019597a0-0008-7000-8000-00000000c001'

function item(overrides: Partial<ClaimableItem> = {}): ClaimableItem {
  return {
    orderItemId: '019597a0-0008-7000-8000-00000000a001',
    variantId: '019597a0-0008-7000-8000-00000000b001',
    snapshot: {
      productId: '019597a0-0008-7000-8000-00000000c0a1',
      productName: '울 블렌드 코트',
      optionLabel: '블랙 / M',
      sku: 'SKU-01',
      thumbnailUrl: null,
      brandName: '루미에르',
    },
    quantity: 2,
    claimedQuantity: 0,
    remainingQuantity: 2,
    ...overrides,
  }
}

function claimable(overrides: Partial<ClaimableResponse> = {}): ClaimableResponse {
  return {
    sellerOrderId: SELLER_ORDER_ID,
    type: null,
    refusal: 'confirmed',
    returnWindowEndsAt: null,
    items: [item()],
    ...overrides,
  }
}

describe('대상을 무엇으로 찾는가', () => {
  it('판매자 주문 식별자만 조회로 이어진다', () => {
    expect(defectReturnTargetOf(SELLER_ORDER_ID)).toBe('seller_order_id')
    // 붙여넣기에 딸려 오는 공백은 값의 일부가 아니다.
    expect(defectReturnTargetOf(`  ${SELLER_ORDER_ID}  `)).toBe('seller_order_id')
  })

  it('아무것도 적지 않은 칸은 오류가 아니라 빈 칸이다', () => {
    expect(defectReturnTargetOf('')).toBe('empty')
    expect(defectReturnTargetOf('   ')).toBe('empty')
  })

  /**
   * **이 갈래가 이 화면의 보고 사항이다.**
   *
   * 사람이 손에 들고 오는 값은 주문번호인데, 그것으로 판매자 몫을 찾는 조회 라우트가
   * 없다. 「형식이 틀렸다」로 뭉뚱그리면 운영자는 번호를 다시 확인하다가 시간을 쓴다.
   */
  it('주문번호는 맞는 값이지만 **찾을 수 없는 값**이라 따로 갈린다', () => {
    expect(defectReturnTargetOf('20260901-000000C1')).toBe('order_number')
    // 사람이 소문자로 적어도 같은 번호다.
    expect(defectReturnTargetOf('20260901-000000c1')).toBe('order_number')
  })

  it('둘 다 아니면 형식이 아니다', () => {
    expect(defectReturnTargetOf('주문 좀 찾아줘')).toBe('unrecognised')
    expect(defectReturnTargetOf('019597a0-0008-7000-8000')).toBe('unrecognised')
  })
})

describe('사유는 판매자 귀책 둘뿐이다', () => {
  it('단순 변심이 없다 — 그것으로 확정을 되돌릴 수는 없다', () => {
    expect(DEFECT_RETURN_REASONS).toEqual(['DEFECTIVE', 'WRONG_ITEM'])
    expect(DEFECT_RETURN_REASONS).not.toContain('CHANGE_OF_MIND')
  })

  /** 목록이 **손으로 적힌 것이 아니라** 귀책 표에서 파생된다는 것. */
  it('계약의 사유 전부에 대해 귀책이 판매자인 것만 남는다', () => {
    expect(returnReasons.filter((reason) => isDefectReturnReason(reason))).toEqual([
      ...DEFECT_RETURN_REASONS,
    ])
  })
})

describe('이 몫에서 시작할 수 있는가', () => {
  it('구매확정한 몫이고 남은 수량이 있으면 열린다', () => {
    expect(defectReturnBlockOf(claimable())).toBeNull()
  })

  it('아직 확정 전이면 정상 경로가 열려 있다', () => {
    expect(defectReturnBlockOf(claimable({ type: 'RETURN', refusal: null }))).toBe(
      'claim_path_open',
    )
  })

  /** 거절 넷이 각각 다른 문장으로 끝난다. `Record` 라 하나가 늘면 컴파일이 막는다. */
  it.each<[Exclude<ClaimRefusal, 'confirmed'>, string]>([
    ['in_transit', 'in_transit'],
    ['window_closed', 'window_closed'],
    ['not_claimable', 'not_claimable'],
    ['invalid_quantity', 'not_claimable'],
    ['exceeds_remaining', 'nothing_left'],
  ])('거절 %s 는 %s 로 읽힌다', (refusal, block) => {
    expect(defectReturnBlockOf(claimable({ refusal }))).toBe(block)
  })

  it('확정된 몫이라도 남은 수량이 없으면 고를 것이 없다', () => {
    const exhausted = claimable({
      items: [item({ claimedQuantity: 2, remainingQuantity: 0 })],
    })

    expect(defectReturnBlockOf(exhausted)).toBe('nothing_left')
  })

  it('남은 수량이 0인 줄은 고를 목록에서 빠진다', () => {
    const mixed = claimable({
      items: [
        item(),
        item({
          orderItemId: '019597a0-0008-7000-8000-00000000a002',
          quantity: 1,
          claimedQuantity: 1,
          remainingQuantity: 0,
        }),
      ],
    })

    expect(claimableTargets(mixed)).toHaveLength(1)
    expect(defectReturnBlockOf(mixed)).toBeNull()
  })

  it('고를 수 있는 수량은 서버가 답한 잔여까지다', () => {
    expect(defectQuantityChoices(item({ remainingQuantity: 3 }))).toEqual([1, 2, 3])
    expect(defectQuantityChoices(item({ remainingQuantity: 0 }))).toEqual([])
  })
})

describe('신청서', () => {
  const orderItemId = item().orderItemId

  it('고르면 수량 1로 들어오고, 물리면 키째 사라진다', () => {
    const chosen = withDefectTarget({}, orderItemId, true)

    expect(chosen).toEqual({ [orderItemId]: 1 })
    expect(withDefectTarget(chosen, orderItemId, false)).toEqual({})
  })

  it('이미 고른 줄을 다시 고르면 수량이 유지된다', () => {
    const chosen = withDefectQuantity(withDefectTarget({}, orderItemId, true), orderItemId, 2)

    expect(withDefectTarget(chosen, orderItemId, true)).toEqual({ [orderItemId]: 2 })
  })

  it('고르지 않은 줄의 수량은 바뀌지 않는다', () => {
    expect(withDefectQuantity({}, orderItemId, 3)).toEqual({})
  })

  it('아무것도 없는 신청서는 세 가지가 빈다', () => {
    expect(defectReturnIssues(EMPTY_DEFECT_RETURN_DRAFT)).toEqual([
      'no_items',
      'reason_required',
      'photo_required',
    ])
  })

  it('사유가 상한을 넘으면 「비었다」가 아니라 「길다」로 말한다', () => {
    const issues = defectReturnIssues({
      ...EMPTY_DEFECT_RETURN_DRAFT,
      selection: { [orderItemId]: 1 },
      reason: 'ㄱ'.repeat(CLAIM_REASON_MAX_LENGTH + 1),
      photoKeys: [
        'returns/019597a0-0007-7000-8000-0000000000a1/019597a0-0009-7000-8000-000000000001.png',
      ],
    })

    expect(issues).toEqual(['reason_too_long'])
  })

  it('아직 올라가는 중인 사진이 있으면 보내지 않는다', () => {
    const issues = defectReturnIssues({
      ...EMPTY_DEFECT_RETURN_DRAFT,
      selection: { [orderItemId]: 1 },
      reason: '하자를 확인했습니다.',
      photoKeys: [
        'returns/019597a0-0007-7000-8000-0000000000a1/019597a0-0009-7000-8000-000000000001.png',
      ],
      uploading: true,
    })

    expect(issues).toEqual(['photo_uploading'])
  })

  it('다 채우면 보낼 수 있다', () => {
    expect(
      defectReturnIssues({
        ...EMPTY_DEFECT_RETURN_DRAFT,
        selection: { [orderItemId]: 1 },
        reason: '하자를 확인했습니다.',
        photoKeys: [
          'returns/019597a0-0007-7000-8000-0000000000a1/019597a0-0009-7000-8000-000000000001.png',
        ],
      }),
    ).toEqual([])
  })

  it('고른 줄만, 목록에 보이는 순서 그대로 실린다', () => {
    const second = item({ orderItemId: '019597a0-0008-7000-8000-00000000a002' })

    expect(defectReturnLines({ [second.orderItemId]: 2 }, [item(), second])).toEqual([
      { orderItemId: second.orderItemId, quantity: 2 },
    ])
  })

  /**
   * **`overturnsClaimId` 가 `null` 인 것이 이 경로의 전부다.**
   *
   * 거절을 뒤집는 개입과 같은 라우트를 지나고, 서버에서 갈리는 자리도 그 한 칸이다.
   * `fault` 가 함께 `null` 인 것은 계약의 요구다 — 반품의 귀책은 사유가 정한다.
   */
  it('원본이 없는 개입으로 조립된다', () => {
    const request = defectReturnRequestOf(SELLER_ORDER_ID, [item()], {
      ...EMPTY_DEFECT_RETURN_DRAFT,
      selection: { [orderItemId]: 2 },
      returnReason: 'WRONG_ITEM',
      photoKeys: [
        'returns/019597a0-0007-7000-8000-0000000000a1/019597a0-0009-7000-8000-000000000001.png',
      ],
      reason: '  다른 상품이 배송됐습니다.  ',
    })

    expect(request).toEqual({
      sellerOrderId: SELLER_ORDER_ID,
      items: [{ orderItemId, quantity: 2 }],
      reason: '다른 상품이 배송됐습니다.',
      fault: null,
      return: {
        returnReason: 'WRONG_ITEM',
        photoKeys: [
          'returns/019597a0-0007-7000-8000-0000000000a1/019597a0-0009-7000-8000-000000000001.png',
        ],
      },
      overturnsClaimId: null,
    })
  })
})

/**
 * 사진을 고르는 자리의 판정 (`return-photos.ts`).
 *
 * presign 왕복 **앞에** 있는 이유가 이 블록이 재는 것이다 — 그 400 은 어느 파일이
 * 문제인지 말해 주지 않고, 셋을 나눈 기준은 사람이 할 일이 서로 다르다는 것이다.
 */
describe('사진 한 장을 올려도 되는가', () => {
  const png = { type: 'image/png', size: 1024 }

  it('계약이 받는 형식이면 그 형식을 돌려준다', () => {
    expect(checkReturnPhoto(png, 0)).toEqual({ ok: true, contentType: 'image/png' })
  })

  it('`accept` 에 실리는 목록이 계약이 받는 목록과 같다', () => {
    expect(RETURN_PHOTO_ACCEPT).toBe(uploadContentTypes.join(','))
  })

  it('이미지가 아니면 다른 파일을 골라야 한다', () => {
    expect(checkReturnPhoto({ type: 'image/gif', size: 10 }, 0)).toEqual({
      ok: false,
      reason: 'unsupported_type',
    })
  })

  it('상한을 넘으면 줄여서 올려야 한다', () => {
    expect(checkReturnPhoto({ ...png, size: UPLOAD_MAX_BYTES + 1 }, 0)).toEqual({
      ok: false,
      reason: 'too_large',
    })
    // 경계는 포함이다 — 정확히 상한인 파일은 올라간다.
    expect(checkReturnPhoto({ ...png, size: UPLOAD_MAX_BYTES }, 0)).toEqual({
      ok: true,
      contentType: 'image/png',
    })
  })

  /** 장수를 **먼저** 센다. 다 찬 목록에 「형식이 다르다」고 답할 이유가 없다. */
  it('이미 다섯 장이면 형식을 보기 전에 거절한다', () => {
    expect(checkReturnPhoto({ type: 'image/gif', size: 10 }, RETURN_PHOTO_MAX_COUNT)).toEqual({
      ok: false,
      reason: 'too_many',
    })
  })
})
