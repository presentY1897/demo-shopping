import { DEMO_ISSUE_LIMIT, DEMO_ISSUE_WINDOW_SECONDS } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  DEMO_ISSUE_COUNT_SQL,
  DEMO_ISSUE_LOCK_SQL,
  UNKNOWN_ADDRESS,
  issueAddress,
  windowStart,
  withinLimit,
} from './demo-rate-limit.js'

/**
 * The three decisions the limit is made of, with no database in sight.
 *
 * They fail silently when they are wrong: an address that normalises to the
 * wrong bucket gives one visitor somebody else's quota, an off-by-one on the
 * comparison either blocks the three-tab visitor F7 promises or lets ten through
 * where F6 expects five, and neither shows up as anything but a demo that
 * behaves oddly under load.
 */

describe('주소 정규화', () => {
  it('보낸 주소를 그대로 쓴다', () => {
    expect(issueAddress('203.0.113.7')).toBe('203.0.113.7')
  })

  it('공백을 떼어낸다', () => {
    expect(issueAddress('  203.0.113.7 ')).toBe('203.0.113.7')
  })

  it('알 수 없으면 한 바구니로 모은다', () => {
    // Safer than the alternative: no address must not mean no limit.
    expect(issueAddress(undefined)).toBe(UNKNOWN_ADDRESS)
    expect(issueAddress('')).toBe(UNKNOWN_ADDRESS)
    expect(issueAddress('   ')).toBe(UNKNOWN_ADDRESS)
  })
})

describe('창의 시작', () => {
  it('지금으로부터 창 길이만큼 뒤로 간다', () => {
    const now = new Date('2026-09-05T00:01:00.000Z')

    expect(windowStart(now).toISOString()).toBe(
      new Date(now.getTime() - DEMO_ISSUE_WINDOW_SECONDS * 1000).toISOString(),
    )
  })
})

describe('한도', () => {
  it('한도 미만이면 통과시킨다', () => {
    expect(withinLimit(0)).toBe(true)
    expect(withinLimit(DEMO_ISSUE_LIMIT - 1)).toBe(true)
  })

  it('한도에 닿으면 막는다', () => {
    expect(withinLimit(DEMO_ISSUE_LIMIT)).toBe(false)
    expect(withinLimit(DEMO_ISSUE_LIMIT + 1)).toBe(false)
  })

  it('탭 세 개에서 동시에 받는 것은 막지 않는다 (F7)', () => {
    expect(withinLimit(2)).toBe(true)
  })
})

describe('질의문', () => {
  it('계정을 세고 토큰을 세지 않는다', () => {
    // Counting tokens would refuse a visitor whose open tabs renewed a session.
    expect(DEMO_ISSUE_COUNT_SQL).toContain('FROM "User" u')
    expect(DEMO_ISSUE_COUNT_SQL).toContain('EXISTS')
  })

  it('만료 컬럼으로 데모를 가려낸다', () => {
    // `User_demo_expiry_check` makes this equivalent to the boolean beside it,
    // and reading this one is what keeps the containment allow list at one file.
    expect(DEMO_ISSUE_COUNT_SQL).toContain('"demoExpiresAt" IS NOT NULL')
    expect(DEMO_ISSUE_COUNT_SQL).not.toMatch(/isdemo/i)
  })

  it('트랜잭션 스코프 락을 쓴다', () => {
    // Session-scoped would leave one address locked out after a crashed request.
    expect(DEMO_ISSUE_LOCK_SQL).toContain('pg_advisory_xact_lock')
  })
})
