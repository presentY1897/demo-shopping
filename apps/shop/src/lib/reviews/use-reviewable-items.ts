'use client'

import type {
  ApiFailure,
  CreateReviewRequest,
  Review,
  ReviewableItem,
  UpdateReviewRequest,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { createReview, deleteReview, fetchReviewableItems, updateReview } from './reviews-api'

/**
 * 「리뷰 쓸 수 있는 주문」과 거기서 시작되는 쓰기 (TASK-0083 F6 · F7).
 *
 * ## 목록은 「쓸 수 있는 것」만 담는다
 *
 * 못 쓰는 이유까지 실어 전부 내려보내는 길도 있었지만, 그러면 이 목록이 「배송 중인
 * 주문」 목록과 겹쳐 두 화면이 같은 것을 서로 다르게 말한다
 * (`reviewableListResponseSchema`). 그래서 **거절은 쓰려고 할 때 온다** — 배송이 그
 * 사이에 취소됐거나, 다른 탭에서 이미 썼거나, 기한이 방금 지난 경우다.
 *
 * ## 쓴 뒤에 목록을 다시 읽지 않는다
 *
 * `POST /reviews` 의 답이 만들어진 리뷰를 통째로 싣는다. 그 줄은 이제 「쓸 수 있는
 * 것」이 아니므로 목록에서 빠져야 하는데, 그것을 서버에 다시 물으면 **방금 쓴 리뷰가
 * 화면에서 사라지고** 사람은 자기가 무엇을 썼는지 확인할 자리를 잃는다. 그래서 줄은
 * 그 자리에 남고, 그 자리가 「방금 쓴 리뷰」가 된다.
 *
 * ## 고치고 지우는 것은 **이번에 쓴 것**뿐이다
 *
 * 계약에 `GET /me/reviews` 가 없다. 있는 것은 쓸 수 있는 것의 목록과 리뷰 한 벌을
 * 여는 문(`GET /reviews/:id`)뿐이라, 「내가 쓴 리뷰 전부」를 그리려면 화면이 없는
 * 라우트를 지어내야 한다 — 그러면 서버가 절대 답하지 않는 요청이 생기고 모킹한
 * 검사는 그것을 통과시킨다 (CLAUDE.md 2장). 화면은 그 경계를 문장으로 말한다
 * (`written.sessionOnlyNotice`).
 */

export type ReviewableState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

/** 한 줄에 대해 방금 일어난 일. 줄마다 따로인 것은 실패도 줄마다 다르기 때문이다. */
export type ReviewOutcome =
  { readonly kind: 'written'; readonly review: Review } | { readonly kind: 'deleted' }

export interface ReviewableItems {
  readonly state: ReviewableState
  readonly items: readonly ReviewableItem[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly reload: () => void
  /** `orderItemId` → 이번에 쓴 리뷰, 또는 지웠다는 사실. */
  readonly outcomes: Readonly<Record<string, ReviewOutcome>>
  /** 마지막 쓰기가 거절당했다면 그 거절. 문장은 화면이 `mypage.errors` 에서 고른다. */
  readonly failures: Readonly<Record<string, ApiFailure>>
  /** 지금 서버에 나가 있는 줄. 중복 클릭을 막는 값이다 (U3). */
  readonly pending: string | null
  readonly write: (orderItemId: string, input: ReviewDraft) => Promise<boolean>
  readonly edit: (orderItemId: string, reviewId: string, input: ReviewDraft) => Promise<boolean>
  readonly remove: (orderItemId: string, reviewId: string) => Promise<boolean>
}

/** 폼이 들고 있는 것. 계약의 두 요청이 이 셋을 공유한다. */
export interface ReviewDraft {
  readonly rating: number
  readonly content: string
  readonly imageKeys: readonly string[]
}

export function useReviewableItems(): ReviewableItems {
  const [state, setState] = useState<ReviewableState>({ status: 'loading' })
  const [items, setItems] = useState<readonly ReviewableItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, ReviewOutcome>>>({})
  const [failures, setFailures] = useState<Readonly<Record<string, ApiFailure>>>({})
  const [pending, setPending] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchReviewableItems(null, { signal: controller.signal })
        if (controller.signal.aborted) return

        setItems(page.items)
        setCursor(page.nextCursor)
        setState({ status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setItems([])
    setCursor(null)
    setOutcomes({})
    setFailures({})
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null) return

    setLoadingMore(true)

    async function next(from: string): Promise<void> {
      try {
        const page = await fetchReviewableItems(from)

        // 이어 붙인다. 갈아치우면 「더 보기」가 목록을 지우는 버튼이 된다.
        setItems((existing) => [...existing, ...page.items])
        setCursor(page.nextCursor)
      } catch {
        // 목록은 그대로 남는다. 다시 누르면 같은 커서로 다시 묻는다.
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor])

  /** 셋이 같은 모양으로 끝난다 — 성공하면 결과를, 실패하면 거절을 그 줄에 적는다. */
  const run = useCallback(
    async (orderItemId: string, call: () => Promise<ReviewOutcome>): Promise<boolean> => {
      setPending(orderItemId)
      setFailures((current) => without(current, orderItemId))

      try {
        const outcome = await call()

        setOutcomes((current) => ({ ...current, [orderItemId]: outcome }))

        return true
      } catch (error) {
        setFailures((current) => ({ ...current, [orderItemId]: apiFailure(error) }))

        return false
      } finally {
        setPending(null)
      }
    },
    [],
  )

  const write = useCallback(
    (orderItemId: string, input: ReviewDraft) =>
      run(orderItemId, async () => {
        // 계약이 가변 배열을 요구한다(zod 가 만드는 타입이다). 화면 쪽은 읽기
        // 전용으로 다루므로 여기서 한 번 베낀다.
        const body: CreateReviewRequest = { orderItemId, ...draftBody(input) }

        return { kind: 'written', review: (await createReview(body)).review }
      }),
    [run],
  )

  const edit = useCallback(
    (orderItemId: string, reviewId: string, input: ReviewDraft) =>
      run(orderItemId, async () => {
        const body: UpdateReviewRequest = draftBody(input)

        return { kind: 'written', review: (await updateReview(reviewId, body)).review }
      }),
    [run],
  )

  const remove = useCallback(
    (orderItemId: string, reviewId: string) =>
      run(orderItemId, async () => {
        await deleteReview(reviewId)

        return { kind: 'deleted' }
      }),
    [run],
  )

  return {
    edit,
    failures,
    hasMore: state.status === 'ready' && cursor !== null,
    items,
    loadMore,
    loadingMore,
    outcomes,
    pending,
    reload,
    remove,
    state,
    write,
  }
}

function draftBody(input: ReviewDraft): { rating: number; content: string; imageKeys: string[] } {
  return { rating: input.rating, content: input.content, imageKeys: [...input.imageKeys] }
}

function without(
  current: Readonly<Record<string, ApiFailure>>,
  key: string,
): Readonly<Record<string, ApiFailure>> {
  const { [key]: _removed, ...rest } = current

  return rest
}
