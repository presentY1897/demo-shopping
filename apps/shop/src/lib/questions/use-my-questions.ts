'use client'

import type { ApiFailure, MyQuestion } from '@shopping/shared'
import { QUESTION_LIST_DEFAULT_LIMIT, apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { fetchMyQuestions } from './questions-api'

/**
 * `/mypage/questions` — 내가 남긴 문의 (TASK-0088 F7).
 *
 * **비공개든 아니든 전부 내 것이다.** 상품 상세에서는 비공개 문의가 남에게 보이지
 * 않지만, 여기서는 자기가 쓴 것을 전부 본다 — 그러지 않으면 비공개로 남긴 문의를
 * 다시 볼 자리가 어디에도 없다.
 *
 * 「답변 있음/없음」으로 나누는 탭을 두지 않았다. 계약에 그 질의가 없고
 * (`questionListQueryParamsSchema` 는 커서와 개수뿐), 화면이 받아서 거르면 커서가
 * 「전부」의 커서라 **탭마다 남은 장이 있는지**를 말할 수 없다 — 쿠폰함이 탭을 서버
 * 질의로 둔 것과 같은 이유다 (`use-coupon-box.ts`).
 */

export type MyQuestionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface MyQuestions {
  readonly state: MyQuestionsState
  readonly questions: readonly MyQuestion[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly reload: () => void
}

export function useMyQuestions(): MyQuestions {
  const [state, setState] = useState<MyQuestionsState>({ status: 'loading' })
  const [questions, setQuestions] = useState<readonly MyQuestion[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchMyQuestions(null, QUESTION_LIST_DEFAULT_LIMIT, {
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
  }, [reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setQuestions([])
    setCursor(null)
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return

    setLoadingMore(true)

    async function next(from: string): Promise<void> {
      try {
        const page = await fetchMyQuestions(from, QUESTION_LIST_DEFAULT_LIMIT)

        setQuestions((existing) => [...existing, ...page.questions])
        setCursor(page.nextCursor)
      } catch {
        // 목록은 그대로 남는다. 다시 누르면 같은 커서로 다시 묻는다.
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor, loadingMore])

  return {
    hasMore: state.status === 'ready' && cursor !== null,
    loadMore,
    loadingMore,
    questions,
    reload,
    state,
  }
}
