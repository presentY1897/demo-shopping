import { describe, expect, it } from 'vitest'

import { stockDirections } from '../stock/stock-ledger.js'
import { claimStatuses, claimTransitions, claimTypes } from './claim-rules.js'
import type { RestockCandidate } from './restock-plan.js'
import { RESTOCK_STATUSES, RESTOCK_TYPE, restockDecision, restockDue } from './restock-plan.js'

/**
 * 재고 복원의 순수 판단, 남김없이 (TASK-0069 6.2 — Q5 강화, 분기 100%).
 *
 * 재는 것이 셋이다. **어느 자리에서 되돌리는가**(1절), **어느 원장 유형으로
 * 적는가**(2절), **이 줄을 되돌리는가**(3절).
 *
 * 1절이 이 파일의 값이다. 나머지 둘은 원장을 열어 보면 티가 나지만, 자리 판단은
 * 두 방향으로 조용히 틀린다 — 한 칸 넓으면 **검수에서 떨어진 반품이 재입고되고**
 * (물건은 구매자에게 반송된다), 한 칸 좁으면 정상 흐름에서 재고가 **영영** 돌아오지
 * 않는다. 둘 다 아무것도 실패시키지 않는다.
 */

/** 되돌릴 줄 하나. 판단이 보지 않는 값은 아무래도 좋으므로 고정해 둔다. */
function candidate(overrides: Partial<RestockCandidate> = {}): RestockCandidate {
  return {
    claimItemId: '00000000-0000-7000-8000-000000000001',
    variantId: '00000000-0000-7000-8000-000000000002',
    quantity: 2,
    variantDeleted: false,
    recorded: false,
    ...overrides,
  }
}

describe('1. 물건이 우리 손에 있는 자리', () => {
  it('restores a cancel once it is approved, and a return once it passes inspection', () => {
    expect(restockDue('CANCEL', 'CANCEL_APPROVED')).toBe(true)
    expect(restockDue('RETURN', 'RETURN_COMPLETED')).toBe(true)
  })

  /**
   * **검수 불합격은 아무것도 되돌리지 않는다** (F3).
   *
   * 이 TASK 가 막아야 할 유일한 「거짓 재입고」이고, 그것이 검수 단계를 만든
   * 이유다 (TASK-0067 4장).
   */
  it('never restores a rejected return, nor a rejected cancel', () => {
    expect(restockDue('RETURN', 'RETURN_REJECTED')).toBe(false)
    expect(restockDue('CANCEL', 'CANCEL_REJECTED')).toBe(false)
  })

  /**
   * **`REFUNDED` 가 실제로 오는 자리다.**
   *
   * 부르는 쪽이 환불을 먼저 부르므로(`claim.service.ts` 의 `publishCancel`) 재고
   * 차례가 됐을 때 클레임은 이미 `REFUNDED` 다. 이 칸이 비면 정상 흐름 전체가
   * 조용히 아무것도 되돌리지 않는다.
   */
  it('still restores after the refund has moved the claim to REFUNDED', () => {
    expect(restockDue('CANCEL', 'REFUNDED')).toBe(true)
    expect(restockDue('RETURN', 'REFUNDED')).toBe(true)
  })

  /**
   * 경로를 섞지 않는다 — 취소가 반품의 자리에서, 반품이 취소의 자리에서 되돌아오지
   * 않는다. 실제로는 전이표가 그 상태 조합 자체를 만들지 않지만, 표가 그것에
   * 기대고 있지 않다는 사실이 이 단언의 값이다.
   */
  it('does not let one route restore at the other route’s place', () => {
    expect(restockDue('RETURN', 'CANCEL_APPROVED')).toBe(false)
    expect(restockDue('CANCEL', 'RETURN_COMPLETED')).toBe(false)
  })

  /**
   * **되돌리는 자리는 셋뿐이다.** 상태가 하나 늘면 이 단언이 그것을 잡는다 —
   * 레코드가 총(total)이라 컴파일도 깨지지만, 새 상태를 빈 배열로 적어 두고 지나가는
   * 것까지는 컴파일러가 막지 못한다.
   */
  it('names exactly three places, and no others', () => {
    const places = claimStatuses.filter((status) => RESTOCK_STATUSES[status].length > 0)

    expect(places).toEqual(['CANCEL_APPROVED', 'RETURN_COMPLETED', 'REFUNDED'])
  })

  /**
   * **불합격한 반품은 `REFUNDED` 에 닿을 수 없다.**
   *
   * `REFUNDED` 에 `RETURN` 을 실어 두는 것이 안전한 이유가 이 사실 하나에 걸려
   * 있다. 전이표에 `RETURN_REJECTED` 를 떠나는 화살표가 생기는 날 이 단언이
   * 빨개지고, 그때 위의 표를 다시 봐야 한다.
   */
  it('rests on RETURN_REJECTED being terminal', () => {
    expect(claimTransitions.RETURN_REJECTED).toEqual([])
    expect(claimTransitions.CANCEL_REJECTED).toEqual([])
  })
})

describe('2. 어느 원장 유형으로 적는가', () => {
  it('writes CANCEL for a cancel and RETURN_IN for a return', () => {
    expect(RESTOCK_TYPE).toEqual({ CANCEL: 'CANCEL', RETURN: 'RETURN_IN' })
  })

  /**
   * 둘 다 **들어오는** 방향이다.
   *
   * 부호는 유형이 정하고 `StockLedger_direction_check` 가 강제한다. 이 표가
   * `out` 인 유형을 가리키게 되는 날, 복원은 400 이 아니라 **재고를 더 깎는
   * 성공**으로 끝난다 — 실행기가 수량을 그대로 양수로 넘기기 때문이다.
   */
  it('points only at movement types that add stock', () => {
    for (const type of claimTypes) {
      expect(stockDirections[RESTOCK_TYPE[type]]).toBe('in')
    }
  })
})

describe('3. 이 줄을 되돌리는가', () => {
  it('restores a line nothing has recorded yet', () => {
    expect(restockDecision(candidate())).toBe('restock')
  })

  it('skips a line the ledger already holds', () => {
    expect(restockDecision(candidate({ recorded: true }))).toBe('already_recorded')
  })

  it('skips a line whose combination has been removed', () => {
    expect(restockDecision(candidate({ variantDeleted: true }))).toBe('variant_deleted')
  })

  /**
   * **이미 적힌 쪽이 먼저다.**
   *
   * 되돌린 **뒤에** 상품이 사라지는 것이 정상 순서다(데모 판매자 만료). 순서가
   * 뒤집히면 이미 끝난 일에 대해 「사라져서 못 했다」는 경고가 나가고, 그것을 읽은
   * 사람은 없는 재고를 찾아다닌다.
   */
  it('calls a recorded line recorded even after its combination is gone', () => {
    expect(restockDecision(candidate({ recorded: true, variantDeleted: true }))).toBe(
      'already_recorded',
    )
  })
})
