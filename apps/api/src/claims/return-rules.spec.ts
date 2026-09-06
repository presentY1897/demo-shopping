import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ReturnReason } from '@shopping/shared'
import { claimStatuses, RETURN_PHOTO_MAX_COUNT, returnReasons } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { findRepoRoot } from '../config/workspace.js'
import type { ReturnLine } from './return-rules.js'
import {
  isOwnPhotoKey,
  RETURN_SETTLED,
  returnCostShare,
  returnFaultOf,
  returnFeeBearerOf,
  returnInspectionOutcome,
  returnPhotoDecision,
  returnPhotosRequired,
  returnScopeOf,
  returnSettledStatuses,
  returnStepDecision,
} from './return-rules.js'

/**
 * 반품의 순수 판단, 남김없이 (TASK-0067 6.2 — Q5 강화, 분기 100%).
 *
 * **틀리는 방식이 전부 조용하다.** 귀책 한 칸이 뒤집히면 판매자가 잘못한 반품에서
 * 구매자가 반품비를 물고, 사진 규칙 한 칸이 헐거워지면 근거 없이 판매자에게 돈을
 * 물릴 수 있으며, 검수 표 한 칸이 뒤집히면 **물건을 못 받았는데 환불이 나간다.**
 * 셋 다 빨간 검사가 아니라 몇 주 뒤 문의 하나로 나타난다.
 *
 * 그래서 재는 것이 다섯이다. **표가 설계 문서와 같은 것을 말하는가**(1절), **셋이
 * 저마다 답을 갖고 그 답이 돈으로 어떻게 갈리는가**(2절), **사진의 경계**(3절),
 * **합격일 때만 환불인가**(4절), **걸음의 자리**(5절).
 *
 * 1절이 없으면 나머지는 표를 표와 비교하는 셈이 된다.
 */

/** 이 파일이 유일하게 밖을 보는 자리. 문서와 코드가 갈리지 않는지 재기 위해서다. */
function pricingDoc(): string {
  const root = findRepoRoot()

  if (root === null) throw new Error('워크스페이스 루트를 찾지 못했습니다.')

  return readFileSync(join(root, 'docs', 'design', 'pricing.md'), 'utf8')
}

describe('1. 설계 문서와 같은 것을 말하는가', () => {
  /**
   * `pricing.md` 3장의 배송비 표 두 줄을 문서에서 직접 읽는다.
   *
   * **표를 여기 다시 적으면 이 검사는 코드를 코드와 비교하게 된다.** 문서가 기준이고
   * (CLAUDE.md 1장), 문서가 바뀌었는데 코드가 안 바뀌면 여기가 빨개져야 한다.
   */
  it('판매자 귀책이면 배송비·반품비 모두 판매자 부담이라고 문서가 말한다', () => {
    expect(pricingDoc()).toContain(
      '| 판매자 귀책 반품 | 배송비·반품비 모두 판매자 부담, 구매자에게 전액 환불 |',
    )
  })

  it('단순 변심이면 반품 배송비를 환불액에서 차감한다고 문서가 말한다', () => {
    expect(pricingDoc()).toContain('| 단순 변심 반품 | 반품 배송비를 환불액에서 차감 |')
  })

  /**
   * **문서가 말하지 않은 것도 재 둔다.** 반품 배송비의 *금액*은 `pricing.md` 에 없고,
   * 그래서 서비스가 정했다(`return.service.ts` 의 표). 나중에 문서에 그 값이 생기면
   * 이 단언이 빨개지고, 그때가 두 곳을 맞출 때다.
   */
  it('반품 배송비의 금액은 아직 문서에 없다', () => {
    expect(pricingDoc()).not.toContain('반품 배송비 =')
  })
})

describe('2. 귀책 셋 — 저마다 답이 있고, 돈으로는 둘로 갈린다', () => {
  /** 셋 전부가 답을 갖는다. 하나라도 빠지면 그 신청의 환불액은 계산될 수 없다. */
  it.each(returnReasons)('%s 에 귀책과 부담자가 있다', (reason) => {
    expect(['CUSTOMER', 'SELLER']).toContain(returnFaultOf(reason))
    expect(['BUYER', 'SELLER']).toContain(returnFeeBearerOf(reason))
  })

  it('단순 변심은 구매자 귀책이고 구매자가 반품비를 문다', () => {
    expect(returnFaultOf('CHANGE_OF_MIND')).toBe('CUSTOMER')
    expect(returnFeeBearerOf('CHANGE_OF_MIND')).toBe('BUYER')
  })

  it('상품 하자는 판매자 귀책이고 판매자가 반품비를 문다', () => {
    expect(returnFaultOf('DEFECTIVE')).toBe('SELLER')
    expect(returnFeeBearerOf('DEFECTIVE')).toBe('SELLER')
  })

  it('오배송도 판매자 귀책이고 판매자가 반품비를 문다', () => {
    expect(returnFaultOf('WRONG_ITEM')).toBe('SELLER')
    expect(returnFeeBearerOf('WRONG_ITEM')).toBe('SELLER')
  })

  /**
   * **하자와 오배송은 돈에서 같다.** 그래서 값을 둘로 접지 않고 셋으로 둔 이유가
   * 돈이 아니라는 것을 여기서 못 박는다 — 둘이 언젠가 다른 금액을 내야 한다면
   * 그때 이 단언이 먼저 빨개진다.
   */
  it('하자와 오배송은 같은 부담을 낸다 — 다른 것은 사유뿐이다', () => {
    const fees = { returnShippingFee: 3_000, originalShippingFee: 2_500 }

    expect(returnCostShare('DEFECTIVE', fees)).toEqual(returnCostShare('WRONG_ITEM', fees))
    expect(returnFaultOf('DEFECTIVE')).toBe(returnFaultOf('WRONG_ITEM'))
  })

  it('단순 변심은 반품비를 환불액에서 빼고 원 배송비를 돌려주지 않는다', () => {
    expect(
      returnCostShare('CHANGE_OF_MIND', { returnShippingFee: 3_000, originalShippingFee: 2_500 }),
    ).toEqual({
      feeBearer: 'BUYER',
      returnShippingDeduction: 3_000,
      originalShippingRefund: 0,
    })
  })

  it('판매자 귀책은 아무것도 빼지 않고 원 배송비를 돌려준다', () => {
    expect(
      returnCostShare('DEFECTIVE', { returnShippingFee: 3_000, originalShippingFee: 2_500 }),
    ).toEqual({
      feeBearer: 'SELLER',
      returnShippingDeduction: 0,
      originalShippingRefund: 2_500,
    })
  })

  /**
   * 무료배송이었던 주문의 판매자 귀책 반품.
   *
   * 돌려줄 원 배송비가 0 인 것은 **받은 적이 없기 때문**이지 규칙이 다르기
   * 때문이 아니다. 반품비는 그래도 판매자가 문다 — 그것이
   * `Seller.shippingFee` 를 반품비의 출처로 고른 이유다.
   */
  it('무료배송이었으면 돌려줄 원 배송비가 없다 — 반품비 부담은 그대로다', () => {
    expect(
      returnCostShare('WRONG_ITEM', { returnShippingFee: 3_000, originalShippingFee: 0 }),
    ).toEqual({
      feeBearer: 'SELLER',
      returnShippingDeduction: 0,
      originalShippingRefund: 0,
    })
  })

  /** 두 금액이 **동시에** 0보다 클 수 없다. `ReturnDetail_bearer_amount_check` 이 같은 것을 DB 에서 지킨다. */
  it.each(returnReasons)('%s — 차감과 환불이 동시에 서지 않는다', (reason) => {
    const share = returnCostShare(reason, { returnShippingFee: 3_000, originalShippingFee: 2_500 })

    expect(share.returnShippingDeduction === 0 || share.originalShippingRefund === 0).toBe(true)
  })
})

describe('3. 사진 — 경계가 전부다', () => {
  const OWNER = '11111111-2222-4333-8444-555555555555'
  const OTHER = '99999999-8888-4777-8666-555555555555'

  function keyOf(owner: string, index: number): string {
    return `returns/${owner}/0000000${index}-0000-4000-8000-000000000000.jpg`
  }

  it('하자·오배송은 사진을 요구하고 단순 변심은 요구하지 않는다', () => {
    expect(returnPhotosRequired('DEFECTIVE')).toBe(true)
    expect(returnPhotosRequired('WRONG_ITEM')).toBe(true)
    expect(returnPhotosRequired('CHANGE_OF_MIND')).toBe(false)
  })

  /** 이 TASK 가 검사하기로 한 경계 ①. */
  it('사진 없는 하자 반품은 거절된다', () => {
    expect(returnPhotoDecision('DEFECTIVE', [], OWNER)).toEqual({
      outcome: 'refused',
      reason: 'photo_required',
    })
  })

  /** 이 TASK 가 검사하기로 한 경계 ②. */
  it('사진 있는 단순 변심도 거절된다 — 뒤집을 것이 없는 주장에 증거를 받지 않는다', () => {
    expect(returnPhotoDecision('CHANGE_OF_MIND', [keyOf(OWNER, 1)], OWNER)).toEqual({
      outcome: 'refused',
      reason: 'photo_not_allowed',
    })
  })

  it('사진 없는 단순 변심은 통과한다', () => {
    expect(returnPhotoDecision('CHANGE_OF_MIND', [], OWNER)).toEqual({ outcome: 'allowed' })
  })

  it('사진 한 장짜리 하자 반품은 통과한다', () => {
    expect(returnPhotoDecision('DEFECTIVE', [keyOf(OWNER, 1)], OWNER)).toEqual({
      outcome: 'allowed',
    })
  })

  it(`상한 ${String(RETURN_PHOTO_MAX_COUNT)}장까지는 통과하고 한 장 더는 거절된다`, () => {
    const keys = Array.from({ length: RETURN_PHOTO_MAX_COUNT }, (_unused, index) =>
      keyOf(OWNER, index),
    )

    expect(returnPhotoDecision('DEFECTIVE', keys, OWNER)).toEqual({ outcome: 'allowed' })
    expect(
      returnPhotoDecision('DEFECTIVE', [...keys, keyOf(OWNER, RETURN_PHOTO_MAX_COUNT)], OWNER),
    ).toEqual({ outcome: 'refused', reason: 'too_many_photos' })
  })

  it('같은 사진을 두 번 보내면 거절된다', () => {
    const key = keyOf(OWNER, 1)

    expect(returnPhotoDecision('DEFECTIVE', [key, key], OWNER)).toEqual({
      outcome: 'refused',
      reason: 'duplicate_photo',
    })
  })

  it('남의 열쇠는 거절된다 — 열쇠 하나로 소유자를 말할 수 있어야 한다', () => {
    expect(returnPhotoDecision('DEFECTIVE', [keyOf(OTHER, 1)], OWNER)).toEqual({
      outcome: 'refused',
      reason: 'foreign_photo',
    })
  })

  it('모양이 아닌 열쇠도 같은 거절이다', () => {
    expect(returnPhotoDecision('DEFECTIVE', [`products/${OWNER}/a.jpg`], OWNER)).toEqual({
      outcome: 'refused',
      reason: 'foreign_photo',
    })
  })

  /**
   * **거절의 순서가 답의 우선순위다.** 단순 변심으로 상한을 넘겨 올린 사람에게
   * 「다섯 장까지입니다」라고 답하면 한 장을 빼고 다시 시도하게 되는데, 그가 할
   * 일은 전부 빼거나 사유를 고치는 것이다.
   */
  it('단순 변심에 여섯 장이면 「장수」가 아니라 「붙일 수 없다」로 답한다', () => {
    const keys = Array.from({ length: RETURN_PHOTO_MAX_COUNT + 1 }, (_unused, index) =>
      keyOf(OWNER, index),
    )

    expect(returnPhotoDecision('CHANGE_OF_MIND', keys, OWNER)).toEqual({
      outcome: 'refused',
      reason: 'photo_not_allowed',
    })
  })

  it('고칠 수 있는 거절을 고칠 수 없는 거절보다 먼저 말한다', () => {
    const tooMany = Array.from({ length: RETURN_PHOTO_MAX_COUNT + 1 }, (_unused, index) =>
      keyOf(OTHER, index),
    )

    expect(returnPhotoDecision('DEFECTIVE', tooMany, OWNER)).toEqual({
      outcome: 'refused',
      reason: 'too_many_photos',
    })
  })

  it('열쇠의 접두어가 사람이다 — 모양이 같아도 주인이 다르면 남의 것이다', () => {
    expect(isOwnPhotoKey(keyOf(OWNER, 1), OWNER)).toBe(true)
    expect(isOwnPhotoKey(keyOf(OWNER, 1), OTHER)).toBe(false)
    expect(isOwnPhotoKey(`returns/${OWNER}/not-a-uuid.jpg`, OWNER)).toBe(false)
  })
})

describe('4. 검수 — 합격일 때만 환불이다', () => {
  it('합격은 반품완료로 가고 환불을 부른다', () => {
    expect(returnInspectionOutcome(true)).toEqual({
      nextStatus: 'RETURN_COMPLETED',
      refunds: true,
      sendsBack: false,
    })
  })

  it('불합격은 거절로 가고 환불을 부르지 않는다 — 대신 반송이다', () => {
    expect(returnInspectionOutcome(false)).toEqual({
      nextStatus: 'RETURN_REJECTED',
      refunds: false,
      sendsBack: true,
    })
  })

  /**
   * 물건은 둘 중 하나로만 간다 — 판매자의 재고로 들어가거나 구매자에게 돌아가거나.
   * 둘이 같은 값이 되는 순간이 있으면 그 반품은 물건이 둘이거나 없다.
   */
  it.each([true, false])('환불과 반송은 언제나 반대다 (합격=%s)', (passed) => {
    const outcome = returnInspectionOutcome(passed)

    expect(outcome.refunds).toBe(!outcome.sendsBack)
  })

  it('두 결과 모두 실제로 있는 상태로 간다', () => {
    for (const passed of [true, false]) {
      expect(claimStatuses).toContain(returnInspectionOutcome(passed).nextStatus)
    }
  })
})

describe('5. 걸음의 자리', () => {
  it('취소 신청에는 반품의 걸음이 없다', () => {
    expect(
      returnStepDecision('CANCEL', 'CANCEL_REQUESTED', 'RETURN_APPROVED', 'PICKING_UP'),
    ).toEqual({ outcome: 'refused', reason: 'not_a_return' })
  })

  it('출발 상태에 서 있으면 걸을 수 있다', () => {
    expect(
      returnStepDecision('RETURN', 'RETURN_APPROVED', 'RETURN_APPROVED', 'PICKING_UP'),
    ).toEqual({ outcome: 'allowed' })
  })

  /**
   * **이미 걸은 걸음은 거절이 아니다.** 여기서 막으면 「운송장은 났는데 상태가 안
   * 옮겨진」 요청을 다시 이어붙일 방법이 없어진다.
   */
  it('이미 도착한 상태여도 걸을 수 있다 — 그것이 멱등의 방법이다', () => {
    expect(returnStepDecision('RETURN', 'PICKING_UP', 'RETURN_APPROVED', 'PICKING_UP')).toEqual({
      outcome: 'allowed',
    })
  })

  it('엉뚱한 자리에서는 거절된다', () => {
    expect(
      returnStepDecision('RETURN', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'PICKING_UP'),
    ).toEqual({ outcome: 'refused', reason: 'wrong_status' })
  })

  /** 검수의 두 갈래도 같은 자리에서만 열린다. */
  it('합격으로 끝난 반품에 불합격을 다시 찍을 수 없다', () => {
    expect(
      returnStepDecision('RETURN', 'RETURN_COMPLETED', 'INSPECTING', 'RETURN_REJECTED'),
    ).toEqual({ outcome: 'refused', reason: 'wrong_status' })
    expect(
      returnStepDecision('RETURN', 'RETURN_COMPLETED', 'INSPECTING', 'RETURN_COMPLETED'),
    ).toEqual({ outcome: 'allowed' })
  })
})

describe('6. 표에 빈 칸이 없다', () => {
  /**
   * 사유가 하나 늘고 이 파일들을 안 고치면 **컴파일이 멈춘다**(전부 `Record` 다).
   * 그래도 여기서 한 번 더 세는 이유는, 컴파일이 잡아 주는 것은 「칸이 있는가」이지
   * 「그 칸이 답인가」가 아니기 때문이다.
   */
  it('세 사유 전부가 사진 규칙을 갖는다', () => {
    const answered = returnReasons.filter((reason: ReturnReason) =>
      [true, false].includes(returnPhotosRequired(reason)),
    )

    expect(answered).toHaveLength(returnReasons.length)
  })
})

describe('7. 이 반품으로 판매자 몫이 끝나는가 (TASK-0071)', () => {
  /** 목록을 「주문 수량 / 반품 확정 수량」 쌍으로 짧게 적는다. */
  function lines(...pairs: readonly (readonly [number, number])[]): readonly ReturnLine[] {
    return pairs.map(([ordered, returned]) => ({ ordered, returned }))
  }

  it('is full when nothing is left on any line', () => {
    expect(returnScopeOf(lines([2, 2], [1, 1]))).toBe('FULL')
  })

  it('is partial while one unit of one line is still there', () => {
    expect(returnScopeOf(lines([2, 2], [1, 0]))).toBe('PARTIAL')
    expect(returnScopeOf(lines([2, 1]))).toBe('PARTIAL')
  })

  /**
   * **「전체」는 한 신청의 크기가 아니라 그 뒤에 남은 것의 크기다.**
   *
   * 세 개를 하나씩 세 번 나눠 반품하면 어느 신청도 전체가 아니지만, 세 번째가
   * 마지막 한 개를 데려가면서 답이 바뀌어야 한다. 안 바뀌면 **돌려받을 물건이 하나도
   * 없는 주문이 「배송완료」로 영원히 앉아 있고, 아무것도 실패하지 않는다.**
   */
  it('turns full on the last unit of a return split three ways', () => {
    expect(returnScopeOf(lines([3, 1]))).toBe('PARTIAL')
    expect(returnScopeOf(lines([3, 2]))).toBe('PARTIAL')
    expect(returnScopeOf(lines([3, 3]))).toBe('FULL')
  })

  /**
   * **세는 자리가 취소보다 뒤다.** 승인만 받고 물건을 안 보낸 반품이 주문을 닫으면
   * 판매자는 받지도 못한 물건 값을 잃고, `RETURNED` 에서 돌아오는 화살표는 없다.
   */
  it('counts a return only once the goods have passed inspection', () => {
    expect(returnSettledStatuses).toEqual(['RETURN_COMPLETED', 'REFUNDED'])
  })

  /** 상태가 하나 늘면 레코드가 컴파일로 막는다. 그 사실을 목록으로도 확인한다. */
  it('has an answer for every claim status', () => {
    expect(Object.keys(RETURN_SETTLED).toSorted()).toEqual([...claimStatuses].toSorted())
  })
})
