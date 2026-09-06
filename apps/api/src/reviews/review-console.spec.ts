/**
 * 리뷰 목록의 순수 판단 (TASK-0084). 입력 → 출력, 분기 100%.
 *
 * 셋 다 **화면이 다시 계산하면 갈라지는** 것들이다 — 커서가 갈라지면 페이지가
 * 겹치거나 건너뛰고, 분포가 갈라지면 합이 100이 아닌 그래프가 그려진다.
 */

import { describe, expect, it } from 'vitest'

import {
  decodeReviewCursor,
  encodeReviewCursor,
  rankOf,
  ratingAverage,
  ratingDistribution,
  reviewSortKeys,
} from './review-console.js'

const ID = '0192f0c1-0000-7000-8000-000000000001'

describe('커서', () => {
  it('실어 보낸 자리를 그대로 되찾는다', () => {
    const cursor = { rank: 4, id: ID }

    expect(decodeReviewCursor(encodeReviewCursor(cursor))).toEqual(cursor)
  })

  it('도움 수처럼 큰 값도 담는다', () => {
    const cursor = { rank: 12_345, id: ID }

    expect(decodeReviewCursor(encodeReviewCursor(cursor))).toEqual(cursor)
  })

  /** 날것으로 내보내면 「순위를 0으로 바꿔 보는」 요청이 생긴다. */
  it('겉으로 읽히지 않는다', () => {
    expect(encodeReviewCursor({ rank: 4, id: ID })).not.toContain(ID)
  })

  /**
   * **조용히 첫 페이지로 되돌리지 않는다.** 그러면 커서가 깨진 화면이 1페이지를
   * 무한히 반복하고, 그 증상은 아무 오류도 내지 않는다.
   */
  it.each(['', 'not-base64!!', Buffer.from('4.not-a-uuid').toString('base64url')])(
    '모양이 아니면 %s 는 null 이다',
    (value) => {
      expect(decodeReviewCursor(value)).toBeNull()
    },
  )
})

describe('정렬 축 위의 자리', () => {
  const review = { rating: 4, helpfulCount: 12 }

  it('평점순의 자리는 별이다', () => {
    expect(rankOf('rating', review)).toBe(4)
  })

  it('도움순의 자리는 도움 수다', () => {
    expect(rankOf('helpful', review)).toBe(12)
  })

  /** 최신순의 축은 id 하나뿐이다 — 0 은 「쓰지 않는 칸」이지 값이 아니다. */
  it('최신순은 자리를 쓰지 않는다', () => {
    expect(rankOf('latest', review)).toBe(0)
  })

  it('축은 셋뿐이다', () => {
    expect([...reviewSortKeys]).toEqual(['latest', 'rating', 'helpful'])
  })
})

describe('별점 분포 (F1)', () => {
  /** 각자 반올림하면 99나 101이 나오고, 그 화면은 고장으로 보인다. */
  it('비율의 합이 정확히 100이다', () => {
    const buckets = ratingDistribution({ 5: 1, 4: 1, 3: 1 })

    expect(buckets.reduce((sum, bucket) => sum + bucket.percentage, 0)).toBe(100)
  })

  it('나누어떨어지지 않아도 합이 100이다', () => {
    const buckets = ratingDistribution({ 5: 1, 4: 1, 3: 1, 2: 1, 1: 1 })

    expect(buckets.map((bucket) => bucket.percentage)).toEqual([20, 20, 20, 20, 20])
  })

  it('남는 몫은 가장 큰 칸으로 간다', () => {
    const buckets = ratingDistribution({ 5: 2, 4: 1 })

    expect(buckets[0]).toEqual({ rating: 5, count: 2, percentage: 67 })
    expect(buckets[1]).toEqual({ rating: 4, count: 1, percentage: 33 })
  })

  it('별 다섯부터 하나까지 다섯 칸이 언제나 있다', () => {
    expect(ratingDistribution({ 5: 1 }).map((bucket) => bucket.rating)).toEqual([5, 4, 3, 2, 1])
  })

  /** 없는 것을 균등하다고 말하면 「별 하나가 20%인 상품」으로 읽힌다. */
  it('리뷰가 없으면 비율도 전부 0이다', () => {
    expect(ratingDistribution({}).every((bucket) => bucket.percentage === 0)).toBe(true)
  })
})

describe('평균 (F2)', () => {
  it('100배 정수로 답한다', () => {
    expect(ratingAverage({ 5: 1, 4: 1 })).toBe(450)
  })

  it('나누어떨어지지 않으면 반올림한다', () => {
    // (5 + 4 + 4) / 3 = 4.333… → 433
    expect(ratingAverage({ 5: 1, 4: 2 })).toBe(433)
  })

  /** `Product_rating_check` 가 「개수가 0이면 평균도 0」을 요구한다. */
  it('리뷰가 없으면 0이다', () => {
    expect(ratingAverage({})).toBe(0)
  })

  it.each([
    [{ 1: 1 }, 100],
    [{ 5: 1 }, 500],
  ])('경계값 %o 는 %i 이다', (counts, expected) => {
    expect(ratingAverage(counts)).toBe(expected)
  })
})
