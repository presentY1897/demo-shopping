/**
 * 리뷰가 화면을 그리기 전에 내리는 판단들 (TASK-0083 · TASK-0084).
 *
 * 넷 다 **틀려도 조용하다.** 100배 정수를 잘못 나누면 화면은 멀쩡한 숫자를 하나 그리고
 * 사람은 그것을 보고 상품을 고른다. 남은 기간을 하루 어긋나게 세면 목록은 서버가 곧
 * 거절할 일을 권한다. 밀도별 노출 수가 어긋나면 맥시멀에서 3건이 보이는데 아무 검사도
 * 실패하지 않는다. 그래서 이 넷은 `vitest.config.mjs` 의 문턱 목록에 있고, 이 파일이
 * 그 문턱을 채운다.
 */

import { REVIEW_CONTENT_MAX } from '@shopping/shared'
import { DENSITY_LEVELS } from '@shopping/ui'
import { describe, expect, it } from 'vitest'

import { REVIEW_PAGE_SIZE, reviewExposure } from '@/lib/reviews/exposure'
import { filledStars, RATING_STARS, ratingText } from '@/lib/reviews/rating'
import { reviewDraftIssues } from '@/lib/reviews/review-draft'
import { writableWindow } from '@/lib/reviews/writable-window'

describe('평점 — 100배 정수를 사람이 읽는 값으로', () => {
  it('reads 435 as 4.4 rather than 4.35 or 435', () => {
    // 계약이 정수로 나르는 이유가 반올림을 서버에서 한 번만 하기 위해서다. 화면이
    // 자리수를 다르게 잡으면 같은 상품의 평점이 카드와 상세에서 달라 보인다.
    expect(ratingText(435)).toBe('4.4')
    expect(ratingText(500)).toBe('5.0')
    expect(ratingText(0)).toBe('0.0')
  })

  it('rounds the star row rather than truncating it', () => {
    // 반내림이면 4.9가 별 넷이 되어 **숫자와 그림이 서로 다른 말**을 한다.
    expect(filledStars(490)).toBe(5)
    expect(filledStars(440)).toBe(4)
    expect(filledStars(0)).toBe(0)
    expect(filledStars(500)).toBe(RATING_STARS)
  })
})

describe('남은 기간 — 서버가 준 기한을 며칠로 옮긴다', () => {
  const now = new Date('2026-09-06T00:00:00.000Z')

  it('counts the days that are left', () => {
    expect(writableWindow('2026-09-18T00:00:00.000Z', now)).toEqual({ kind: 'daysLeft', days: 12 })
  })

  it('calls the last day 오늘까지 rather than 1일 남음', () => {
    // 「1일 남음」은 내일도 되는 것처럼 읽힌다. 남은 조각이 몇 시간이든 오늘이 끝이다.
    expect(writableWindow('2026-09-06T23:00:00.000Z', now)).toEqual({ kind: 'lastDay' })
    expect(writableWindow('2026-09-06T00:00:00.001Z', now)).toEqual({ kind: 'lastDay' })
  })

  it('rounds a part-day up, so 25 hours is two days', () => {
    expect(writableWindow('2026-09-07T01:00:00.000Z', now)).toEqual({ kind: 'daysLeft', days: 2 })
  })

  it('says the window is closed once the instant has passed', () => {
    // 목록을 받은 뒤에도 시간은 흐른다 — 열어 둔 화면이 자정을 넘길 수 있다.
    expect(writableWindow('2026-09-06T00:00:00.000Z', now)).toEqual({ kind: 'expired' })
    expect(writableWindow('2026-09-05T00:00:00.000Z', now)).toEqual({ kind: 'expired' })
  })
})

describe('밀도별 노출 — 표가 유일한 출처다', () => {
  it('matches the table in TASK-0084 4장', () => {
    expect(reviewExposure(1)).toEqual({
      rating: 'score',
      collapsed: true,
      count: 3,
      gallery: false,
    })
    expect(reviewExposure(2)).toEqual({
      rating: 'stars',
      collapsed: false,
      count: 3,
      gallery: false,
    })
    expect(reviewExposure(3)).toEqual({
      rating: 'distribution',
      collapsed: false,
      count: 5,
      gallery: true,
    })
  })

  it('answers for every density the toggle can produce', () => {
    // `Record` 라 단계가 넷이 되면 타입이 먼저 막는다. 이 검사는 지금 셋이 전부
    // 답을 갖는다는 사실을 잰다.
    for (const level of DENSITY_LEVELS) {
      expect(reviewExposure(level).count).toBeGreaterThan(0)
    }
  })

  it('fetches the most any step shows, so changing density asks nothing again', () => {
    expect(REVIEW_PAGE_SIZE).toBe(reviewExposure(3).count)
  })
})

describe('보내기 전에 걸리는 것들', () => {
  const ok = { content: '두께감이 좋았습니다.', rating: 5, uploading: false }

  it('lets a complete draft through', () => {
    expect(reviewDraftIssues(ok)).toEqual([])
  })

  it('refuses a draft with no rating — 0 is "not chosen", not a score', () => {
    expect(reviewDraftIssues({ ...ok, rating: 0 })).toEqual(['rating_required'])
  })

  it('refuses an empty body, and whitespace is empty', () => {
    // 별점만 남기는 길이 열리면 평균만 움직이고 근거가 남지 않는다.
    expect(reviewDraftIssues({ ...ok, content: '' })).toEqual(['content_required'])
    expect(reviewDraftIssues({ ...ok, content: '   \n ' })).toEqual(['content_required'])
  })

  it('refuses a body over the contract cap', () => {
    expect(reviewDraftIssues({ ...ok, content: 'ㄱ'.repeat(REVIEW_CONTENT_MAX) })).toEqual([])
    expect(reviewDraftIssues({ ...ok, content: 'ㄱ'.repeat(REVIEW_CONTENT_MAX + 1) })).toEqual([
      'content_too_long',
    ])
  })

  it('waits for the photos, because a key that has not arrived is a key left out', () => {
    expect(reviewDraftIssues({ ...ok, uploading: true })).toEqual(['photo_uploading'])
  })

  it('reports them in the order they are fixed in', () => {
    // 화면은 첫 하나만 보인다. 순서가 곧 「어디부터 고치라」는 답이다.
    expect(reviewDraftIssues({ content: '', rating: 0, uploading: true })).toEqual([
      'rating_required',
      'content_required',
      'photo_uploading',
    ])
  })
})
