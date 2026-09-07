'use client'

import type { ApiFailure, SellerProductReview } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useRef, useState } from 'react'

import { deleteReviewReply, fetchSellerProductReviews, writeReviewReply } from './console-api'
import type { SellerReviewFilters } from './review-console'
import { EMPTY_REVIEW_FILTERS, isNarrowed, reviewSearch } from './review-console'

/**
 * 내 상품에 달린 리뷰 한 페이지, 그 위의 두 필터, 그리고 두 개의 쓰기 (TASK-0085).
 *
 * `use-seller-coupons.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지 않고,
 * 커서는 `useCursorPagination` 이 들고, 필터가 바뀌면 첫 페이지로 돌아가며, 쓰기가
 * 끝나면 목록을 **조용히** 다시 읽는다. **닮은 훅을 새 규약으로 쓰지 않는 것**이 이
 * 파일의 첫 번째 규칙이다.
 *
 * **`sellerId` 를 인자로 받는다.** 훅 안에서 세션을 읽지 않는 이유는 그 판단이
 * **화면의 것**이기 때문이다: 스토어가 없는 계정에는 이 훅을 아예 마운트하지 않고
 * 입점 신청으로 안내한다. 그 계정으로 목록을 부르면 「리뷰가 없어요」가 아니라
 * 「불러오지 못했습니다」로 끝난다.
 *
 * **조용한 다시 읽기가 필요한 이유가 이 화면에서는 특히 분명하다.** 답변을 쓰면
 * 서버가 답변 하나를 돌려주지만, 목록의 줄에는 그것 말고도 **미답변 건수**가 걸려
 * 있다(F7). 그 수는 서버가 세고, 방금 답한 한 건이 거기서 빠지는 것을 화면이 손으로
 * 계산하면 두 번째 탭에서 답한 건은 영영 반영되지 않는다.
 */

export type SellerProductReviewsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly SellerProductReview[]
      readonly nextCursor: string | null
      /**
       * 아직 답하지 않은 리뷰의 수. **필터와 무관하다** (F7).
       *
       * 계약이 그렇게 보낸다(`sellerProductReviewsResponseSchema`). 「미답변만」을 켜면
       * 줄어드는 뱃지는 할 일을 숨기고, 그 순간 뱃지는 「할 일이 몇 개」가 아니라
       * 「지금 화면에 몇 개」가 된다 — 그것은 목록이 이미 답하는 물음이다.
       */
      readonly unansweredCount: number
    }

/**
 * 쓰기 하나의 결말.
 *
 * 던지지 않는다 — 부르는 쪽이 계속 그려야 하고, 실패는 `ApiFailure` 로 화면에 닿아야
 * 문장을 카탈로그가 정한다 (TASK-0117).
 */
export type ReviewReplyWrite =
  { readonly ok: true } | { readonly ok: false; readonly failure: ApiFailure }

export interface SellerProductReviewsController {
  readonly state: SellerProductReviewsState
  readonly filters: SellerReviewFilters
  readonly setFilters: (filters: SellerReviewFilters) => void
  readonly isFiltered: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
  /** 답변을 쓰거나 고친다. 문이 하나인 것이 계약의 판단이다 (F3). */
  readonly saveReply: (reviewId: string, content: string) => Promise<ReviewReplyWrite>
  /** 답변을 지운다. 리뷰는 남는다. */
  readonly removeReply: (reviewId: string) => Promise<ReviewReplyWrite>
  /** 지금 쓰기가 나가 있는 리뷰의 id. 그 줄의 버튼만 잠근다 (U3). */
  readonly pendingId: string | null
}

export function useSellerProductReviews(sellerId: string): SellerProductReviewsController {
  const [state, setState] = useState<SellerProductReviewsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<SellerReviewFilters>(EMPTY_REVIEW_FILTERS)
  const [reloadToken, setReloadToken] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)

  /** 화면을 스켈레톤으로 되돌리지 않아야 하는 다시 읽기. */
  const silent = useRef(false)

  const paging = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = paging

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      if (!silent.current) setState({ status: 'loading' })
      silent.current = false

      try {
        const page = await fetchSellerProductReviews(reviewSearch(sellerId, filters, cursor), {
          signal: controller.signal,
        })

        if (controller.signal.aborted) return

        setState({
          items: page.reviews,
          nextCursor: page.nextCursor,
          status: 'ready',
          unansweredCount: page.unansweredCount,
        })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sellerId, filters, cursor, reloadToken])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * 커서는 **그 정렬과 그 필터 안에서만** 위치를 뜻한다. 넘겨받은 커서를 그대로 쓰면
   * 이제 존재하지 않는 목록을 이어 달라고 하는 셈이다.
   */
  const setFilters = useCallback(
    (next: SellerReviewFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  /** 쓰기가 끝난 뒤 목록을 다시 읽되, 스켈레톤으로 되돌리지 않는다. */
  const refresh = useCallback(() => {
    silent.current = true
    setReloadToken((token) => token + 1)
  }, [])

  const saveReply = useCallback(
    async (reviewId: string, content: string): Promise<ReviewReplyWrite> => {
      setPendingId(reviewId)

      try {
        await writeReviewReply(reviewId, content)

        refresh()

        return { ok: true }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      } finally {
        setPendingId(null)
      }
    },
    [refresh],
  )

  const removeReply = useCallback(
    async (reviewId: string): Promise<ReviewReplyWrite> => {
      setPendingId(reviewId)

      try {
        await deleteReviewReply(reviewId)

        refresh()

        return { ok: true }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      } finally {
        setPendingId(null)
      }
    },
    [refresh],
  )

  return {
    filters,
    isFiltered: isNarrowed(filters),
    pagination: paging,
    pendingId,
    reload,
    removeReply,
    saveReply,
    setFilters,
    state,
  }
}
