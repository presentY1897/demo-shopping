/**
 * M13 라우트의 대역 — **`@shopping/api-mocks` 가 아니라 여기 있다** (TASK-0086~0091).
 *
 * 그 패키지에는 찜·최근 본 상품·팔로우·문의·알림·신고의 핸들러가 아직 없고, 그것을
 * 더하는 일은 이 갈래의 소유가 아니다 (CLAUDE.md 2장 — 다른 TASK 가 선언한 소유 경로).
 * 그래서 이 파일은 `globalThis.fetch` 를 감싸 **그 경로들만** 가로채고 나머지는 msw 가
 * 그대로 답하게 둔다 — 세션 갱신도, 상품 상세도, 검색도 전부 진짜 대역을 지난다.
 *
 * `test/support/reviews.ts` 가 리뷰 라우트에 대해 먼저 쓴 이음매이고, 이 파일은 그
 * 파일과 **겹쳐 쓸 수 있다**: 나중에 부른 쪽이 앞의 것을 `answer` 로 잡아 두므로 두
 * 대역이 사슬이 된다.
 *
 * 그 파일의 두 규칙을 그대로 지킨다.
 *
 * ① **답은 계약 스키마를 지나서 나간다.** 대역이 만든 응답을 그대로 돌려주면 화면과
 *    대역이 함께 틀린 모양에 합의할 수 있다.
 * ② **요청도 계약으로 읽는다.** 화면이 보낸 본문을 요청 스키마로 파싱하므로, 계약에
 *    없는 필드를 싣거나 필수 필드를 빠뜨리면 검사가 실패한다.
 */

import { SEARCH_CATALOGUE_SELLER_ID } from '@shopping/api-mocks'
import { API_PATH_PREFIX } from '@shopping/shared'
import type {
  FollowedSeller,
  MyQuestion,
  Notification,
  ProductQuestion,
  RecentlyViewedItem,
  WishlistItem,
} from '@shopping/shared'
import {
  createQuestionRequestSchema,
  createReportRequestSchema,
  followIdsResponseSchema,
  followListResponseSchema,
  followResultSchema,
  mergeRecentlyViewedRequestSchema,
  myQuestionsResponseSchema,
  productQuestionResponseSchema,
  questionListResponseSchema,
  notificationListResponseSchema,
  readNotificationsRequestSchema,
  readNotificationsResponseSchema,
  recentlyViewedResponseSchema,
  reportResponseSchema,
  restockAlertResultSchema,
  toggleResultSchema,
  wishlistIdsResponseSchema,
  wishlistResponseSchema,
} from '@shopping/shared'
import { vi } from 'vitest'

import { forgetFollows } from '@/lib/collections/follow-state'
import { resetLocalHistoryCache } from '@/lib/collections/use-recently-viewed'
import { forgetWishlist } from '@/lib/collections/wishlist-state'

/**
 * 모듈 하나에 값 하나인 세 저장소를 처음 상태로 되돌린다.
 *
 * 찜 표와 팔로우 표와 브라우저 이력의 캐시는 **모듈 수준**에 있다 — 그것이 컨텍스트가
 * 아닌 이유는 `wishlist-state.ts` 가 적고 있다. 모듈은 파일 하나에 한 벌이므로, 되돌리지
 * 않으면 한 스펙이 담아 둔 찜이 다음 스펙으로 넘어가 순서에 따라 결과가 달라진다.
 */
export function resetCommunityStores(): void {
  forgetWishlist()
  forgetFollows()
  resetLocalHistoryCache()
}

/** 대역의 상품들. `@shopping/api-mocks` 의 상세 상품과 같은 id 를 하나 쓴다. */
export const MOCK_DETAIL_PRODUCT_ID = '019596d0-1f1c-7c2e-9a0e-100000000003'
export const MOCK_SOLD_OUT_PRODUCT_ID = '019596d0-1f1c-7c2e-9a0e-100000000004'
/**
 * 팔로우하는 가게는 **검색 대역이 실제로 상품을 가진 가게**다.
 *
 * 따로 만든 id 를 쓰면 이 파일 안에서는 아무 문제가 없다 — 팔로우 버튼도 목록도
 * 자기 상태를 잘 그린다. 그런데 홈의 팔로우 줄은 이 id 를 그대로 검색에 넘기므로
 * (TASK-0089 4.5), 카탈로그에 없는 가게였다면 검색이 정직하게 0건을 답하고 줄이
 * 사라진다. 그때 검사가 재는 것은 「줄이 동작한다」가 아니라 **「대역이 가게 필터를
 * 무시한다」**가 된다 — 화면과 대역이 함께 틀린 모양에 합의하는 자리다.
 */
export const MOCK_SELLER_ID = SEARCH_CATALOGUE_SELLER_ID

/** 이 파일의 픽스처가 기준으로 삼는 「지금」. */
export const MOCK_NOW = new Date('2026-09-06T00:00:00.000Z')

/**
 * 찜 두 줄.
 *
 * 첫 줄은 **담을 때보다 싸졌고**(F5), 둘째 줄은 품절이라 재입고 알림을 걸 수 있다
 * (F4). 둘이 이 화면의 두 가지 「그 사이에 무엇이 바뀌었나」다.
 */
export const MOCK_WISHLIST: readonly WishlistItem[] = [
  {
    productId: MOCK_DETAIL_PRODUCT_ID,
    productName: '울 블렌드 코트',
    brandName: '루미크',
    thumbnailUrl: null,
    price: 89_000,
    addedPrice: 99_000,
    soldOut: false,
    notifyRestock: false,
    addedAt: '2026-09-01T00:00:00.000Z',
  },
  {
    productId: MOCK_SOLD_OUT_PRODUCT_ID,
    productName: '캐시미어 머플러',
    brandName: '루미크',
    thumbnailUrl: null,
    price: null,
    addedPrice: 49_000,
    soldOut: true,
    notifyRestock: false,
    addedAt: '2026-08-20T00:00:00.000Z',
  },
]

export const MOCK_RECENT: readonly RecentlyViewedItem[] = [
  {
    productId: MOCK_DETAIL_PRODUCT_ID,
    productName: '울 블렌드 코트',
    brandName: '루미크',
    thumbnailUrl: null,
    price: 89_000,
    viewedAt: '2026-09-05T09:00:00.000Z',
  },
  {
    productId: MOCK_SOLD_OUT_PRODUCT_ID,
    productName: '캐시미어 머플러',
    brandName: '루미크',
    thumbnailUrl: null,
    price: null,
    viewedAt: '2026-09-04T09:00:00.000Z',
  },
]

export const MOCK_FOLLOWS: readonly FollowedSeller[] = [
  {
    sellerId: MOCK_SELLER_ID,
    brandName: '루미크',
    slug: 'lumique',
    logoUrl: null,
    followerCount: 128,
    followedAt: '2026-09-01T00:00:00.000Z',
  },
]

/**
 * 팔로우 `count` 곳, **최근에 팔로우한 순서가 곧 배열의 순서**가 되도록.
 *
 * 두 곳에서 쓴다: 한 쪽에 안 들어가는 수(`FOLLOW_LIST_MAX_LIMIT` 초과)를 만드는
 * 검사와, 홈의 줄이 계약 상한(`SEARCH_SELLER_IDS_MAX`)까지만 넘기는지를 재는 검사다.
 */
export function bulkFollows(count: number): FollowedSeller[] {
  return Array.from({ length: count }, (_unused, index) => ({
    sellerId: `019596d0-1f1c-7c2e-9a0e-91${String(index).padStart(10, '0')}`,
    brandName: `브랜드 ${String(index)}`,
    slug: `brand-${String(index)}`,
    logoUrl: null,
    followerCount: 10,
    // 뒤에 있는 것이 **더 오래된** 팔로우다. 답이 최근 순이므로 배열의 앞이 최근이 된다.
    followedAt: new Date(Date.UTC(2026, 0, 1) + (count - index) * 1_000).toISOString(),
  }))
}

/**
 * 문의 셋.
 *
 * 답변이 달린 공개 문의, 답변을 기다리는 공개 문의, **내가 남긴 비공개 문의**.
 * 셋째가 있는 이유는 「비공개인데 내 것이라 보인다」가 F2 의 반대편이기 때문이다 —
 * 남의 비공개 문의는 애초에 목록에 오지 않으므로 픽스처로 만들 수도 없다.
 */
export const MOCK_QUESTIONS: readonly ProductQuestion[] = [
  {
    id: '019596d0-1f1c-7c2e-9a0e-710000000001',
    productId: MOCK_DETAIL_PRODUCT_ID,
    authorName: '김*민',
    content: '어깨 너비가 실측으로 몇 cm 인가요?',
    isPublic: true,
    mine: false,
    answer: {
      questionId: '019596d0-1f1c-7c2e-9a0e-710000000001',
      brandName: '루미크',
      content: 'M 사이즈 기준 46cm 입니다.',
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  },
  {
    id: '019596d0-1f1c-7c2e-9a0e-710000000002',
    productId: MOCK_DETAIL_PRODUCT_ID,
    authorName: '이*수',
    content: '재입고 예정이 있을까요?',
    isPublic: true,
    mine: false,
    answer: null,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  },
  {
    id: '019596d0-1f1c-7c2e-9a0e-710000000003',
    productId: MOCK_DETAIL_PRODUCT_ID,
    authorName: '박*진',
    content: '주문한 상품의 배송지를 바꾸고 싶습니다.',
    isPublic: false,
    mine: true,
    answer: null,
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
  },
]

export const MOCK_MY_QUESTIONS: readonly MyQuestion[] = MOCK_QUESTIONS.filter(
  (question) => question.mine,
).map((question) => ({ ...question, productName: '울 블렌드 코트', thumbnailUrl: null }))

/**
 * 알림 셋.
 *
 * 마지막 하나가 `SELLER_SETTLEMENT` 인 것이 의도다 — 한 계정이 두 역할을 가질 수
 * 있으므로 상점의 알림함에 판매자 알림이 섞여 올 수 있고, **상점은 그것을 그리지
 * 않아야 한다** (`notification-scope.ts`).
 */
export const MOCK_NOTIFICATIONS: readonly Notification[] = [
  {
    id: '019596d0-1f1c-7c2e-9a0e-720000000001',
    type: 'ORDER_STATUS',
    title: '주문이 발송되었습니다',
    body: '울 블렌드 코트가 오늘 출고되었습니다.',
    link: '/mypage/orders/019596d0-1f1c-7c2e-9a0e-620000000001',
    readAt: null,
    createdAt: '2026-09-05T00:00:00.000Z',
  },
  {
    id: '019596d0-1f1c-7c2e-9a0e-720000000002',
    type: 'QUESTION_ANSWER',
    title: '문의에 답변이 달렸습니다',
    body: '남기신 문의에 판매자가 답변했습니다.',
    link: null,
    readAt: null,
    createdAt: '2026-09-04T00:00:00.000Z',
  },
  {
    id: '019596d0-1f1c-7c2e-9a0e-720000000003',
    type: 'SELLER_SETTLEMENT',
    title: '정산이 지급되었습니다',
    body: '판매자 콘솔에서 확인하세요.',
    link: '/settlements',
    readAt: null,
    createdAt: '2026-09-03T00:00:00.000Z',
  },
]

export interface CommunityApiState {
  wishlist: WishlistItem[]
  wishlistNextCursor: string | null
  recent: RecentlyViewedItem[]
  follows: FollowedSeller[]
  followsNextCursor: string | null
  questions: ProductQuestion[]
  questionsNextCursor: string | null
  myQuestions: MyQuestion[]
  notifications: Notification[]
  notificationsNextCursor: string | null
  /** 다음 쓰기 요청 하나를 이렇게 거절한다. 거절하고 나면 비워진다. */
  refuseNextWrite: { status: number; code: string; message: string } | null
  /** 목록 요청을 실패시킨다. 「다시 시도」를 재려면 껐다 켠다. */
  failList: boolean
}

export interface CommunityApiStub {
  readonly state: CommunityApiState
  /** 화면이 실제로 **무엇을 물었나.** 질의가 서버로 나갔는지는 이것만이 답한다. */
  readonly requests: readonly { method: string; url: URL }[]
  /** 화면이 실제로 **무엇을 보냈나.** 계약 스키마를 지난 본문이다. */
  readonly writes: readonly unknown[]
}

export function stubCommunityApi(overrides: Partial<CommunityApiState> = {}): CommunityApiStub {
  const state: CommunityApiState = {
    wishlist: [...MOCK_WISHLIST],
    wishlistNextCursor: null,
    recent: [...MOCK_RECENT],
    follows: [...MOCK_FOLLOWS],
    followsNextCursor: null,
    questions: [...MOCK_QUESTIONS],
    questionsNextCursor: null,
    myQuestions: [...MOCK_MY_QUESTIONS],
    notifications: [...MOCK_NOTIFICATIONS],
    notificationsNextCursor: null,
    refuseNextWrite: null,
    failList: false,
    ...overrides,
  }
  const requests: { method: string; url: URL }[] = []
  const writes: unknown[] = []
  const answer = globalThis.fetch

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(hrefOf(input))

    if (!url.pathname.startsWith(API_PATH_PREFIX)) return answer(input, init)

    const method = init?.method ?? 'GET'
    const path = url.pathname.slice(API_PATH_PREFIX.length)
    const handled = route(state, requests, writes, method, path, url, init)

    return handled ?? answer(input, init)
  })

  return { requests, state, writes }
}

/** 라우트 표 하나다. 갈래를 함수로 쪼개면 어느 경로가 대역에 있는지 한눈에 보이지 않는다. */
function route(
  state: CommunityApiState,
  requests: { method: string; url: URL }[],
  writes: unknown[],
  method: string,
  path: string,
  url: URL,
  init: RequestInit | undefined,
): Response | null {
  requests.push({ method, url })

  const refusal = (): Response | null => takeRefusal(state)

  /**
   * 「무엇을 담았나」의 **완전한** 답 (TASK-0086 4.5).
   *
   * 목록과 달리 한 쪽으로 끊지 않는다 — 그것이 계약의 요점이고, 그래서 아래
   * `/me/wishlist` 가 `limit` 으로 잘라 내는 것과 나란히 두면 둘의 차이가 보인다.
   */
  if (path === '/me/wishlist/ids' && method === 'GET') {
    if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

    return json(
      { productIds: state.wishlist.map((item) => item.productId) },
      wishlistIdsResponseSchema,
    )
  }

  /** 팔로우한 가게의 id, **최근에 팔로우한 순서로** (TASK-0089 4.4). */
  if (path === '/me/follows/ids' && method === 'GET') {
    if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

    return json(
      {
        sellerIds: [...state.follows]
          .sort((a, b) => Date.parse(b.followedAt) - Date.parse(a.followedAt))
          .map((seller) => seller.sellerId),
      },
      followIdsResponseSchema,
    )
  }

  const restock = /^\/me\/wishlist\/([^/]+)\/restock-alert$/.exec(path)

  if (restock !== null && (method === 'POST' || method === 'DELETE')) {
    const productId = restock[1] ?? ''
    const wanted = method === 'POST'
    const denied = refusal()

    if (denied !== null) return denied

    state.wishlist = state.wishlist.map((item) =>
      item.productId === productId ? { ...item, notifyRestock: wanted } : item,
    )

    return json({ notifyRestock: wanted }, restockAlertResultSchema)
  }

  const wishlistItem = /^\/me\/wishlist\/([^/]+)$/.exec(path)

  if (wishlistItem !== null && method === 'POST') {
    const productId = wishlistItem[1] ?? ''
    const denied = refusal()

    if (denied !== null) return denied

    const held = state.wishlist.some((item) => item.productId === productId)

    if (held) state.wishlist = state.wishlist.filter((item) => item.productId !== productId)

    return json({ active: !held }, toggleResultSchema)
  }

  if (path === '/me/wishlist' && method === 'GET') {
    if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

    // **`limit` 을 실제로 지킨다.** 목록이 한 쪽으로 끊긴다는 사실이 이 대역에서
    // 없으면, 101개를 담은 사람의 화면이 왜 틀렸는지를 재현할 수 없다 (4.5).
    const limit = Number(url.searchParams.get('limit') ?? '20')
    const shown = state.wishlist.slice(0, limit)

    return json(
      {
        items: shown,
        nextCursor:
          state.wishlistNextCursor ?? (shown.length < state.wishlist.length ? 'next' : null),
      },
      wishlistResponseSchema,
    )
  }

  if (path === '/me/recently-viewed' && method === 'GET') {
    if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

    return json({ items: state.recent }, recentlyViewedResponseSchema)
  }

  if (path === '/me/recently-viewed' && method === 'POST') {
    const body = mergeRecentlyViewedRequestSchema.parse(bodyOf(init))

    writes.push(body)

    // 서버처럼 **더 최근 쪽이 이기게** 합친다. 그냥 이어 붙이면 화면이 병합의
    // 결과를 그리는지 자기가 보낸 것을 그리는지 알 수 없다.
    const merged = new Map(state.recent.map((item) => [item.productId, item]))

    for (const sent of body.items) {
      const held = merged.get(sent.productId)

      // 모르는 상품은 건너뛴다 — 서버가 하는 일과 같다.
      if (held === undefined) continue
      if (Date.parse(sent.viewedAt) > Date.parse(held.viewedAt)) {
        merged.set(sent.productId, { ...held, viewedAt: sent.viewedAt })
      }
    }

    state.recent = [...merged.values()].sort(
      (a, b) => Date.parse(b.viewedAt) - Date.parse(a.viewedAt),
    )

    return json({ items: state.recent }, recentlyViewedResponseSchema)
  }

  const viewed = /^\/me\/recently-viewed\/([^/]+)$/.exec(path)

  if (viewed !== null && method === 'DELETE') {
    const denied = refusal()

    if (denied !== null) return denied

    state.recent = state.recent.filter((item) => item.productId !== viewed[1])

    return new Response(null, { status: 204 })
  }

  if (path === '/me/recently-viewed' && method === 'DELETE') {
    const denied = refusal()

    if (denied !== null) return denied

    state.recent = []

    return new Response(null, { status: 204 })
  }

  const follow = /^\/me\/follows\/([^/]+)$/.exec(path)

  if (follow !== null && method === 'POST') {
    const sellerId = follow[1] ?? ''
    const denied = refusal()

    if (denied !== null) return denied

    const held = state.follows.find((seller) => seller.sellerId === sellerId)

    if (held === undefined) {
      state.follows = [
        ...state.follows,
        {
          sellerId,
          brandName: '루미크',
          slug: 'lumique',
          logoUrl: null,
          followerCount: 1,
          followedAt: MOCK_NOW.toISOString(),
        },
      ]

      return json({ active: true, followerCount: 1 }, followResultSchema)
    }

    state.follows = state.follows.filter((seller) => seller.sellerId !== sellerId)

    return json(
      { active: false, followerCount: Math.max(0, held.followerCount - 1) },
      followResultSchema,
    )
  }

  if (path === '/me/follows' && method === 'GET') {
    if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

    const limit = Number(url.searchParams.get('limit') ?? '20')
    const shown = state.follows.slice(0, limit)

    return json(
      {
        sellers: shown,
        nextCursor:
          state.followsNextCursor ?? (shown.length < state.follows.length ? 'next' : null),
      },
      followListResponseSchema,
    )
  }

  const productQuestions = /^\/products\/([^/]+)\/questions$/.exec(path)

  if (productQuestions !== null && method === 'GET') {
    if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

    return json(
      { questions: state.questions, nextCursor: state.questionsNextCursor },
      questionListResponseSchema,
    )
  }

  if (productQuestions !== null && method === 'POST') {
    const body = createQuestionRequestSchema.parse(bodyOf(init))

    writes.push(body)

    const denied = refusal()

    if (denied !== null) return denied

    return json(
      { question: written(productQuestions[1] ?? '', body) },
      productQuestionResponseSchema,
    )
  }

  if (path === '/me/questions' && method === 'GET') {
    if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

    return json({ questions: state.myQuestions, nextCursor: null }, myQuestionsResponseSchema)
  }

  if (path === '/me/notifications' && method === 'GET') {
    if (state.failList) return failure(500, 'INTERNAL_ERROR', '서버에서 문제가 생겼어요.')

    const unreadOnly = url.searchParams.get('unreadOnly') === 'true'
    const shown = state.notifications.filter(
      (notification) => !unreadOnly || notification.readAt === null,
    )

    return json(
      {
        notifications: shown.slice(0, Number(url.searchParams.get('limit') ?? '20')),
        nextCursor: state.notificationsNextCursor,
        unreadCount: state.notifications.filter((one) => one.readAt === null).length,
      },
      notificationListResponseSchema,
    )
  }

  if (path === '/me/notifications/read' && method === 'POST') {
    const body = readNotificationsRequestSchema.parse(bodyOf(init))

    writes.push(body)

    const denied = refusal()

    if (denied !== null) return denied

    const at = MOCK_NOW.toISOString()

    state.notifications = state.notifications.map((notification) =>
      (body.ids === undefined || body.ids.includes(notification.id)) && notification.readAt === null
        ? { ...notification, readAt: at }
        : notification,
    )

    return json(
      { unreadCount: state.notifications.filter((one) => one.readAt === null).length },
      readNotificationsResponseSchema,
    )
  }

  if (path === '/reports' && method === 'POST') {
    const body = createReportRequestSchema.parse(bodyOf(init))

    writes.push(body)

    const denied = refusal()

    if (denied !== null) return denied

    return json(
      {
        report: {
          id: '019596d0-1f1c-7c2e-9a0e-730000000001',
          targetType: body.targetType,
          targetId: body.targetId,
          reason: body.reason,
          detail: body.detail ?? null,
          status: 'PENDING',
          targetReportCount: 1,
          targetHidden: false,
          targetExcerpt: null,
          handledNote: null,
          handledAt: null,
          createdAt: MOCK_NOW.toISOString(),
        },
      },
      reportResponseSchema,
    )
  }

  requests.pop()

  return null
}

function written(
  productId: string,
  body: { readonly content: string; readonly isPublic: boolean },
): ProductQuestion {
  return {
    id: '019596d0-1f1c-7c2e-9a0e-710000000009',
    productId,
    authorName: '박*진',
    content: body.content,
    isPublic: body.isPublic,
    mine: true,
    answer: null,
    createdAt: MOCK_NOW.toISOString(),
    updatedAt: MOCK_NOW.toISOString(),
  }
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
    JSON.stringify({ error: { code, message, details: [], requestId: 'req-community-stub' } }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function takeRefusal(state: CommunityApiState): Response | null {
  const refusal = state.refuseNextWrite

  if (refusal === null) return null

  state.refuseNextWrite = null

  return failure(refusal.status, refusal.code, refusal.message)
}

/** 화면이 보낸 본문. `ApiClient` 는 언제나 문자열로 직렬화해 보낸다. */
function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
}

function hrefOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}
