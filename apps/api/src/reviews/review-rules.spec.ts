/**
 * 리뷰의 시점 판단 (TASK-0083). 입력 → 출력, 분기 100%.
 *
 * **구매했는가는 여기서 재지 않는다.** 그 답은 스키마가 갖고 있고, 이 파일에 그
 * 물음이 없다는 것이 설계의 요점이다 — 코드가 물으면 우회 경로가 생기는 날 뚫리지만,
 * 없는 행은 어떤 경로로도 만들 수 없다.
 */

import { describe, expect, it } from 'vitest'

import type { OrderStatus } from '@shopping/shared'

import type { ReviewSubject } from './review-rules.js'
import {
  editable,
  isOwnImageKey,
  maskAuthorName,
  REVIEW_EDIT_WINDOW_DAYS,
  REVIEW_IMAGE_MAX_COUNT,
  REVIEW_WRITE_WINDOW_DAYS,
  reviewDecision,
  reviewImageDecision,
} from './review-rules.js'

const NOW = new Date('2026-09-10T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1_000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

function subject(overrides: Partial<ReviewSubject> = {}): ReviewSubject {
  return { status: 'DELIVERED', deliveredAt: daysAgo(1), reviewed: false, ...overrides }
}

describe('쓸 수 있는가 (F3)', () => {
  it('배송완료된 항목에 쓸 수 있다', () => {
    expect(reviewDecision(subject(), NOW)).toEqual({ allowed: true })
  })

  /**
   * **구매확정 뒤에도 쓸 수 있어야 한다.** 확정은 배송완료 7일 뒤 자동으로 오므로,
   * 확정을 막으면 리뷰를 쓸 수 있는 사람이 거의 남지 않는다.
   */
  it('구매확정된 항목에도 쓸 수 있다', () => {
    expect(reviewDecision(subject({ status: 'CONFIRMED' }), NOW)).toEqual({ allowed: true })
  })

  it.each(['PAYMENT_PENDING', 'PAID', 'PREPARING', 'SHIPPED'] as const)(
    '%s 에는 아직 쓸 수 없다',
    (status: OrderStatus) => {
      expect(reviewDecision(subject({ status, deliveredAt: null }), NOW)).toEqual({
        allowed: false,
        reason: 'not_delivered',
      })
    },
  )

  /** 취소·반품은 「기다리면 되는」 상태가 아니다 — 애초에 받은 적이 없다. */
  it.each(['CANCELED', 'RETURNED'] as const)('%s 된 항목에는 쓸 수 없다', (status: OrderStatus) => {
    expect(reviewDecision(subject({ status }), NOW)).toEqual({
      allowed: false,
      reason: 'canceled',
    })
  })

  /** 이미 쓴 사람에게 「기간이 지났어요」는 틀린 말이다 — 고치면 되는 상황이다. */
  it('이미 쓴 항목이면 그 사실을 말한다', () => {
    expect(reviewDecision(subject({ reviewed: true }), NOW)).toEqual({
      allowed: false,
      reason: 'already_reviewed',
    })
  })

  it('기한이 지난 뒤에도 이미 쓴 것이 먼저다', () => {
    const late = subject({ reviewed: true, deliveredAt: daysAgo(REVIEW_WRITE_WINDOW_DAYS + 10) })

    expect(reviewDecision(late, NOW)).toEqual({ allowed: false, reason: 'already_reviewed' })
  })

  it('배송완료 기록이 없으면 쓸 수 없다', () => {
    expect(reviewDecision(subject({ deliveredAt: null }), NOW)).toEqual({
      allowed: false,
      reason: 'not_delivered',
    })
  })
})

describe('작성 기한', () => {
  it('마지막 날에는 쓸 수 있다', () => {
    const edge = subject({ deliveredAt: daysAgo(REVIEW_WRITE_WINDOW_DAYS) })

    expect(reviewDecision(edge, NOW)).toEqual({ allowed: true })
  })

  it('하루 지나면 쓸 수 없다', () => {
    const late = subject({ deliveredAt: daysAgo(REVIEW_WRITE_WINDOW_DAYS + 1) })

    expect(reviewDecision(late, NOW)).toEqual({ allowed: false, reason: 'window_closed' })
  })

  /** 구매확정(D+7)보다 넉넉히 뒤여야 쓸 수 있는 창이 실제로 존재한다. */
  it('작성 기한이 자동 구매확정보다 뒤다', () => {
    expect(REVIEW_WRITE_WINDOW_DAYS).toBeGreaterThan(7)
  })
})

describe('수정 기한 (F5)', () => {
  it('쓴 직후에는 고칠 수 있다', () => {
    expect(editable(daysAgo(0), NOW)).toBe(true)
  })

  it('마지막 날에는 고칠 수 있다', () => {
    expect(editable(daysAgo(REVIEW_EDIT_WINDOW_DAYS), NOW)).toBe(true)
  })

  /**
   * **무기한 수정을 허용하면** 혜택을 주고 별 다섯을 받은 뒤 몇 달 지나 그 리뷰가
   * 별 하나로 바뀌는 일을 아무도 막지 못한다.
   */
  it('하루 지나면 고칠 수 없다', () => {
    expect(editable(daysAgo(REVIEW_EDIT_WINDOW_DAYS + 1), NOW)).toBe(false)
  })

  /** 기준이 쓴 시각이라, 고칠 때마다 30일이 새로 시작하지 않는다. */
  it('수정 기한이 작성 기한보다 짧다', () => {
    expect(REVIEW_EDIT_WINDOW_DAYS).toBeLessThan(REVIEW_WRITE_WINDOW_DAYS)
  })
})

describe('사진 (F6)', () => {
  const OWNER = '0192f0c1-0000-7000-8000-000000000001'
  const OTHER = '0192f0c1-0000-7000-8000-000000000002'

  function key(owner: string, index: number): string {
    return `reviews/${owner}/0192f0c1-0000-7000-8000-00000000000${String(index)}.jpg`
  }

  it('자기 접두어의 사진은 붙일 수 있다', () => {
    expect(reviewImageDecision([key(OWNER, 1), key(OWNER, 2)], OWNER)).toEqual({
      outcome: 'allowed',
    })
  })

  it('사진이 없어도 된다', () => {
    expect(reviewImageDecision([], OWNER)).toEqual({ outcome: 'allowed' })
  })

  it('상한까지는 받는다', () => {
    const keys = Array.from({ length: REVIEW_IMAGE_MAX_COUNT }, (_unused, i) => key(OWNER, i))

    expect(reviewImageDecision(keys, OWNER)).toEqual({ outcome: 'allowed' })
  })

  /** 상한이 없으면 리뷰 한 번이 업로드 무제한이 된다. */
  it('상한을 넘으면 거절한다', () => {
    const keys = Array.from({ length: REVIEW_IMAGE_MAX_COUNT + 1 }, (_unused, i) => key(OWNER, i))

    expect(reviewImageDecision(keys, OWNER)).toEqual({ outcome: 'refused', reason: 'too_many' })
  })

  it('같은 사진을 두 번 붙일 수 없다', () => {
    expect(reviewImageDecision([key(OWNER, 1), key(OWNER, 1)], OWNER)).toEqual({
      outcome: 'refused',
      reason: 'duplicate',
    })
  })

  /** 열쇠가 곧 소유자다 — 두 번째 조회 없이 남의 사진을 막는다. */
  it('남의 접두어는 거절한다', () => {
    expect(reviewImageDecision([key(OTHER, 1)], OWNER)).toEqual({
      outcome: 'refused',
      reason: 'foreign',
    })
  })

  it('형식이 아닌 열쇠도 남의 것과 같이 거절한다', () => {
    expect(reviewImageDecision([`reviews/${OWNER}/../secret.jpg`], OWNER)).toEqual({
      outcome: 'refused',
      reason: 'foreign',
    })
  })

  it('반품 사진의 열쇠는 리뷰에 붙지 않는다', () => {
    const returned = `returns/${OWNER}/0192f0c1-0000-7000-8000-000000000009.jpg`

    expect(isOwnImageKey(returned, OWNER)).toBe(false)
  })
})

describe('쓴 사람의 이름', () => {
  it.each([
    ['홍길동', '홍*동'],
    ['김철수영', '김**영'],
    ['가나', '가*'],
    ['가', '가'],
    ['', ''],
  ])('%s → %s', (name, masked) => {
    expect(maskAuthorName(name)).toBe(masked)
  })

  /** 한 글자를 가리면 남는 것이 없어 「누가 썼는지 모르는 리뷰」가 된다. */
  it('한 글자 이름은 가리지 않는다', () => {
    expect(maskAuthorName('가')).toBe('가')
  })

  it('앞뒤 공백은 이름이 아니다', () => {
    expect(maskAuthorName('  홍길동  ')).toBe('홍*동')
  })
})
