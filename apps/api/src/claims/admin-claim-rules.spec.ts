import { orderStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { sellerOrderTransitions } from '../orders/seller-order-transitions.js'
import {
  adminClaimEligibility,
  adminClaimRouteFor,
  adminOverdueScanBefore,
  canOverturn,
  CLAIM_OVERTURNABLE,
} from './admin-claim-rules.js'
import { claimDueAt } from './claim-deadline.js'
import type { ClaimRequestCheck } from './claim-rules.js'
import { claimEligibility, claimRouteFor, claimStatuses, claimTransitions } from './claim-rules.js'

/**
 * 관리자 개입의 순수 판단, 남김없이 (TASK-0071 6.2 — Q5 강화, 분기 100%).
 *
 * 재는 것이 넷이다. **관리자에게만 열리는 칸이 정확히 하나인가**(1절), **구매자의
 * 판정과 어디서 갈리고 어디서 같은가**(2절), **무엇을 뒤집을 수 있는가**(3절),
 * **지연 컷오프가 놓치는 건이 없는가**(4절).
 *
 * 4절이 이 파일의 값이다. 나머지 셋은 틀리면 요청이 거절되거나 통과해 티가 나지만,
 * 컷오프가 한 칸 늦으면 **지연된 건이 목록에서 조용히 사라진다** — 그 목록은 밀린
 * 것을 보라고 만든 것이라, 비어 있는 것과 없는 것이 화면에서 같아 보인다.
 */

/** 판정 입력의 나머지 칸들. 관리자 판정이 읽지 않는 셋이라 값은 아무 것이나 좋다. */
function check(partial: Partial<ClaimRequestCheck>): ClaimRequestCheck {
  return {
    orderStatus: 'DELIVERED',
    deliveredAt: new Date('2026-09-01T00:00:00.000Z'),
    now: new Date('2026-09-03T00:00:00.000Z'),
    windowMs: 7 * 24 * 60 * 60 * 1_000,
    requested: 1,
    remaining: 1,
    ...partial,
  }
}

describe('1. 관리자에게 열리는 칸은 `CONFIRMED` 하나다', () => {
  it('opens a return on a confirmed order, which the buyer cannot', () => {
    expect(adminClaimRouteFor('CONFIRMED')).toBe('RETURN')
    expect(claimRouteFor('CONFIRMED')).toBeNull()
  })

  /**
   * **나머지 여덟 칸은 글자 그대로 같다.**
   *
   * 표를 옮겨 적지 않았다는 유일한 증거다 (`adminClaimRouteFor` 가 `claimRouteFor` 를
   * 부른다). 옮겨 적었다면 그날 한쪽만 고쳐지고, 증상은 「관리자만 다른 경로를 여는
   * 주문 상태」 하나다.
   */
  it('answers exactly like the buyer table everywhere else', () => {
    const different = orderStatuses.filter(
      (status) => adminClaimRouteFor(status) !== claimRouteFor(status),
    )

    expect(different).toEqual(['CONFIRMED'])
  })

  /** 배송 중에는 관리자에게도 길이 없다 — 권한이 아니라 물건이 어디 있는가의 문제다. */
  it('still refuses a shipped order, because that is about where the goods are', () => {
    expect(adminClaimRouteFor('SHIPPED')).toBeNull()
  })
})

describe('2. 구매자의 판정과 어디서 갈리는가', () => {
  it('allows a defect return on a confirmed order', () => {
    expect(adminClaimEligibility(check({ orderStatus: 'CONFIRMED' }))).toEqual({
      outcome: 'allowed',
      type: 'RETURN',
    })
    expect(claimEligibility(check({ orderStatus: 'CONFIRMED' }))).toEqual({
      outcome: 'refused',
      reason: 'confirmed',
      remaining: 1,
    })
  })

  /**
   * **기간을 보지 않는다.**
   *
   * 이의 제기와 검토가 반품 기간보다 오래 걸리는 것이 정상이고, 기간으로 막으면
   * 뒤집을 수 있는 거절이 시간이 지나 뒤집을 수 없게 된다.
   */
  it('ignores the return window the buyer is held to', () => {
    const late = check({ now: new Date('2026-10-01T00:00:00.000Z') })

    expect(adminClaimEligibility(late)).toEqual({ outcome: 'allowed', type: 'RETURN' })
    expect(claimEligibility(late)).toEqual({
      outcome: 'refused',
      reason: 'window_closed',
      remaining: 1,
    })
  })

  it('refuses a shipped order first, before it looks at the quantity', () => {
    expect(adminClaimEligibility(check({ orderStatus: 'SHIPPED', requested: 0 }))).toEqual({
      outcome: 'refused',
      reason: 'in_transit',
      remaining: 1,
    })
  })

  it('refuses a state that has no claim at all', () => {
    expect(adminClaimEligibility(check({ orderStatus: 'CANCELED' }))).toEqual({
      outcome: 'refused',
      reason: 'not_claimable',
      remaining: 1,
    })
  })

  it('refuses nothing and refuses too much, in that order', () => {
    expect(adminClaimEligibility(check({ requested: 0 }))).toEqual({
      outcome: 'refused',
      reason: 'invalid_quantity',
      remaining: 1,
    })
    expect(adminClaimEligibility(check({ requested: 3, remaining: 2 }))).toEqual({
      outcome: 'refused',
      reason: 'exceeds_remaining',
      remaining: 2,
    })
  })

  it('allows a cancel while the order has not left', () => {
    expect(adminClaimEligibility(check({ orderStatus: 'PAID' }))).toEqual({
      outcome: 'allowed',
      type: 'CANCEL',
    })
  })

  /**
   * **확정된 주문의 반품을 끝낼 수 있는 주체가 실제로 있는가.**
   *
   * 두 표를 읽어 잇는 것이 요점이다 — 클레임을 열어 두고 주문 전이표가 그 주체를
   * 막으면, 그 반품은 검수까지 걸어간 뒤 마지막 한 걸음에서 멈춘다. 그때 사람이 볼
   * 것은 「지금 상태에서는 할 수 없다」이고, 무엇이 잘못됐는지는 아무 데도 안 적힌다.
   */
  it('leaves a way to finish the confirmed return it just opened', () => {
    const finishers =
      claimTransitions.INSPECTING.find((rule) => rule.to === 'RETURN_COMPLETED')?.actors ?? []
    const allowed = finishers.filter((actor) =>
      sellerOrderTransitions.CONFIRMED.find((rule) => rule.to === 'RETURNED')?.actors.includes(
        actor,
      ),
    )

    expect(allowed).toEqual(['ADMIN'])
  })

  /**
   * 관리자가 반품을 **혼자 끝까지 밀 수 있다.**
   *
   * 뒤집힌 판매자에게 「수거를 눌러라」를 요구할 수 없고, 확정 후 하자 반품에는
   * 애초에 판매자의 걸음이 없다. 한 칸이라도 `ADMIN` 이 빠지면 관리자가 만든 반품만
   * 중간에서 멈춘다.
   */
  it('lets the administrator walk every step of the return alone', () => {
    const path = [
      ['RETURN_REQUESTED', 'RETURN_APPROVED'],
      ['RETURN_APPROVED', 'PICKING_UP'],
      ['PICKING_UP', 'INSPECTING'],
      ['INSPECTING', 'RETURN_COMPLETED'],
    ] as const
    const blocked = path.filter(
      ([from, to]) =>
        !claimTransitions[from].find((rule) => rule.to === to)?.actors.includes('ADMIN'),
    )

    expect(blocked).toEqual([])
  })
})

describe('3. 무엇을 뒤집을 수 있는가', () => {
  it('overturns the two conclusions a seller reaches, and nothing else', () => {
    expect(claimStatuses.filter((status) => canOverturn(status))).toEqual([
      'CANCEL_REJECTED',
      'RETURN_REJECTED',
    ])
  })

  /**
   * **뒤집을 수 있는 것은 전이표의 종착 중 환불이 아닌 것**이다.
   *
   * 목록을 손으로 적은 표와 전이표를 나란히 두어 어느 쪽이 틀려도 빨개지게 한다 —
   * 진행 중인 상태가 하나 새어 들어오면 관리자가 「아직 아무도 판단하지 않은 신청」을
   * 뒤집게 되고, 그때 원본은 살아 있는 채로 수량을 잡고 있다.
   */
  it('agrees with the transition table about which states are conclusions', () => {
    const terminal = claimStatuses.filter((status) => claimTransitions[status].length === 0)

    expect(terminal).toEqual(['CANCEL_REJECTED', 'RETURN_REJECTED', 'REFUNDED'])
    expect(terminal.filter((status) => !canOverturn(status))).toEqual(['REFUNDED'])
  })

  /** 상태가 하나 늘면 레코드가 컴파일로 막는다. 그 사실을 목록으로도 확인한다. */
  it('has an answer for every claim status', () => {
    expect(Object.keys(CLAIM_OVERTURNABLE).toSorted()).toEqual([...claimStatuses].toSorted())
  })
})

describe('4. 지연 컷오프는 놓치는 건이 없다', () => {
  const now = new Date('2026-09-16T05:00:00.000Z')

  it('scans back two days in the realistic pace and ten minutes in the demo one', () => {
    expect(now.getTime() - adminOverdueScanBefore(now, 'realistic').getTime()).toBe(
      2 * 24 * 60 * 60 * 1_000,
    )
    expect(now.getTime() - adminOverdueScanBefore(now, 'demo').getTime()).toBe(10 * 60_000)
  })

  /**
   * **거짓 음성이 0 이라는 것이 이 컷오프의 전부다.**
   *
   * 한 해의 매 시각마다 「기한을 넘겼는데 컷오프보다 나중에 신청된」 건이 있는지
   * 센다. 하나라도 있으면 그 건은 지연 목록에서 **조용히 사라지고**, 화면은 밀린 것이
   * 없다고 말한다. 부등식을 주석으로만 적어 두면 영업일 정의가 바뀌는 날 그것이
   * 거짓이 되는 것을 아무도 못 본다.
   *
   * 컷보다 나중인데 아직 기한 안인 건(거짓 양성)은 섞여 들어와도 된다 — 서비스가
   * `isClaimOverdue` 로 다시 거르기 때문이고, 그것이 「넘치게 읽고 정확히 거른다」의
   * 뒷부분이다.
   */
  it('never leaves an overdue claim behind, at any hour of the year', () => {
    const HOUR = 60 * 60 * 1_000
    const missed: string[] = []

    for (let hour = 0; hour < 365 * 24; hour += 1) {
      const requestedAt = new Date(Date.parse('2026-01-01T00:00:00.000Z') + hour * HOUR)
      const at = new Date(requestedAt.getTime() + 30 * 24 * HOUR)
      const overdue = at.getTime() > claimDueAt(requestedAt, 'realistic').getTime()

      if (overdue && requestedAt >= adminOverdueScanBefore(at, 'realistic')) {
        missed.push(requestedAt.toISOString())
      }
    }

    expect(missed).toEqual([])
  })

  /** 압축 모드에서도 같다 — 기한이 정확히 10분이라 컷오프도 정확히 10분이다. */
  it('holds in the compressed pace too', () => {
    const requestedAt = new Date('2026-09-16T04:49:59.999Z')

    expect(now.getTime() > claimDueAt(requestedAt, 'demo').getTime()).toBe(true)
    expect(requestedAt < adminOverdueScanBefore(now, 'demo')).toBe(true)
  })
})
