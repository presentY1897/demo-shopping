'use client'

import type { ApiFailure, RecentlyViewedItem } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { useAuth } from '@/lib/auth/auth-context'

import {
  fetchRecentlyViewed,
  forgetAllViews,
  forgetView,
  mergeRecentlyViewed,
} from './collections-api'
import { mergeRequest, parseLocalHistory, recordLocalView } from './local-history'

/**
 * 최근 본 상품 — 로그인 전과 후 (TASK-0087 F6 · F7).
 *
 * ## 두 개의 저장소를 하나의 목록으로 보인다
 *
 * 로그인한 사람의 이력은 **서버가 상세 조회에서 비동기로** 남긴다(4장). 그래서 이
 * 훅은 로그인한 사람에게는 읽기만 하고 아무것도 보내지 않는다 — 조회마다 `POST` 를
 * 하나 더 보내면 상세 화면이 늦게 뜨는 이유가 되고, 그 요청이 실패하면 조회까지
 * 실패한 것처럼 보인다.
 *
 * 로그인하지 않은 사람의 이력은 브라우저에 있다. 서버가 그 사람을 모르기 때문이고,
 * 그 이력이 필요한 이유는 **그 사람이 나중에 로그인하기** 때문이다.
 *
 * ## 병합은 로그인 직후 **한 번**이고, 왕복도 하나다
 *
 * `POST /me/recently-viewed` 의 답이 합쳐진 목록 전체라, 보낸 뒤 다시 읽지 않는다.
 * 보내고 나면 브라우저의 사본을 **지운다** — 남겨 두면 다음 로그인 때 같은 이력이
 * 다시 올라가고, 그때 그것은 「방금 본 것」이 아니라 옛 기록이라 순서를 망친다.
 *
 * ## 서버 스냅샷과 하이드레이션
 *
 * 브라우저의 이력은 서버 렌더에 존재하지 않는다. `useSyncExternalStore` 의 서버
 * 스냅샷이 언제나 빈 목록인 이유가 그것이고, 그래서 첫 페인트는 스트립 없이 지나간
 * 뒤 하이드레이션에서 채워진다 — 여기서 값을 내면 마크업이 어긋난다.
 */

/** 브라우저에 이력을 적어 두는 열쇠. `shopping.` 접두어는 이 앱의 다른 값들과 같다. */
export const RECENT_STORAGE_KEY = 'shopping.recentlyViewed'

const EMPTY: readonly RecentlyViewedItem[] = []

/**
 * 브라우저 사본의 캐시.
 *
 * `useSyncExternalStore` 의 스냅샷은 **바뀌지 않았으면 같은 값**이어야 한다.
 * 매번 `localStorage` 를 읽어 새 배열을 만들면 React 는 값이 계속 바뀐다고 보고
 * 무한히 다시 그린다.
 */
let cached: readonly RecentlyViewedItem[] | null = null

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/**
 * `localStorage` 는 없을 수도, 던질 수도 있다 — 사생활 보호 창이거나 브라우저가
 * 사이트 데이터를 막았을 때다. 이력을 못 읽는 것은 사람이 할 일이 있는 실패가
 * 아니므로 조용히 빈 목록이 된다 (`lib/auth/next-path.ts` 의 같은 판단).
 */
function readLocal(): readonly RecentlyViewedItem[] {
  try {
    return parseLocalHistory(globalThis.localStorage?.getItem(RECENT_STORAGE_KEY) ?? null)
  } catch {
    return EMPTY
  }
}

function localSnapshot(): readonly RecentlyViewedItem[] {
  cached ??= readLocal()

  return cached
}

function serverSnapshot(): readonly RecentlyViewedItem[] {
  return EMPTY
}

function writeLocal(items: readonly RecentlyViewedItem[]): void {
  cached = items

  try {
    globalThis.localStorage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 적지 못해도 이 탭에서는 캐시가 답한다. 다음 방문에 잊힐 뿐이다.
  }

  emit()
}

function clearLocal(): void {
  cached = EMPTY

  try {
    globalThis.localStorage?.removeItem(RECENT_STORAGE_KEY)
  } catch {
    // 위와 같다.
  }

  emit()
}

/** 스펙이 브라우저를 처음 상태로 되돌릴 때. 모듈 캐시는 파일 하나에만 있다. */
export function resetLocalHistoryCache(): void {
  cached = null
  emit()
}

/**
 * 상품 상세가 부른다 — **로그인하지 않았을 때만** 적는다 (F6).
 *
 * 로그인한 사람의 것은 서버가 남기므로, 여기서 함께 적으면 같은 조회가 두 곳에
 * 기록되고 로그인 다음 병합에서 그 둘이 다시 만난다.
 *
 * 세션을 아직 모르는 동안(`checking`)에도 적지 않는다. 그 순간 적어 두면 곧 로그인한
 * 것으로 밝혀진 사람의 브라우저에 사본이 하나 남고, 그것은 다음 로그아웃 뒤에야
 * 사라진다.
 */
export function useRecordView(item: RecentlyViewedItem | null): void {
  const { state } = useAuth()
  const anonymous = state.status === 'anonymous'
  const productId = item?.productId ?? null

  useEffect(() => {
    if (!anonymous || item === null) return

    writeLocal(recordLocalView(localSnapshot(), item))
    // 상품이 바뀔 때만 다시 적는다. `item` 은 렌더마다 새 객체라 의존 목록에 넣으면
    // 매 렌더가 기록이 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- productId 가 「어느 상품을 봤나」의 전부다.
  }, [anonymous, productId])
}

export type RecentlyViewedState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface RecentlyViewed {
  readonly state: RecentlyViewedState
  readonly items: readonly RecentlyViewedItem[]
  /** 브라우저에 있는 이력을 보고 있는가. 로그인 안내를 그릴지 정하는 값이다. */
  readonly local: boolean
  readonly reload: () => void
  readonly remove: (productId: string) => void
  readonly clear: () => void
  readonly failed: boolean
}

export function useRecentlyViewed(): RecentlyViewed {
  const { state: auth } = useAuth()
  const signedIn = auth.status === 'signedIn'
  /**
   * **「아직 모른다」는 익명이 아니다.**
   *
   * 세션을 확인하는 동안 브라우저의 이력을 그려 두면, 로그인한 사람의 화면에서 그것이
   * 한순간 보였다가 서버의 목록으로 갈린다 — 그리고 그 한순간에 「이 브라우저에만
   * 기록됩니다」라는, 그 사람에게는 사실이 아닌 문장이 함께 뜬다. `AuthState` 가
   * 불리언이 아닌 이유가 정확히 이것이다 (`auth-context.tsx`).
   */
  const anonymous = auth.status === 'anonymous'
  const local = useSyncExternalStore(subscribe, localSnapshot, serverSnapshot)

  const [state, setState] = useState<RecentlyViewedState>({ status: 'loading' })
  const [items, setItems] = useState<readonly RecentlyViewedItem[]>([])
  const [failed, setFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!signedIn) return undefined

    const controller = new AbortController()

    async function load(): Promise<void> {
      const pending = mergeRequest(localSnapshot())

      try {
        // 병합할 것이 있으면 그것이 곧 읽기다 — 답이 합쳐진 목록 전체다.
        const page =
          pending === null
            ? await fetchRecentlyViewed({ signal: controller.signal })
            : await mergeRecentlyViewed(pending, { signal: controller.signal })

        if (controller.signal.aborted) return

        // 올려보낸 뒤에야 지운다. 실패한 병합의 이력을 지우면 그 이력은 어디에도
        // 없다.
        if (pending !== null) clearLocal()

        setItems(page.items)
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
  }, [reloadToken, signedIn])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  const remove = useCallback(
    (productId: string) => {
      setFailed(false)

      if (!signedIn) {
        writeLocal(localSnapshot().filter((item) => item.productId !== productId))

        return
      }

      // 화면에서 먼저 뺀다. 지우기는 되돌릴 일이 아니라 **다시 누를** 일이라,
      // 실패하면 줄이 돌아오는 것보다 「지우지 못했다」가 정확하다.
      setItems((existing) => existing.filter((item) => item.productId !== productId))

      void forgetView(productId).catch(() => {
        setFailed(true)
        setReloadToken((token) => token + 1)
      })
    },
    [signedIn],
  )

  const clear = useCallback(() => {
    setFailed(false)

    if (!signedIn) {
      clearLocal()

      return
    }

    setItems([])

    void forgetAllViews().catch(() => {
      setFailed(true)
      setReloadToken((token) => token + 1)
    })
  }, [signedIn])

  // 로그인하지 않은 사람에게는 기다릴 것이 없다 — 이력이 이 브라우저에 있다.
  if (anonymous) {
    return { clear, failed, items: local, local: true, reload, remove, state: { status: 'ready' } }
  }

  return { clear, failed, items, local: false, reload, remove, state }
}
