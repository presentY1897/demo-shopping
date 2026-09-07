/**
 * 신고의 순수 판단 (TASK-0091). 입력 → 출력, 분기 100%.
 *
 * **임계치가 틀리면 두 가지 중 하나가 일어난다** — 신고 버튼 하나가 남의 글을 가리는
 * 검열 도구가 되거나, 관리자가 자는 동안 악성 콘텐츠가 그대로 남는다.
 */

import { describe, expect, it } from 'vitest'

import {
  REPORT_AUTO_HIDE_THRESHOLD,
  REPORT_EFFECT,
  isHandled,
  reachesAutoHide,
  removable,
} from './report-rules.js'

describe('자동 임시 숨김 (F3)', () => {
  it('임계치에서 가린다', () => {
    expect(reachesAutoHide(REPORT_AUTO_HIDE_THRESHOLD)).toBe(true)
  })

  it('그 전에는 가리지 않는다', () => {
    expect(reachesAutoHide(REPORT_AUTO_HIDE_THRESHOLD - 1)).toBe(false)
  })

  /**
   * **정확히 임계치에서만 참이다.** 그 뒤로도 참이면 관리자가 반려해 복구한 대상이
   * 네 번째 신고에 곧바로 다시 가려지고, 반려가 아무 뜻도 없어진다.
   */
  it('임계치를 넘은 뒤에는 다시 가리지 않는다', () => {
    expect(reachesAutoHide(REPORT_AUTO_HIDE_THRESHOLD + 1)).toBe(false)
  })

  /** 하나로 가려지면 그것은 신고가 아니라 검열 도구다. */
  it('한 건으로는 가려지지 않는다', () => {
    expect(REPORT_AUTO_HIDE_THRESHOLD).toBeGreaterThan(1)
    expect(reachesAutoHide(1)).toBe(false)
  })
})

describe('처리의 결과 (F4 · F5)', () => {
  it('숨김은 가리고, 삭제는 지우고, 반려는 드러낸다', () => {
    expect(REPORT_EFFECT.HIDDEN).toBe('hide')
    expect(REPORT_EFFECT.REMOVED).toBe('remove')
    expect(REPORT_EFFECT.REJECTED).toBe('reveal')
  })

  /**
   * **반려가 복구를 뜻한다는 것이 잊히기 쉽다.** 자동 임시 숨김이 이미 가려 놓았으니,
   * 반려에서 아무것도 하지 않으면 「아니라고 판단했는데 계속 가려져 있는」 상태가 남는다.
   */
  it('반려는 아무 일도 안 하는 것이 아니다', () => {
    expect(REPORT_EFFECT.REJECTED).not.toBe('hide')
  })
})

describe('처리 여부', () => {
  it('대기 중은 처리되지 않았다', () => {
    expect(isHandled('PENDING')).toBe(false)
  })

  it.each(['HIDDEN', 'REMOVED', 'REJECTED'] as const)('%s 는 처리된 것이다', (status) => {
    expect(isHandled(status)).toBe(true)
  })
})

describe('지울 수 있는 대상', () => {
  it.each(['REVIEW', 'QUESTION', 'ANSWER'] as const)('%s 는 지울 수 있다', (target) => {
    expect(removable(target)).toBe(true)
  })

  /**
   * **상품은 지우지 않는다.** 주문·정산·리뷰가 가리키는 행이고, 문제가 있는 상품에
   * 대한 답은 판매를 멈추는 것이지 기록을 없애는 것이 아니다 — 지우면 그 상품을 산
   * 사람의 주문 이력이 무엇을 가리키는지 알 수 없게 된다.
   */
  it('상품은 지울 수 없다', () => {
    expect(removable('PRODUCT')).toBe(false)
  })
})
