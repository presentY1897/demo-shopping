'use client'

import type { ApiFailure, Notification } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchNotifications, markNotificationsRead } from './console-api'
import type { NotificationFilters } from './notification-console'
import {
  EMPTY_NOTIFICATION_FILTERS,
  isNarrowed,
  notificationSearch,
  pollDelay,
  readRequest,
} from './notification-console'

/**
 * 알림 한 페이지, 미읽음 수, 읽음 처리, 그리고 **30초 폴링** (TASK-0090).
 *
 * 뼈대는 `use-seller-product-reviews.ts` · `use-seller-questions.ts` 와 같다 — 서버
 * 렌더에서 아무것도 기다리지 않고, 커서는 `useCursorPagination` 이 들고, 필터가
 * 바뀌면 첫 페이지로 돌아가며, 쓰기가 끝나면 목록을 **조용히** 다시 읽는다. 이 훅에만
 * 있는 것은 타이머 하나다.
 *
 * ## 같은 훅이 두 곳에 쓰인다
 *
 * | 쓰는 곳 | `poll` | `limit` | 처음 필터 |
 * | --- | --- | --- | --- |
 * | 상단바의 종 | `true` | 5 | 안 읽은 것만 |
 * | `/notifications` | `false` | 서버 기본값 | 전체 |
 *
 * **폴링하는 쪽이 하나인 것이 설계다.** 종은 모든 화면에 있으므로 알림함 페이지에서도
 * 이미 돌고 있고, 거기에 두 번째 타이머를 두면 30초마다 같은 것을 두 번 묻는다. 그리고
 * 커서로 넘긴 목록의 줄이 읽는 사람 밑에서 조용히 바뀌는 것은 도움이 아니다 —
 * 알림함에서 사람이 하는 일은 「읽고 눌러 이동」이고, 그 사이에 줄이 밀리면 다른 것을
 * 누르게 된다.
 *
 * **세션은 여기서 읽지 않는다.** 물어도 되는지는 `enabled` 로 들어온다 — 그 판단은
 * 화면의 것이고, 리뷰·문의 훅이 `sellerId` 를 인자로 받는 것과 같은 이유다. 다만 이
 * 훅은 「마운트하지 않는다」로 끄지 못한다: 상단바의 종은 셸이 콘솔 전체를 감싼
 * 자리에 있어서, 마운트를 껐다 켜면 그 아래가 통째로 다시 만들어진다
 * (`notification-center.tsx` 가 그 사고를 적어 두었다). 그래서 끄는 방법이
 * **묻지 않는 것**이다.
 */

export type NotificationsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly Notification[]
      readonly nextCursor: string | null
      /**
       * 안 읽은 알림의 수 (F3). **필터와 무관하다.**
       *
       * 계약이 목록과 함께 보낸다(4.5) — 배지만 따로 부르는 라우트를 두면 알림함을
       * 연 화면이 같은 것을 두 번 묻는다.
       */
      readonly unreadCount: number
    }

export type NotificationRead =
  { readonly ok: true } | { readonly ok: false; readonly failure: ApiFailure }

export interface NotificationsController {
  readonly state: NotificationsState
  readonly filters: NotificationFilters
  readonly setFilters: (filters: NotificationFilters) => void
  readonly isFiltered: boolean
  readonly pagination: CursorPagination
  /** 스켈레톤부터 다시. 오류 상태의 「다시 시도」가 부른다. */
  readonly reload: () => void
  /** 화면을 흔들지 않고 다시 읽는다. 폴링과 다른 화면의 읽음 처리가 부른다. */
  readonly refresh: () => void
  /** `null` 이면 **전부** 읽음이다 (F4). 계약의 판단을 그대로 옮긴 것이다. */
  readonly markRead: (id: string | null) => Promise<NotificationRead>
  /** 지금 읽음 처리가 나가 있다. 버튼을 잠근다. */
  readonly reading: boolean
}

/**
 * 지금 탭이 보이는가 — 마운트 시점의 값.
 *
 * **서버 렌더에는 `document` 가 없다.** 이 훅은 `'use client'` 경계 안에 있지만
 * Next 는 그 경계도 한 번 서버에서 그리므로, 지연 초기화 함수 안의 `document` 는
 * Node 에서 실행된다. 서버에서 「보인다」로 두는 것이 맞다: 거기서는 타이머가 걸리지
 * 않고, 진짜 값은 브라우저의 첫 렌더가 정한다.
 *
 * 효과 안에서 `setVisible` 로 맞추던 것을 여기로 옮긴 이유는 그 한 줄이 **마운트마다
 * 렌더를 한 번 더 만들기** 때문이다 (`react-hooks/set-state-in-effect`). 이 값은
 * 처음부터 알 수 있는 것이라 효과가 필요 없다.
 */
function tabIsVisible(): boolean {
  return typeof document === 'undefined' || !document.hidden
}

export interface UseNotificationsOptions {
  /**
   * 물어도 되는가.
   *
   * 로그인하지 않았거나 `notification.read` 가 없는 계정에서 `false` 다. 그때 훅은
   * 요청도 타이머도 만들지 않는다 — 아무도 볼 수 없는 자리에서 401 이 30초마다
   * 되풀이되는 것을 막는 것이 이 값의 유일한 일이다.
   */
  readonly enabled?: boolean
  /** 30초마다 다시 묻는가 (R1). 탭이 숨으면 그래도 멈춘다. */
  readonly poll?: boolean
  /** 한 페이지의 줄 수. `null` 이면 서버의 기본값을 쓴다. */
  readonly limit?: number | null
  readonly initialFilters?: NotificationFilters
}

export function useNotifications({
  enabled = true,
  poll = false,
  limit = null,
  initialFilters = EMPTY_NOTIFICATION_FILTERS,
}: UseNotificationsOptions = {}): NotificationsController {
  const [state, setState] = useState<NotificationsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<NotificationFilters>(initialFilters)
  const [reloadToken, setReloadToken] = useState(0)
  const [reading, setReading] = useState(false)
  /** 탭이 보이는가. 폴링의 두 조건 중 하나다 (`pollDelay`). */
  const [visible, setVisible] = useState(tabIsVisible)

  /** 화면을 스켈레톤으로 되돌리지 않아야 하는 다시 읽기. */
  const silent = useRef(false)

  const paging = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = paging

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()

    async function load(): Promise<void> {
      if (!silent.current) setState({ status: 'loading' })
      silent.current = false

      try {
        const page = await fetchNotifications(notificationSearch(filters, cursor, limit), {
          signal: controller.signal,
        })

        if (controller.signal.aborted) return

        setState({
          items: page.notifications,
          nextCursor: page.nextCursor,
          status: 'ready',
          unreadCount: page.unreadCount,
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
  }, [enabled, filters, cursor, limit, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const refresh = useCallback(() => {
    silent.current = true
    setReloadToken((token) => token + 1)
  }, [])

  const setFilters = useCallback(
    (next: NotificationFilters) => {
      setFiltersState(next)
      // 커서는 그 필터 안에서만 위치를 뜻한다.
      reset()
    },
    [reset],
  )

  /**
   * 탭이 숨으면 폴링을 멈추고, 돌아오면 **즉시 한 번** 읽는다 (R1 · 4장의 그림).
   *
   * 돌아왔을 때 30초를 마저 기다리면, 자리를 비운 사이에 들어온 주문을 다음 주기까지
   * 못 본다 — 사람이 탭을 다시 여는 행위 자체가 「지금 확인하겠다」이다.
   */
  useEffect(() => {
    if (!poll || !enabled) return

    const onVisibilityChange = (): void => {
      const nowVisible = !document.hidden

      setVisible(nowVisible)
      if (nowVisible) refresh()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, poll, refresh])

  useEffect(() => {
    const delay = pollDelay({ enabled: poll && enabled, visible })

    if (delay === null) return

    const timer = setInterval(refresh, delay)

    return () => {
      clearInterval(timer)
    }
  }, [enabled, poll, visible, refresh])

  const markRead = useCallback(
    async (id: string | null): Promise<NotificationRead> => {
      setReading(true)

      try {
        await markNotificationsRead(readRequest(id))

        // 답으로 온 미읽음 수를 손으로 심지 않고 **목록을 다시 읽는다.** 그 답은 배지
        // 하나만 말하고, 줄의 「읽지 않음」 표시는 목록이 들고 있다.
        refresh()

        return { ok: true }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      } finally {
        setReading(false)
      }
    },
    [refresh],
  )

  return {
    filters,
    isFiltered: isNarrowed(filters),
    markRead,
    pagination: paging,
    reading,
    refresh,
    reload,
    setFilters,
    state,
  }
}
