import type { ClaimAction, ClaimHandlingStage } from '@shopping/shared'
import { claimHandlingStages, claimStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  commandFor,
  inspectionPassed,
  reasonFieldOf,
  SELLER_CLAIM_TABS,
  stageOf,
  tabCountOf,
} from '@/lib/claims/claim-console'
import { EMPTY_CLAIM_FILTERS, queryOf } from '@/lib/claims/use-seller-claims'
import { sellerClaimSearch } from '@/lib/claims/console-api'

/**
 * 클레임 화면의 순수 판단 (TASK-0070).
 *
 * 렌더하지 않고 잰다. 여기 있는 것들은 전부 **틀려도 화면이 멀쩡해 보이는** 종류라,
 * 상호작용 검사가 아니라 입력 → 출력으로 재는 편이 촘촘하다 — 특히 액션의 문은 틀려도
 * 요청이 성공한다.
 */

const ZERO_STAGES = Object.fromEntries(claimHandlingStages.map((stage) => [stage, 0])) as Record<
  ClaimHandlingStage,
  number
>

/** 서버가 답하는 걸음 하나를 손으로 만든다. */
function action(over: Partial<ClaimAction>): ClaimAction {
  return { to: 'CANCEL_APPROVED', route: 'transition', requiresReason: false, ...over }
}

describe('단계 탭', () => {
  it('has 전체 mean 「단계를 보내지 않는다」', () => {
    // 빈 값을 보내면 서버는 그것을 단계 하나로 파싱하려 하고, 그때 목록은 0건이 된다.
    expect(stageOf('all')).toBeNull()
  })

  it('names only stages the contract knows', () => {
    for (const tab of SELLER_CLAIM_TABS) {
      const stage = stageOf(tab)

      if (stage !== null) expect(claimHandlingStages).toContain(stage)
    }
  })

  it('covers every stage — a tab nobody can reach is a stage nobody can find', () => {
    const covered = SELLER_CLAIM_TABS.map(stageOf).filter((stage) => stage !== null)

    expect(new Set(covered)).toEqual(new Set(claimHandlingStages))
  })

  it('counts 전체 as every stage', () => {
    const stages = { ...ZERO_STAGES, WAITING: 3, IN_PROGRESS: 2, CLOSED: 1 }

    expect(tabCountOf('all', stages)).toBe(6)
  })

  it('counts a single-stage tab as that stage alone', () => {
    expect(tabCountOf('waiting', { ...ZERO_STAGES, WAITING: 3, CLOSED: 9 })).toBe(3)
  })
})

describe('사유를 받는 칸 (5장)', () => {
  it('asks for nothing when the server did not', () => {
    expect(reasonFieldOf(action({ requiresReason: false }))).toBeNull()
  })

  it('puts a 전이 거절 사유 in `reason`', () => {
    expect(
      reasonFieldOf(action({ to: 'CANCEL_REJECTED', route: 'transition', requiresReason: true })),
    ).toBe('reason')
  })

  /**
   * **검수 불합격의 사유는 다른 칸이다.**
   *
   * 같은 「거절 사유」이지만 실리는 문이 다르다 — `InspectReturnRequest.note` 다. 두
   * 칸을 하나로 접으면 제출 직전에 어느 쪽인지 다시 판단해야 하고, 그 판단이 틀리면
   * 판매자가 적은 사유는 서버가 무시한 채 요청이 **성공한다.**
   */
  it('puts a 검수 불합격 사유 in `note`', () => {
    expect(
      reasonFieldOf(action({ to: 'RETURN_REJECTED', route: 'inspection', requiresReason: true })),
    ).toBe('note')
  })
})

describe('걸음이 두드리는 문', () => {
  it('reads 합격 out of the destination, never out of a separate flag', () => {
    // 화면이 합격 여부를 따로 들고 있으면 「합격 버튼을 눌렀는데 passed: false」가
    // 표현 가능해진다.
    expect(inspectionPassed('RETURN_COMPLETED')).toBe(true)
    expect(inspectionPassed('RETURN_REJECTED')).toBe(false)
  })

  it('sends 수거 through the pickup door with no body at all', () => {
    // 전이 라우트로 밀면 상태만 옮겨지고 회수 운송장은 나지 않는다. 그러면 구매자는
    // 어디에 물건을 맡길지 모른 채 「회수 중」 화면을 본다.
    expect(
      commandFor(action({ to: 'PICKING_UP', route: 'pickup' }), { reason: '적어 둔 것' }),
    ).toEqual({ route: 'pickup' })
  })

  it('sends 검수 합격 through the inspection door', () => {
    expect(commandFor(action({ to: 'RETURN_COMPLETED', route: 'inspection' }))).toEqual({
      route: 'inspection',
      passed: true,
      note: null,
    })
  })

  it('sends 검수 불합격 through the same door, with the note', () => {
    expect(
      commandFor(action({ to: 'RETURN_REJECTED', route: 'inspection', requiresReason: true }), {
        reason: '포장이 훼손됨',
      }),
    ).toEqual({ route: 'inspection', passed: false, note: '포장이 훼손됨' })
  })

  it('sends 승인 through the transition door', () => {
    expect(commandFor(action({ to: 'RETURN_APPROVED' }))).toEqual({
      route: 'transition',
      to: 'RETURN_APPROVED',
      reason: null,
    })
  })

  it('leaves a blank reason out rather than sending an empty one', () => {
    // 빈 문자열을 보내면 그 행은 사유가 있는 것도 없는 것도 아닌 채로 남는다.
    expect(commandFor(action({ to: 'CANCEL_REJECTED' }), { reason: '   ' })).toEqual({
      route: 'transition',
      to: 'CANCEL_REJECTED',
      reason: null,
    })
  })

  it('trims what the seller typed', () => {
    expect(commandFor(action({ to: 'CANCEL_REJECTED' }), { reason: ' 재고 소진 ' })).toEqual({
      route: 'transition',
      to: 'CANCEL_REJECTED',
      reason: '재고 소진',
    })
  })
})

describe('필터를 질의로', () => {
  it('leaves every filter out when nothing is set', () => {
    expect(queryOf(EMPTY_CLAIM_FILTERS)).toEqual({})
  })

  it('sends the tab as a stage and the two axes beside it', () => {
    expect(queryOf({ tab: 'waiting', type: 'RETURN', status: 'RETURN_REQUESTED' })).toEqual({
      stage: 'WAITING',
      type: 'RETURN',
      status: ['RETURN_REQUESTED'],
    })
  })

  it('names only statuses the contract knows', () => {
    for (const status of claimStatuses) {
      expect(queryOf({ ...EMPTY_CLAIM_FILTERS, status })).toEqual({ status: [status] })
    }
  })
})

describe('질의 문자열', () => {
  it('is empty when there is nothing to ask', () => {
    expect(sellerClaimSearch({})).toBe('')
  })

  it('joins statuses with one comma — the syntax every list in this repo uses', () => {
    // 반복 키(`?status=a&status=b`)는 프레임워크마다 다른 것으로 파싱된다.
    expect(sellerClaimSearch({ status: ['CANCEL_REQUESTED', 'RETURN_REQUESTED'] })).toBe(
      '?status=CANCEL_REQUESTED%2CRETURN_REQUESTED',
    )
  })

  it('hands the cursor back untouched — it is opaque', () => {
    // 해석하면 「순위를 0으로 바꿔 보는」 요청이 생기고, 서버가 그것을 막을 검사를 하나
    // 더 갖게 된다.
    expect(sellerClaimSearch({ cursor: 'MC4wMTkzMDAwMA' })).toBe('?cursor=MC4wMTkzMDAwMA')
  })
})
