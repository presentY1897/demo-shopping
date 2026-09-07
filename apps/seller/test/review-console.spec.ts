/**
 * 리뷰 관리 화면의 순수 판단 (TASK-0085 F5 · F6 · F7).
 *
 * `vitest.config.mjs` 가 `lib/reviews/review-console.ts` 를 **분기 100%** 로 잡고
 * 있고, 이 파일이 그 문턱을 채우는 유일한 곳이다. 이유는 저 모듈의 머리말이 적고
 * 있다: 여기 있는 판단들은 틀려도 조용하다 — 질의에서 `sellerId` 가 빠지면 목록이
 * 비는 것이 아니라 거절되고, 「미답변만」이 실리지 않으면 답한 리뷰가 섞인 목록이
 * 그려질 뿐이다.
 */

import type { ApiFailure, SellerProductReview } from '@shopping/shared'
import { REVIEW_REPLY_CONTENT_MAX } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  EMPTY_REVIEW_FILTERS,
  isNarrowed,
  isUnanswered,
  MAX_RATING_CHOICES,
  RATING_MAX,
  ratingStars,
  replyRefusalOf,
  reviewReplyFormSchema,
  reviewSearch,
  sellerReviewQuery,
} from '@/lib/reviews/review-console'

const SELLER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0001'

function paramsOf(search: string): URLSearchParams {
  return new URL(`http://api.test.invalid/x${search}`).searchParams
}

function httpFailure(status: number, code: string): ApiFailure {
  return { code, details: [], kind: 'http', message: 'nope', requestId: null, status }
}

const review = {
  authorName: '홍*동',
  content: '색이 달라요.',
  createdAt: '2026-09-04T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f6001',
  images: [],
  optionLabel: null,
  productId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f7001',
  productName: '리네아 오버사이즈 코트',
  rating: 2,
  reply: null,
  status: 'PUBLISHED',
  updatedAt: '2026-09-04T02:00:00.000Z',
} satisfies SellerProductReview

describe('별점 표시', () => {
  it('always draws five slots, however low the rating', () => {
    expect(ratingStars(1)).toBe('★☆☆☆☆')
    expect(ratingStars(5)).toBe('★★★★★')
    // 채운 별만 그리면 3점과 5점의 폭이 달라 목록을 세로로 훑을 수 없다.
    expect([...ratingStars(3)]).toHaveLength(RATING_MAX)
  })
})

describe('미답변 판정', () => {
  it('is about the reply, not about the rating (F5)', () => {
    expect(isUnanswered(review)).toBe(true)
    expect(
      isUnanswered({
        ...review,
        reply: {
          brandName: '루미에르',
          content: '확인하겠습니다.',
          createdAt: '2026-09-05T02:00:00.000Z',
          reviewId: review.id,
          updatedAt: '2026-09-05T02:00:00.000Z',
        },
      }),
    ).toBe(false)
  })
})

describe('필터', () => {
  it('starts wide open', () => {
    expect(isNarrowed(EMPTY_REVIEW_FILTERS)).toBe(false)
  })

  it('counts either axis as narrowed', () => {
    // 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가르는 판단이다. 한쪽 축만
    // 세면 다른 축을 켠 판매자는 「아직 리뷰가 없어요」를 읽는다.
    expect(isNarrowed({ maxRating: null, unansweredOnly: true })).toBe(true)
    expect(isNarrowed({ maxRating: 2, unansweredOnly: false })).toBe(true)
  })

  it('offers no "5점 이하", because that is the same list as 전체', () => {
    expect(MAX_RATING_CHOICES).toEqual([1, 2, 3, 4])
    expect(MAX_RATING_CHOICES).not.toContain(RATING_MAX)
  })
})

describe('질의 조립', () => {
  it('leaves an unset axis out of the query entirely', () => {
    // `undefined` 를 실어 보내면 `maxRating=undefined` 가 되고, `z.coerce.number()`
    // 가 그것을 `NaN` 으로 읽어 400 으로 답한다.
    expect(sellerReviewQuery(EMPTY_REVIEW_FILTERS, null)).toEqual({})
  })

  it('carries both axes and the cursor when they are set', () => {
    expect(sellerReviewQuery({ maxRating: 2, unansweredOnly: true }, 'cursor-page-2')).toEqual({
      cursor: 'cursor-page-2',
      maxRating: 2,
      unansweredOnly: true,
    })
  })
})

describe('질의 문자열', () => {
  it('always names the seller', () => {
    // 없으면 요청이 거절되고, 화면은 「리뷰가 없어요」가 아니라 「불러오지
    // 못했습니다」로 끝난다 — 두 문장은 판매자에게 전혀 다른 뜻이다.
    expect(paramsOf(reviewSearch(SELLER_ID, EMPTY_REVIEW_FILTERS, null)).get('sellerId')).toBe(
      SELLER_ID,
    )
  })

  it('omits the axes nobody chose', () => {
    const params = paramsOf(reviewSearch(SELLER_ID, EMPTY_REVIEW_FILTERS, null))

    expect(params.has('unansweredOnly')).toBe(false)
    expect(params.has('maxRating')).toBe(false)
    expect(params.has('cursor')).toBe(false)
  })

  it('sends the axes that were chosen, and hands the cursor back unchanged', () => {
    const params = paramsOf(
      reviewSearch(SELLER_ID, { maxRating: 2, unansweredOnly: true }, 'cursor-page-2'),
    )

    expect(params.get('unansweredOnly')).toBe('true')
    expect(params.get('maxRating')).toBe('2')
    expect(params.get('cursor')).toBe('cursor-page-2')
  })
})

describe('답변 폼의 규칙', () => {
  const schema = reviewReplyFormSchema({ required: '내용을 입력해주세요.', tooLong: '{max}자까지' })

  it('refuses an answer that is only whitespace', () => {
    const parsed = schema.safeParse({ content: '   ' })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe('내용을 입력해주세요.')
  })

  it('refuses one past the contract’s limit, and says the limit', () => {
    const parsed = schema.safeParse({ content: 'ㅁ'.repeat(REVIEW_REPLY_CONTENT_MAX + 1) })

    expect(parsed.success).toBe(false)
    // 숫자는 문장이 아니라 계약의 상수에서 온다. 문장에 적어 두면 상한을 고친 날
    // 이 문장만 옛 숫자로 남는다.
    expect(parsed.error?.issues[0]?.message).toBe(`${String(REVIEW_REPLY_CONTENT_MAX)}자까지`)
  })

  it('trims what it accepts', () => {
    expect(schema.parse({ content: '  확인하겠습니다.  ' })).toEqual({
      content: '확인하겠습니다.',
    })
  })
})

describe('거절 읽기 (F2)', () => {
  it('has nothing to read when the API never answered', () => {
    expect(replyRefusalOf({ kind: 'transport', reason: 'network' })).toBe('other')
  })

  it('separates "not my store" from "already gone"', () => {
    expect(replyRefusalOf(httpFailure(403, 'FORBIDDEN'))).toBe('forbidden')
    expect(replyRefusalOf(httpFailure(404, 'NOT_FOUND'))).toBe('gone')
  })

  it('leaves every other refusal to the code catalog', () => {
    // 500 에 이 화면만의 문장을 두면 카탈로그가 이미 답한 것을 두 번째로 답하게
    // 되고, 그 둘은 언젠가 갈린다.
    expect(replyRefusalOf(httpFailure(500, 'INTERNAL_ERROR'))).toBe('other')
  })
})
