/**
 * 알림의 순수 판단 (TASK-0090). 입력 → 출력, 분기 100%.
 *
 * **여기가 틀리면 사람이 끈 알림이 오거나, 켜 둔 알림이 안 온다.** 뒤엣것이 특히
 * 조용하다 — 안 오는 알림은 아무 화면에도 나타나지 않는다.
 */

import { describe, expect, it } from 'vitest'

import type { NotificationType } from '@prisma/client'

import {
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATION_SWITCH,
  retentionCutoff,
  shouldNotify,
} from './notification-rules.js'

const ALL: readonly NotificationType[] = [
  'ORDER_STATUS',
  'CLAIM_STATUS',
  'REVIEW_REPLY',
  'QUESTION_ANSWER',
  'RESTOCK',
  'NEW_PRODUCT',
  'SELLER_SETTLEMENT',
  'SELLER_ORDER',
  'SELLER_CLAIM',
  'ADMIN_SELLER_APPLICATION',
  'REPORT_HANDLED',
]

const BOTH_ON = { notifyOrder: true, notifyClaim: true }

describe('수신 설정 (F5)', () => {
  it('거래 알림은 거래 스위치가 끈다', () => {
    expect(shouldNotify('ORDER_STATUS', { ...BOTH_ON, notifyOrder: false })).toBe(false)
    expect(shouldNotify('ORDER_STATUS', BOTH_ON)).toBe(true)
  })

  it('클레임 알림은 클레임 스위치가 끈다', () => {
    expect(shouldNotify('CLAIM_STATUS', { ...BOTH_ON, notifyClaim: false })).toBe(false)
  })

  /** 거래를 껐다고 클레임까지 꺼지면 사람이 고른 것과 다른 일이 일어난다. */
  it('한 스위치가 다른 유형을 끄지 않는다', () => {
    expect(shouldNotify('CLAIM_STATUS', { ...BOTH_ON, notifyOrder: false })).toBe(true)
  })

  /**
   * **내가 물어본 것에 대한 답은 끄는 것이 뜻을 갖지 않는다.** 찜과 팔로우는 그 자체가
   * 신청이라, 끄는 방법이 이미 있다 — 찜을 빼거나 언팔로우하는 것.
   */
  it.each(['REVIEW_REPLY', 'QUESTION_ANSWER', 'RESTOCK', 'NEW_PRODUCT', 'REPORT_HANDLED'] as const)(
    '%s 에는 스위치가 없다',
    (type) => {
      expect(NOTIFICATION_SWITCH[type]).toBeNull()
      expect(shouldNotify(type, { notifyOrder: false, notifyClaim: false })).toBe(true)
    },
  )

  /**
   * 설정 행은 사람이 설정 화면을 한 번이라도 열어야 생긴다. 그때까지의 기본값이
   * 「받는다」여야 화면이 켜져 있다고 말하는 것과 실제가 같다.
   */
  it.each(ALL)('%s 는 설정 행이 없으면 보낸다', (type) => {
    expect(shouldNotify(type, null)).toBe(true)
  })

  it('모든 유형에 스위치가 정해져 있다', () => {
    for (const type of ALL) expect(type in NOTIFICATION_SWITCH).toBe(true)
  })
})

describe('보관 기간', () => {
  it('90일 이전을 자른다', () => {
    const now = new Date('2026-09-10T00:00:00.000Z')
    const cutoff = retentionCutoff(now)

    expect(now.getTime() - cutoff.getTime()).toBe(
      NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    )
  })

  /** 배지에 영영 남는 숫자는 배지를 무의미하게 만든다. */
  it('기한이 있다', () => {
    expect(NOTIFICATION_RETENTION_DAYS).toBeGreaterThan(0)
  })
})
