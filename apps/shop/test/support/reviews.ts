/**
 * 리뷰 라우트의 대역 — **`@shopping/api-mocks` 가 아니라 여기 있다.**
 *
 * 그 패키지에는 리뷰 핸들러가 아직 없고, 그것을 더하는 일은 이 갈래의 소유가 아니다
 * (CLAUDE.md 2장 — 다른 TASK 가 선언한 소유 경로). 그래서 이 파일은 `globalThis.fetch`
 * 를 감싸 **리뷰 경로만** 가로채고 나머지는 msw 가 그대로 답하게 둔다 — 세션 갱신도,
 * presign 도, 저장소 PUT 도 전부 진짜 대역을 지난다.
 *
 * `apps/seller` 의 `coupon-list.spec.tsx` 가 같은 이음매를 쓴다(질의를 들여다보려고).
 * 여기서는 그 이음매가 **핸들러가 없는 라우트**를 대신하고, 그래서 두 가지를 지킨다.
 *
 * ① **답은 계약 스키마를 지나서 나간다.** 대역이 만든 응답을 그대로 돌려주면 화면과
 *    대역이 함께 틀린 모양에 합의할 수 있다. `reviewListResponseSchema.parse` 를 여기서
 *    한 번 통과시키면, 서버가 실제로 보낼 수 없는 모양은 검사 안에서 먼저 터진다.
 * ② **요청도 계약으로 읽는다.** 화면이 보낸 본문을 `createReviewRequestSchema` 로
 *    파싱하므로, 화면이 계약에 없는 필드를 싣거나 필수 필드를 빠뜨리면 검사가 실패한다.
 *
 * msw 를 쓰지 않는 것은 취향이 아니다 — `apps/shop` 의 의존성에 `msw` 가 없다
 * (`@shopping/api-mocks` 만 있다). 핸들러를 그 패키지에 더할 수 있게 되면 이 파일은
 * 지워지는 것이 맞다.
 */

import { MOCK_STORAGE_PUBLIC_ORIGIN } from '@shopping/api-mocks'
import { API_PATH_PREFIX } from '@shopping/shared'
import type {
  RatingSummary,
  Review,
  ReviewImage,
  ReviewListEntry,
  ReviewableItem,
} from '@shopping/shared'
import {
  createReviewRequestSchema,
  reviewHelpfulResponseSchema,
  reviewListResponseSchema,
  reviewResponseSchema,
  reviewableListResponseSchema,
  updateReviewRequestSchema,
} from '@shopping/shared'
import { vi } from 'vitest'

export const MOCK_PRODUCT_ID = '019596d0-1f1c-7c2e-9a0e-5d0000000001'

/** 다섯 칸이 언제나 있고 합이 100이다 — 계약이 그렇게 보낸다. */
export const MOCK_SUMMARY: RatingSummary = {
  averageTimes100: 435,
  count: 20,
  buckets: [
    { rating: 5, count: 12, percentage: 60 },
    { rating: 4, count: 5, percentage: 25 },
    { rating: 3, count: 2, percentage: 10 },
    { rating: 2, count: 1, percentage: 5 },
    { rating: 1, count: 0, percentage: 0 },
  ],
  photoCount: 2,
}

/** 여섯 건. 밀도 3(5건)에서 「더 보기」가 살아 있어야 하므로 한 장을 넘긴다. */
export const MOCK_REVIEWS: readonly ReviewListEntry[] = [
  entry(1, { helpfulCount: 4, images: [photo(1)] }),
  entry(2, {
    reply: {
      reviewId: reviewId(2),
      brandName: '루미크',
      content: '이용해 주셔서 감사합니다. 다음 입고 때 사이즈를 늘려 보겠습니다.',
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
  }),
  entry(3, { helpfulByMe: true, helpfulCount: 9 }),
  entry(4, { images: [photo(4), photo(5)] }),
  entry(5, { rating: 3 }),
  entry(6, { rating: 2 }),
]

export const MOCK_REVIEWABLE: readonly ReviewableItem[] = [
  {
    orderItemId: '019596d0-1f1c-7c2e-9a0e-610000000001',
    orderId: '019596d0-1f1c-7c2e-9a0e-620000000001',
    orderNumber: 'ORD-20260901-0001',
    productId: MOCK_PRODUCT_ID,
    productName: '울 롱코트',
    optionLabel: '블랙 / M',
    thumbnailUrl: null,
    deliveredAt: '2026-09-01T00:00:00.000Z',
    // `MOCK_NOW` 로부터 12일 뒤. 「12일 남음」이 나온다.
    writableUntil: '2026-09-18T00:00:00.000Z',
  },
  {
    orderItemId: '019596d0-1f1c-7c2e-9a0e-610000000002',
    orderId: '019596d0-1f1c-7c2e-9a0e-620000000001',
    orderNumber: 'ORD-20260901-0001',
    productId: MOCK_PRODUCT_ID,
    productName: '캐시미어 머플러',
    optionLabel: null,
    thumbnailUrl: null,
    deliveredAt: '2026-08-20T00:00:00.000Z',
    // 이미 지났다. 목록을 받은 뒤 시간이 흐른 줄을 흉내 낸다.
    writableUntil: '2026-09-05T00:00:00.000Z',
  },
]

/** 이 파일의 픽스처가 기준으로 삼는 「지금」. 스펙이 시계를 여기에 맞춘다. */
export const MOCK_NOW = new Date('2026-09-06T00:00:00.000Z')

export interface ReviewApiState {
  reviews: ReviewListEntry[]
  summary: RatingSummary
  nextCursor: string | null
  reviewable: ReviewableItem[]
  reviewableNextCursor: string | null
  /** 다음 쓰기 요청 하나를 이렇게 거절한다. 거절하고 나면 비워진다. */
  refuseNextWrite: { status: number; code: string; message: string } | null
  /** 목록 요청을 실패시킨다. 「다시 시도」를 재려면 껐다 켠다. */
  failList: boolean
}

export interface ReviewApiStub {
  readonly state: ReviewApiState
  /** 화면이 실제로 **무엇을 물었나.** 정렬·필터가 서버로 나갔는지는 이것만이 답한다. */
  readonly listQueries: readonly URL[]
  /** 화면이 실제로 **무엇을 보냈나.** 계약 스키마를 지난 본문이다. */
  readonly writes: readonly unknown[]
}

export function stubReviewApi(overrides: Partial<ReviewApiState> = {}): ReviewApiStub {
  const state: ReviewApiState = {
    reviews: [...MOCK_REVIEWS],
    summary: MOCK_SUMMARY,
    nextCursor: null,
    reviewable: [...MOCK_REVIEWABLE],
    reviewableNextCursor: null,
    refuseNextWrite: null,
    failList: false,
    ...overrides,
  }
  const listQueries: URL[] = []
  const writes: unknown[] = []
  const answer = globalThis.fetch

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(hrefOf(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname.slice(API_PATH_PREFIX.length)

    if (!url.pathname.startsWith(API_PATH_PREFIX)) return answer(input, init)

    if (method === 'GET' && /^\/products\/[^/]+\/reviews$/.test(path)) {
      listQueries.push(url)

      if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

      const wanted = state.reviews.filter(
        (review) => url.searchParams.get('photoOnly') !== 'true' || review.images.length > 0,
      )

      return json(
        {
          reviews: sorted(wanted, url.searchParams.get('sort')),
          nextCursor: state.nextCursor,
          summary: state.summary,
        },
        reviewListResponseSchema,
      )
    }

    if (method === 'GET' && path === '/me/reviewable-items') {
      return json(
        { items: state.reviewable, nextCursor: state.reviewableNextCursor },
        reviewableListResponseSchema,
      )
    }

    if (method === 'POST' && path === '/reviews') {
      const body = createReviewRequestSchema.parse(bodyOf(init))
      writes.push(body)

      const refusal = takeRefusal(state)
      if (refusal !== null) return refusal

      return json({ review: writtenReview(body) }, reviewResponseSchema)
    }

    const oneReview = /^\/reviews\/([^/]+)$/.exec(path)

    if (method === 'PATCH' && oneReview !== null) {
      const body = updateReviewRequestSchema.parse(bodyOf(init))
      writes.push(body)

      const refusal = takeRefusal(state)
      if (refusal !== null) return refusal

      return json(
        { review: { ...writtenReview(body), id: oneReview[1] ?? '' } },
        reviewResponseSchema,
      )
    }

    if (method === 'DELETE' && oneReview !== null) {
      const refusal = takeRefusal(state)
      if (refusal !== null) return refusal

      return new Response(null, { status: 204 })
    }

    const helpful = /^\/reviews\/([^/]+)\/helpful$/.exec(path)

    if (helpful !== null && (method === 'POST' || method === 'DELETE')) {
      const id = helpful[1] ?? ''
      const pressed = method === 'POST'
      const held = state.reviews.find((review) => review.id === id)
      const base = held?.helpfulCount ?? 0
      const answered = { helpfulByMe: pressed, helpfulCount: pressed ? base + 1 : base - 1 }

      state.reviews = state.reviews.map((review) =>
        review.id === id ? { ...review, ...answered } : review,
      )

      return json(answered, reviewHelpfulResponseSchema)
    }

    return answer(input, init)
  })

  return { listQueries, state, writes }
}

/** 응답을 **계약 스키마로 한 번 걸러** 내보낸다. 대역이 화면과 함께 틀리지 않게 한다. */
function json(body: unknown, schema: { parse: (value: unknown) => unknown }): Response {
  return new Response(JSON.stringify(schema.parse(body)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function failure(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message, details: [], requestId: 'req-review-stub' } }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function takeRefusal(state: ReviewApiState): Response | null {
  const refusal = state.refuseNextWrite

  if (refusal === null) return null

  state.refuseNextWrite = null

  return failure(refusal.status, refusal.code, refusal.message)
}

/** 정렬은 서버의 일이다. 대역도 **정말로 순서를 바꿔야** 화면이 걸렀는지 알 수 있다. */
function sorted(reviews: readonly ReviewListEntry[], sort: string | null): ReviewListEntry[] {
  if (sort === 'rating') return [...reviews].sort((a, b) => b.rating - a.rating)
  if (sort === 'helpful') return [...reviews].sort((a, b) => b.helpfulCount - a.helpfulCount)

  return [...reviews]
}

function writtenReview(body: {
  readonly rating: number
  readonly content: string
  readonly imageKeys: string[]
}): Review {
  return {
    id: reviewId(9),
    productId: MOCK_PRODUCT_ID,
    rating: body.rating,
    content: body.content,
    status: 'PUBLISHED',
    authorName: '김*민',
    optionLabel: '블랙 / M',
    // 읽기 계약은 `{ key, url }` 이다. 대역도 서버처럼 열쇠를 주소로 바꿔 돌려준다 —
    // 화면이 주소를 조립하지 않는다는 사실이 여기서도 지켜져야 한다.
    images: body.imageKeys.map((key) => ({ key, url: publicUrl(key) })),
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
  }
}

function entry(index: number, overrides: Partial<ReviewListEntry> = {}): ReviewListEntry {
  return {
    id: reviewId(index),
    productId: MOCK_PRODUCT_ID,
    rating: 5,
    content: `${String(index)}번째 리뷰입니다. 두께감이 좋고 마감이 깔끔했습니다.`,
    status: 'PUBLISHED',
    authorName: '김*민',
    optionLabel: '블랙 / M',
    images: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    helpfulCount: 0,
    helpfulByMe: false,
    reply: null,
    ...overrides,
  }
}

function reviewId(index: number): string {
  return `019596d0-1f1c-7c2e-9a0e-63000000000${String(index)}`
}

/** 열쇠와 **주소** — 계약이 읽기에 싣는 모양 그대로 (`reviewImageSchema`). */
function photo(index: number): ReviewImage {
  const key = `reviews/019596d0-1f1c-7c2e-9a0e-640000000001/019596d0-1f1c-7c2e-9a0e-65000000000${String(index)}.jpg`

  return { key, url: publicUrl(key) }
}

/** 저장소의 공개 주소. 진짜 서버도 설정에서 읽어 여기서 붙인다. */
function publicUrl(key: string): string {
  return `${MOCK_STORAGE_PUBLIC_ORIGIN}/${key}`
}

/** 화면이 보낸 본문. `ApiClient` 는 언제나 문자열로 직렬화해 보낸다. */
function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
}

function hrefOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}
