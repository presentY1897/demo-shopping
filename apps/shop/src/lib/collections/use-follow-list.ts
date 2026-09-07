'use client'

import type { ApiFailure, FollowedSeller } from '@shopping/shared'
import { FOLLOW_LIST_DEFAULT_LIMIT, apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { fetchFollows, toggleFollow } from './collections-api'
import { publishFollow, publishFollowPage } from './follow-state'

/**
 * `/mypage/following` — 팔로우한 브랜드 (TASK-0089).
 *
 * 받아 온 줄을 `follow-state` 에 흘려 넣는다 — 이 화면을 열어 둔 채 브랜드관으로
 * 가면 그 버튼이 「팔로우」라고 한 번 그려졌다가 「팔로잉」으로 바뀌는 일이 없다.
 * 「팔로우했나」에 답하는 것은 이제 이 목록이 아니라 `GET /me/follows/ids` 이고
 * (4.4), 여기서 흘려 넣는 것은 그 답을 기다리는 사이의 깜빡임을 없애기 위한 것이다.
 * `use-wishlist.ts` 가 같은 이유로 같은 모양이다.
 *
 * **언팔로우하면 줄이 빠진다.** 답이 「아직 팔로우 중」이면 빼지 않는다 — 다른 탭에서
 * 방금 끊은 것을 이 클릭이 다시 이은 경우이고, 그때 줄을 지우면 화면과 서버가 반대로
 * 갈린다.
 */

export type FollowListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface FollowList {
  readonly state: FollowListState
  readonly sellers: readonly FollowedSeller[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly reload: () => void
  readonly pending: string | null
  readonly failures: Readonly<Record<string, ApiFailure>>
  readonly unfollow: (sellerId: string) => void
}

export function useFollowList(): FollowList {
  const [state, setState] = useState<FollowListState>({ status: 'loading' })
  const [sellers, setSellers] = useState<readonly FollowedSeller[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [failures, setFailures] = useState<Readonly<Record<string, ApiFailure>>>({})
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchFollows(null, FOLLOW_LIST_DEFAULT_LIMIT, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return

        setSellers(page.sellers)
        setCursor(page.nextCursor)
        publishFollowPage(page.sellers)
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
    setSellers([])
    setCursor(null)
    setFailures({})
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return

    setLoadingMore(true)

    async function next(from: string): Promise<void> {
      try {
        const page = await fetchFollows(from, FOLLOW_LIST_DEFAULT_LIMIT)

        setSellers((existing) => [...existing, ...page.sellers])
        setCursor(page.nextCursor)
        publishFollowPage(page.sellers)
      } catch {
        // 목록은 그대로 남는다. 다시 누르면 같은 커서로 다시 묻는다.
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor, loadingMore])

  const unfollow = useCallback(
    (sellerId: string) => {
      if (pending !== null) return

      setPending(sellerId)
      setFailures((current) => without(current, sellerId))

      async function send(): Promise<void> {
        try {
          const answer = await toggleFollow(sellerId)

          publishFollow(sellerId, {
            active: answer.active,
            followerCount: answer.followerCount,
          })

          if (!answer.active) {
            setSellers((existing) => existing.filter((seller) => seller.sellerId !== sellerId))
          }
        } catch (error) {
          setFailures((current) => ({ ...current, [sellerId]: apiFailure(error) }))
        } finally {
          setPending(null)
        }
      }

      void send()
    },
    [pending],
  )

  return {
    failures,
    hasMore: state.status === 'ready' && cursor !== null,
    loadMore,
    loadingMore,
    pending,
    reload,
    sellers,
    state,
    unfollow,
  }
}

function without(
  current: Readonly<Record<string, ApiFailure>>,
  key: string,
): Readonly<Record<string, ApiFailure>> {
  const { [key]: _removed, ...rest } = current

  return rest
}
