import { claimStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  claimActionRouteOf,
  claimHandlingStage,
  claimStageRank,
  claimStatusesInStage,
  claimTransitionNeedsReason,
  decodeSellerClaimCursor,
  encodeSellerClaimCursor,
} from './claim-console.js'
import { claimTransitions } from './claim-rules.js'

/** 판매자 콘솔의 순수 판단 (TASK-0070 · Q5 강화 — **분기 커버리지 100%**). */

const CLAIM_ID = '01930000-0000-7000-8000-000000000001'

describe('처리 단계', () => {
  it('derives the stage from the transition table instead of a second list', () => {
    // 이 단언이 지키는 것: 상태를 하나 더하고 여기를 안 고쳐도 답이 저절로 맞는다.
    // 표를 한 벌 더 두면 그때 「처리할 것이 없는데 3건 대기」가 조용히 생긴다.
    for (const status of claimStatuses) {
      const rules = claimTransitions[status]
      const expected =
        rules.length === 0
          ? 'CLOSED'
          : rules.some((rule) => rule.actors.includes('SELLER'))
            ? 'WAITING'
            : 'IN_PROGRESS'

      expect(claimHandlingStage(status)).toBe(expected)
    }
  })

  it('puts every step the seller has to take into WAITING', () => {
    expect([...claimStatusesInStage('WAITING')]).toEqual([
      'CANCEL_REQUESTED',
      'RETURN_REQUESTED',
      'RETURN_APPROVED',
      'PICKING_UP',
      'INSPECTING',
    ])
  })

  it('puts the two states that only wait for money into IN_PROGRESS', () => {
    // 남은 화살표가 `SYSTEM` 뿐이다. 판매자가 누를 것이 없다.
    expect([...claimStatusesInStage('IN_PROGRESS')]).toEqual([
      'CANCEL_APPROVED',
      'RETURN_COMPLETED',
    ])
  })

  it('puts the three terminal states into CLOSED', () => {
    expect([...claimStatusesInStage('CLOSED')]).toEqual([
      'CANCEL_REJECTED',
      'RETURN_REJECTED',
      'REFUNDED',
    ])
  })

  it('ranks waiting first and closed last', () => {
    expect(claimStageRank('WAITING')).toBeLessThan(claimStageRank('IN_PROGRESS'))
    expect(claimStageRank('IN_PROGRESS')).toBeLessThan(claimStageRank('CLOSED'))
  })
})

describe('어느 문으로 가는가', () => {
  it('sends approval and rejection through the transition route', () => {
    expect(claimActionRouteOf('CANCEL_REQUESTED', 'CANCEL_APPROVED')).toBe('transition')
    expect(claimActionRouteOf('RETURN_REQUESTED', 'RETURN_REJECTED')).toBe('transition')
  })

  it('sends the pickup step through the route that issues the waybill', () => {
    expect(claimActionRouteOf('RETURN_APPROVED', 'PICKING_UP')).toBe('pickup')
  })

  it('tells the two rejections apart by where they come from', () => {
    // `RETURN_REJECTED` 는 두 곳에서 나온다. 신청 거절은 전이이고 검수 불합격은
    // 검수다 — 뒤엣것을 전이 라우트로 밀면 반송장이 나지 않는다.
    expect(claimActionRouteOf('INSPECTING', 'RETURN_REJECTED')).toBe('inspection')
    expect(claimActionRouteOf('INSPECTING', 'RETURN_COMPLETED')).toBe('inspection')
  })
})

describe('사유가 필수인 걸음', () => {
  it('asks for one on both rejections and on nothing else', () => {
    const needing = claimStatuses.filter((status) => claimTransitionNeedsReason(status))

    expect(needing).toEqual(['CANCEL_REJECTED', 'RETURN_REJECTED'])
  })
})

describe('커서', () => {
  it('round-trips a position on the sort axis', () => {
    const cursor = { stageRank: 1, id: CLAIM_ID }

    expect(decodeSellerClaimCursor(encodeSellerClaimCursor(cursor))).toEqual(cursor)
  })

  it('does not read as its own contents', () => {
    // 날것으로 내보내면 「순위를 0으로 바꿔 보는」 요청이 생긴다.
    expect(encodeSellerClaimCursor({ stageRank: 0, id: CLAIM_ID })).not.toContain(CLAIM_ID)
  })

  it('refuses anything that is not a position', () => {
    const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

    expect(decodeSellerClaimCursor('not-base64url-at-all!!')).toBeNull()
    expect(decodeSellerClaimCursor(encode(CLAIM_ID))).toBeNull()
    expect(decodeSellerClaimCursor(encode(`0.${CLAIM_ID}x`))).toBeNull()
    // 단계는 셋뿐이다. 범위를 벗어난 순위는 정렬 축 위의 자리가 아니다.
    expect(decodeSellerClaimCursor(encode(`9.${CLAIM_ID}`))).toBeNull()
  })

  it('accepts every rank a stage actually has', () => {
    for (const status of claimStatuses) {
      const stageRank = claimStageRank(claimHandlingStage(status))

      expect(decodeSellerClaimCursor(encodeSellerClaimCursor({ stageRank, id: CLAIM_ID }))).toEqual(
        {
          stageRank,
          id: CLAIM_ID,
        },
      )
    }
  })
})
