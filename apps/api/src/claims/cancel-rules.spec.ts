import { orderStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { sellerOrderTransitions } from '../orders/seller-order-transitions.js'
import type { CancelLine } from './cancel-rules.js'
import {
  CANCEL_SETTLED,
  cancelApprovalFor,
  cancelScopeOf,
  cancelSettledStatuses,
} from './cancel-rules.js'
import { claimStatuses, claimTransitions } from './claim-rules.js'

/**
 * 취소의 순수 판단, 남김없이 (TASK-0066 6.2 — Q5 강화, 분기 100%).
 *
 * 재는 것이 넷이다. **누가 승인하는가가 주문 상태로 갈리는가**(1절), **「전체」의
 * 정의가 잔여이고 그 경계가 마지막 한 개인가**(2절), **무엇을 확정된 취소로
 * 세는가**(3절), **주문 쪽 이력에 무엇이 적히는가**(4절).
 *
 * 2절이 이 파일의 값이다. 나머지 셋은 틀리면 화면이나 이력에서 티가 나지만, 전체와
 * 부분을 가르는 규칙은 **부분 취소를 여러 번 한 사람에게만** 틀린 답을 주고 그때
 * 실패하는 것은 아무것도 없다.
 */

/** 목록을 「주문 수량 / 취소 확정 수량」 쌍으로 짧게 적는다. */
function lines(...pairs: readonly (readonly [number, number])[]): readonly CancelLine[] {
  return pairs.map(([ordered, canceled]) => ({ canceled, ordered }))
}

describe('1. 누가 승인하는가', () => {
  it('approves a paid order by itself and leaves a preparing one to the seller', () => {
    expect(cancelApprovalFor('PAID')).toEqual({ actor: 'SYSTEM', mode: 'AUTO' })
    expect(cancelApprovalFor('PREPARING')).toEqual({ mode: 'REVIEW' })
  })

  /**
   * `PAID` **하나만** 자동이다.
   *
   * 목록을 다 도는 이유는 이 함수가 「어느 상태가 취소를 여는가」를 답하지 않기
   * 때문이다 (그 표는 `claimRouteFor` 의 것이다). 여기서 확인할 것은 자동 승인이
   * 새지 않는다는 사실 하나이고, 상태가 하나 늘면 이 단언이 그것을 잡는다.
   */
  it('never approves itself in any other state', () => {
    const automatic = orderStatuses.filter((status) => cancelApprovalFor(status).mode === 'AUTO')

    expect(automatic).toEqual(['PAID'])
  })

  /** 자동 승인의 주체는 사람이 아니다 — 전이표가 그 자리에 `SYSTEM` 을 열어 뒀다. */
  it('names SYSTEM as the actor the transition table opened for it', () => {
    const approval = cancelApprovalFor('PAID')
    const rule = claimTransitions.CANCEL_REQUESTED.find((entry) => entry.to === 'CANCEL_APPROVED')

    expect(approval.mode === 'AUTO' && rule?.actors.includes(approval.actor)).toBe(true)
  })
})

describe('2. 「전체」는 남은 잔여가 0 이라는 뜻이다', () => {
  it('is full when every line is fully canceled', () => {
    expect(cancelScopeOf(lines([1, 1], [2, 2], [3, 3]))).toBe('FULL')
  })

  it('is partial while one line still has an uncanceled unit', () => {
    expect(cancelScopeOf(lines([1, 1], [2, 2], [3, 2]))).toBe('PARTIAL')
  })

  it('is partial when a whole line was never touched', () => {
    expect(cancelScopeOf(lines([1, 1], [2, 0]))).toBe('PARTIAL')
  })

  /**
   * **경계다.** 세 개짜리 한 줄을 하나씩 세 번 취소하면 앞의 둘은 부분이고 마지막
   * 하나가 전체가 된다 — 「전체 취소」는 한 신청의 크기가 아니라 그 뒤에 남은 것의
   * 크기라는 것이 이 세 줄이다. 항목 수나 이번 신청의 수량 합으로 정의했다면 셋 다
   * 부분이고, 보낼 물건이 없는 주문이 준비중으로 남는다.
   */
  it('turns full exactly at the last unit', () => {
    expect(cancelScopeOf(lines([3, 1]))).toBe('PARTIAL')
    expect(cancelScopeOf(lines([3, 2]))).toBe('PARTIAL')
    expect(cancelScopeOf(lines([3, 3]))).toBe('FULL')
  })

  /**
   * 세어진 수량이 주문 수량을 **넘어도** 전체다.
   *
   * 넘는 일이 있어서가 아니라 — `OrderItem_claimedQuantity_check` 이 막는다 —
   * 등호로만 비교하면 그 불변식이 깨진 날 답이 「부분」이 되기 때문이다. 그때
   * 주문은 아무것도 남지 않은 채 열려 있고, 그것이 두 결함 중 나쁜 쪽이다.
   */
  it('does not read a broken invariant as "something is left"', () => {
    expect(cancelScopeOf(lines([2, 3]))).toBe('FULL')
  })
})

describe('3. 무엇을 확정된 취소로 세는가', () => {
  it('counts an approved cancel and a refunded one, and nothing else', () => {
    expect(cancelSettledStatuses).toEqual(['CANCEL_APPROVED', 'REFUNDED'])
  })

  /** 신청만 한 것은 아직 아니다 — 거절되면 그 수량은 되살아난다. */
  it('does not count a claim that is still waiting for a judgement', () => {
    expect(CANCEL_SETTLED.CANCEL_REQUESTED).toBe(false)
  })

  it('does not count a rejected one', () => {
    expect(CANCEL_SETTLED.CANCEL_REJECTED).toBe(false)
  })

  /** 반품은 취소가 아니다. 목록이 반품 상태를 하나라도 세면 그 몫이 취소로 닫힌다. */
  it('counts no state that belongs only to the return path', () => {
    const returns = claimStatuses.filter((status) => status.startsWith('RETURN_'))

    expect(returns.filter((status) => CANCEL_SETTLED[status])).toEqual([])
  })

  /** 상태가 하나 늘면 레코드가 컴파일로 막는다. 그 사실을 목록으로도 확인한다. */
  it('has an answer for every claim status', () => {
    expect(Object.keys(CANCEL_SETTLED).toSorted()).toEqual([...claimStatuses].toSorted())
  })
})

describe('4. 승인자가 주문 전이표를 지난다', () => {
  /**
   * **승인할 수 있는 주체 전부가 주문 전이표를 지난다.**
   *
   * 두 표를 실제로 읽어 잇는 것이 요점이다 — 어느 한쪽이 바뀌는 날 이 단언이
   * 그것을 잡는다. 지나지 못하는 주체가 하나 생기면 그 요청은 런타임에
   * `actor_forbidden` 으로 끝나고, 그 실패는 전체 취소를 눌러 본 사람만 본다.
   *
   * **전에는 여기 접는 함수가 있었다.** 주문 전이표가 `SYSTEM` 을 열지 않아
   * 자동 승인을 `SELLER` 로 적었고, 그것은 이력에 「판매자가 취소했다」는 거짓을
   * 남기는 모양이었다. 표가 그 주체를 받아들이면서 함수가 사라졌다 (TASK-0066).
   *
   * `BUYER` 를 넣어 보지 않는 이유는 그것이 **승인자가 될 수 없기** 때문이다 —
   * 클레임 전이표의 어느 화살표에도 `BUYER` 가 없다. 닿을 수 없는 입력에 답을
   * 요구하면 그 답을 지키는 코드가 생기고, 그것은 아무도 지나지 않는 분기다.
   */
  it('never produces an actor the order table refuses', () => {
    const approvers =
      claimTransitions.CANCEL_REQUESTED.find((rule) => rule.to === 'CANCEL_APPROVED')?.actors ?? []
    const refused = approvers.filter((actor) =>
      (['PAID', 'PREPARING'] as const).some(
        (status) =>
          !sellerOrderTransitions[status]
            .find((rule) => rule.to === 'CANCELED')
            ?.actors.includes(actor),
      ),
    )

    expect({ approvers: [...approvers], refused }).toEqual({
      approvers: ['SELLER', 'ADMIN', 'SYSTEM'],
      refused: [],
    })
  })
})
