'use client'

import type { ApiFailure, ProductQuestion } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { QUESTION_PAGE_SIZE } from './qna-exposure'
import { askQuestion, fetchProductQuestions } from './questions-api'

/**
 * 상품 상세의 문의 목록과 작성 (TASK-0088 F1 · F2 · F6).
 *
 * ## 밀도는 여기 없다
 *
 * 받아 오는 양은 밀도와 무관하게 `QUESTION_PAGE_SIZE` 하나다. 밀도가 정하는 것은
 * **그중 몇 개를 보일지**뿐이고(`qna-exposure.ts`), 단계마다 다시 부르면 전환이
 * 느려지고 캐시가 세 벌이 된다. 리뷰가 같은 판단을 같은 이유로 한다.
 *
 * ## 쓴 문의는 목록 맨 앞에 끼워 넣는다
 *
 * 답이 만들어진 문의를 통째로 싣는다(`productQuestionResponseSchema`). 다시 읽지
 * 않는 이유는 **비공개로 남긴 문의가 다음 장으로 밀릴 수 있기** 때문이다 — 그러면
 * 방금 쓴 것이 화면에서 사라지고, 사람은 저장되지 않았다고 읽는다.
 *
 * ## 남의 비공개 문의는 목록에 없다
 *
 * 서버가 줄 자체를 보내지 않으므로(`questions.ts`), 화면은 「비공개 문의입니다」
 * 자리를 만들지 않는다. 만들려면 몇 개가 감춰졌는지 세어야 하고, 그 수 자체가
 * 알아서는 안 될 것이다.
 */

export type ProductQuestionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface ProductQuestions {
  readonly state: ProductQuestionsState
  readonly questions: readonly ProductQuestion[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly reload: () => void
  /** 지금 서버에 나가 있는가. 중복 제출을 막는 값이다 (U3). */
  readonly asking: boolean
  /** 마지막 작성이 실패했다면 그 거절. 문장은 화면이 고른다. */
  readonly askFailure: ApiFailure | null
  /** 참을 돌려주면 폼이 비워진다. 거짓이면 사람이 쓴 것은 그대로 남는다 (U6). */
  readonly ask: (content: string, isPublic: boolean) => Promise<boolean>
}

export function useProductQuestions(productId: string, enabled: boolean): ProductQuestions {
  const [state, setState] = useState<ProductQuestionsState>({ status: 'loading' })
  const [questions, setQuestions] = useState<readonly ProductQuestion[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [asking, setAsking] = useState(false)
  const [askFailure, setAskFailure] = useState<ApiFailure | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!enabled) return undefined

    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchProductQuestions(productId, null, QUESTION_PAGE_SIZE, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return

        setQuestions(page.questions)
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
  }, [enabled, productId, reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setCursor(null)
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return

    setLoadingMore(true)

    async function next(from: string): Promise<void> {
      try {
        const page = await fetchProductQuestions(productId, from, QUESTION_PAGE_SIZE)

        setQuestions((existing) => [...existing, ...page.questions])
        setCursor(page.nextCursor)
      } catch {
        // 목록은 그대로 남는다. 다시 누르면 같은 커서로 다시 묻는다.
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor, loadingMore, productId])

  const ask = useCallback(
    async (content: string, isPublic: boolean): Promise<boolean> => {
      setAsking(true)
      setAskFailure(null)

      try {
        const answer = await askQuestion(productId, { content, isPublic })

        setQuestions((existing) => [answer.question, ...existing])

        return true
      } catch (error) {
        setAskFailure(apiFailure(error))

        return false
      } finally {
        setAsking(false)
      }
    },
    [productId],
  )

  return {
    ask,
    askFailure,
    asking,
    hasMore: state.status === 'ready' && cursor !== null,
    loadMore,
    loadingMore,
    questions,
    reload,
    state,
  }
}
