'use client'

import type { ApiFailure, RatingSummary, ReviewListEntry, ReviewSortKey } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { REVIEW_PAGE_SIZE } from './exposure'
import { fetchProductReviews, voteHelpful } from './reviews-api'

/**
 * 상품 상세의 리뷰 목록과 평점 요약 (TASK-0084 F1 · F6).
 *
 * ## 정렬·필터가 바뀌면 다시 부른다
 *
 * 셋 다 서버가 받는 질의다(`reviewListQueryParamsSchema`). 조건이 바뀌면 그것은 다른
 * 질문이고, 지금까지 이어 붙인 것은 **다른 질문의 답**이라 버려야 한다 — 남겨 두면
 * 「사진 리뷰만」을 켰는데 사진 없는 리뷰가 화면에 남는다. 주문 내역이 같은 판단을
 * 하고 그 이유가 `use-order-history.ts` 에 적혀 있다.
 *
 * **요약은 그 규칙의 예외다.** `summary` 는 필터와 무관한 사실이라
 * (`ratingSummarySchema`) 매 응답이 같은 값을 싣고, 화면은 그것을 필터 옆에 그대로
 * 그린다 — 필터를 켤 때마다 분포가 흔들리면 사람은 그것을 「이 필터 안에서의 분포」로
 * 읽는다.
 *
 * ## 밀도는 여기 없다
 *
 * 받아 오는 양은 밀도와 무관하게 `REVIEW_PAGE_SIZE` 하나다. 밀도가 정하는 것은
 * **그중 몇 개를 보일지**뿐이고(`exposure.ts`), 단계마다 다시 부르면 전환이 느려지고
 * 캐시가 세 벌이 된다 (`pages.md` — 상품 카드의 같은 판단).
 *
 * ## 도움돼요는 답을 그대로 쓴다
 *
 * `POST`/`DELETE` 가 `{ helpfulCount, helpfulByMe }` 를 돌려주므로 화면이 직접 세지
 * 않는다. 세면 두 번 눌러도 한 번인 서버의 규칙이 화면에서 두 번이 되고, 다른 탭에서
 * 누른 것도 반영되지 않는다.
 */

export type ProductReviewsStatus =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface ProductReviews {
  readonly state: ProductReviewsStatus
  readonly reviews: readonly ReviewListEntry[]
  /** 첫 장이 오기 전에는 `null`. 평균과 분포는 **필터와 무관하다.** */
  readonly summary: RatingSummary | null
  readonly sort: ReviewSortKey
  readonly photoOnly: boolean
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly setSort: (sort: ReviewSortKey) => void
  readonly setPhotoOnly: (photoOnly: boolean) => void
  readonly loadMore: () => void
  readonly reload: () => void
  /**
   * 도움돼요를 누르거나 무른다. 로그인하지 않은 사람은 이 자리에 오지 않는다.
   *
   * **지금 눌러 둔 상태를 인수로 받는다.** 목록에서 다시 찾으면 그 목록을 콜백의
   * 의존 목록에 넣어야 하고, 그러면 리뷰 한 장이 바뀔 때마다 버튼 스무 개가 전부
   * 다시 그려진다 — 누른 버튼 자신이 이미 알고 있는 값이다.
   */
  readonly toggleHelpful: (reviewId: string, pressed: boolean) => void
  /** 마지막 도움돼요가 실패했는가. 목록은 그대로이고 이 줄만 붙는다 (U6). */
  readonly helpfulFailed: boolean
}

/** 어느 요청의 결과인가. 조건이 바뀌면 지난 결과는 **다른 질문의 답**이 된다. */
interface Settled {
  readonly key: string
  readonly state: ProductReviewsStatus
}

export function useProductReviews(
  productId: string,
  /** 미니멀 단계는 사람이 펼치기 전까지 아무것도 묻지 않는다 (`exposure.ts`). */
  enabled: boolean,
): ProductReviews {
  const [settled, setSettled] = useState<Settled | null>(null)
  const [reviews, setReviews] = useState<readonly ReviewListEntry[]>([])
  const [summary, setSummary] = useState<RatingSummary | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [sort, setSortState] = useState<ReviewSortKey>('latest')
  const [photoOnly, setPhotoOnlyState] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [helpfulFailed, setHelpfulFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const requestKey = `${productId}|${sort}|${String(photoOnly)}#${String(reloadToken)}`

  /**
   * 「기다리는 중」은 **저장하지 않고 유도한다.**
   *
   * 조건이 바뀌면 화면은 그 순간부터 기다리는 중인데, 그것을 효과 안에서
   * `setState` 로 적으면 렌더 한 번이 더 돈다(`react-hooks/set-state-in-effect`).
   */
  const state: ProductReviewsStatus =
    settled?.key === requestKey ? settled.state : { status: 'loading' }

  /**
   * 이미 요청한 커서. 「더 보기」를 연달아 누르면 같은 장이 두 벌 들어간다 —
   * `loadingMore` 만으로는 그 사이의 경주를 막지 못한다(상태는 다음 렌더에서야 보인다).
   */
  const requested = useRef<string | null>(null)
  /** 「더 보기」가 읽는 지금의 조건. 첫 장과 **같은 조건**이어야 커서가 뜻을 갖는다. */
  const current = useRef({ photoOnly, sort })

  useEffect(() => {
    if (!enabled) return undefined

    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchProductReviews(
          productId,
          { sort, photoOnly, limit: REVIEW_PAGE_SIZE },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return

        // 이어 붙이지 않고 **갈아 끼운다.** 조건이 바뀌었으면 지금까지의 것은 다른
        // 질문의 답이다.
        setReviews(page.reviews)
        setSummary(page.summary)
        setCursor(page.nextCursor)
        requested.current = null
        current.current = { photoOnly, sort }
        setSettled({ key: requestKey, state: { status: 'ready' } })
      } catch (error) {
        if (controller.signal.aborted) return
        setSettled({ key: requestKey, state: { status: 'error', failure: apiFailure(error) } })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
    // `requestKey` 가 「지금 무엇을 묻고 있나」의 전부다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sort·photoOnly·productId 는 requestKey 안에 들어 있다.
  }, [enabled, requestKey])

  const setSort = useCallback((next: ReviewSortKey) => {
    setSortState(next)
    setCursor(null)
    requested.current = null
  }, [])

  const setPhotoOnly = useCallback((next: boolean) => {
    setPhotoOnlyState(next)
    setCursor(null)
    requested.current = null
  }, [])

  const reload = useCallback(() => {
    setCursor(null)
    requested.current = null
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || requested.current === cursor) return

    requested.current = cursor
    setLoadingMore(true)

    async function next(from: string): Promise<void> {
      try {
        const page = await fetchProductReviews(productId, {
          ...current.current,
          cursor: from,
          limit: REVIEW_PAGE_SIZE,
        })

        // 이어 붙인다. 갈아치우면 「더 보기」가 목록을 지우는 버튼이 된다.
        setReviews((existing) => [...existing, ...page.reviews])
        setCursor(page.nextCursor)
      } catch {
        // 같은 커서를 다시 시도할 수 있어야 한다. 실패한 요청이 그 장을 영원히
        // 잠그면 사람이 할 수 있는 일이 새로고침뿐이 된다.
        requested.current = null
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor, productId])

  const toggleHelpful = useCallback((reviewId: string, pressed: boolean) => {
    setHelpfulFailed(false)

    async function vote(): Promise<void> {
      try {
        // 지금 상태의 반대를 청하고, **화면이 세지 않고 답을 그대로 쓴다.**
        const answer = await voteHelpful(reviewId, !pressed)

        setReviews((existing) =>
          existing.map((review) =>
            review.id === reviewId
              ? { ...review, helpfulByMe: answer.helpfulByMe, helpfulCount: answer.helpfulCount }
              : review,
          ),
        )
      } catch {
        setHelpfulFailed(true)
      }
    }

    void vote()
  }, [])

  return {
    hasMore: state.status === 'ready' && cursor !== null,
    helpfulFailed,
    loadMore,
    loadingMore,
    photoOnly,
    reload,
    reviews,
    setPhotoOnly,
    setSort,
    sort,
    state,
    summary,
    toggleHelpful,
  }
}
