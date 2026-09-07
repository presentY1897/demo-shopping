'use client'

import type { ApiFailure, WishlistItem } from '@shopping/shared'
import { WISHLIST_DEFAULT_LIMIT, apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { setRestockAlert, fetchWishlist, toggleWishlist } from './collections-api'
import { publishWishlistPage, publishWishlisted } from './wishlist-state'

/**
 * `/mypage/wishlist` — 담아 둔 것들 (TASK-0086 F3 · F4 · F5).
 *
 * ## 받아 온 줄을 찜 표에도 흘려 넣는다
 *
 * 「이 상품을 찜했나」에 답하는 것은 이제 이 목록이 아니라 `GET /me/wishlist/ids`
 * 다(4.5). 그래도 줄을 흘려 넣는 이유는 **깜빡임** 하나 때문이다 — 이 화면을 열어 둔
 * 채 상품 상세로 가면 그 버튼이 답을 기다리는 동안 「모른다」로 그려지고, 그 사이에
 * 누른 사람은 이미 담은 것을 뺀다.
 *
 * ## 해제는 줄을 지운다
 *
 * 토글의 답이 `{ active: false }` 이면 그 줄은 더 이상 이 목록의 것이 아니다.
 * 서버에 다시 묻지 않고 그 자리에서 빼는 이유는, 다시 물으면 **다음 장의 줄 하나가
 * 끌려 올라와** 방금 지운 자리에 다른 상품이 앉기 때문이다 — 사람은 그것을 「잘못
 * 지웠다」로 읽는다.
 *
 * ## 재입고 알림은 줄마다 따로 실패한다
 *
 * 스무 줄 중 하나가 실패했을 때 화면 전체에 한 줄짜리 오류를 붙이면 **어느 줄이
 * 실패했는지**를 말할 수 없다. 리뷰 쓰기 목록이 같은 이유로 실패를 줄마다 적는다
 * (`use-reviewable-items.ts`).
 */

export type WishlistState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface Wishlist {
  readonly state: WishlistState
  readonly items: readonly WishlistItem[]
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly reload: () => void
  /** 지금 서버에 나가 있는 줄. 중복 클릭을 막는 값이다 (U3). */
  readonly pending: string | null
  /** `productId` → 그 줄에서 방금 실패한 것. */
  readonly failures: Readonly<Record<string, ApiFailure>>
  /** 찜을 해제한다. 답이 「해제됨」이면 줄이 목록에서 빠진다. */
  readonly remove: (productId: string) => void
  /** 재입고 알림을 켜고 끈다 (F4). */
  readonly setAlert: (productId: string, wanted: boolean) => void
}

export function useWishlist(): Wishlist {
  const [state, setState] = useState<WishlistState>({ status: 'loading' })
  const [items, setItems] = useState<readonly WishlistItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [failures, setFailures] = useState<Readonly<Record<string, ApiFailure>>>({})
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchWishlist(null, WISHLIST_DEFAULT_LIMIT, {
          signal: controller.signal,
        })
        if (controller.signal.aborted) return

        setItems(page.items)
        setCursor(page.nextCursor)
        publishWishlistPage(page.items)
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
    setFailures({})
    setReloadToken((token) => token + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return

    setLoadingMore(true)

    async function next(from: string): Promise<void> {
      try {
        const page = await fetchWishlist(from, WISHLIST_DEFAULT_LIMIT)

        // 이어 붙인다. 갈아치우면 「더 보기」가 목록을 지우는 버튼이 된다.
        setItems((existing) => [...existing, ...page.items])
        setCursor(page.nextCursor)
        publishWishlistPage(page.items)
      } catch {
        // 목록은 그대로 남는다. 다시 누르면 같은 커서로 다시 묻는다.
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor, loadingMore])

  /** 둘이 같은 모양으로 끝난다 — 그 줄을 잠그고, 실패하면 그 줄에 적는다. */
  const run = useCallback(
    (productId: string, call: () => Promise<void>): void => {
      if (pending !== null) return

      setPending(productId)
      setFailures((current) => without(current, productId))

      void call()
        .catch((error: unknown) => {
          setFailures((current) => ({ ...current, [productId]: apiFailure(error) }))
        })
        .finally(() => {
          setPending(null)
        })
    },
    [pending],
  )

  const remove = useCallback(
    (productId: string) => {
      run(productId, async () => {
        const answer = await toggleWishlist(productId)

        publishWishlisted(productId, answer.active)

        // 답이 「아직 담겨 있다」면 줄을 지우지 않는다. 다른 탭에서 방금 해제한
        // 것을 이 클릭이 **다시 담은** 경우이고, 그때 줄을 지우면 화면과 서버가
        // 반대로 갈린다.
        if (!answer.active)
          setItems((existing) => existing.filter((i) => i.productId !== productId))
      })
    },
    [run],
  )

  const setAlert = useCallback(
    (productId: string, wanted: boolean) => {
      run(productId, async () => {
        const answer = await setRestockAlert(productId, wanted)

        setItems((existing) =>
          existing.map((item) =>
            item.productId === productId ? { ...item, notifyRestock: answer.notifyRestock } : item,
          ),
        )
      })
    },
    [run],
  )

  return {
    failures,
    hasMore: state.status === 'ready' && cursor !== null,
    items,
    loadMore,
    loadingMore,
    pending,
    reload,
    remove,
    setAlert,
    state,
  }
}

function without(
  current: Readonly<Record<string, ApiFailure>>,
  key: string,
): Readonly<Record<string, ApiFailure>> {
  const { [key]: _removed, ...rest } = current

  return rest
}
