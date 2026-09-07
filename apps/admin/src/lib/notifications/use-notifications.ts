'use client'

import type { ApiFailure, Notification } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { fetchNotifications, readNotifications } from './console-api'
import { NOTIFICATION_POLL_MS, queryOf, shouldPoll } from './notification-console'

/**
 * 알림함 하나 — 헤더의 드롭다운과 `/notifications` 가 같은 훅을 쓴다.
 *
 * 둘의 차이는 **네 개의 값**뿐이라 훅을 둘로 나누지 않았다: 헤더는 안 읽은 것만
 * 다섯 개를 30초마다 다시 묻고, 페이지는 전부를 한 페이지씩 사람이 넘긴다. 닮은 훅
 * 둘은 반드시 어긋나고, 어긋나면 **배지의 숫자와 목록의 길이가 다른 답**을 한다.
 *
 * ## 배지가 목록과 함께 온다
 *
 * `unreadCount` 는 목록 응답에 실려 온다(`notificationListResponseSchema`). 배지만
 * 따로 부르는 라우트를 두지 않은 것이 TASK-0090 4.5 의 판단이고, 그래서 여기에는
 * 「배지를 위한 요청」이라는 것이 없다 — 다시 읽으면 둘 다 새로워진다.
 */

export type NotificationsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly notifications: readonly Notification[]
      readonly nextCursor: string | null
      /** 안 읽은 알림의 수 — **필터와 무관하다** (F3). */
      readonly unreadCount: number
    }

export interface UseNotificationsOptions {
  /** 안 읽은 것만 볼지. 헤더는 고정이고 페이지는 사람이 토글한다. */
  readonly unreadOnly: boolean
  /** 한 번에 받을 개수. `null` 이면 계약의 기본값. */
  readonly limit: number | null
  /** 30초마다 다시 물을지 (F8). 헤더만 그렇다. */
  readonly poll: boolean
  /** 물을 계정이 있는가. 로그인 전에는 아무것도 묻지 않는다. */
  readonly enabled: boolean
}

export interface NotificationsController {
  readonly state: NotificationsState
  readonly pagination: CursorPagination
  /** 뼈대부터 다시 그린다. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
  /** 읽음 처리가 도는 중. 두 번째 클릭이 두 번째 요청이 되지 않게 한다 (U3). */
  readonly busy: boolean
  /**
   * 읽음 처리 (F4). **id 를 주지 않으면 전부**다.
   *
   * 실패는 값으로 온다 — 알림을 못 읽음 처리한 것이 화면을 오류로 덮을 일은 아니고,
   * 그 실패의 다음 행동은 「다시 눌러 보기」다.
   */
  readonly markRead: (ids?: readonly string[]) => Promise<ApiFailure | null>
}

/**
 * 탭이 지금 가려져 있는가.
 *
 * `useSyncExternalStore` 인 이유는 이것이 **리액트 밖의 값**이기 때문이다. 효과
 * 안에서 `setState(document.hidden)` 로 시작하면 마운트마다 두 번 그려지고
 * (`use-api-wake.ts` 가 같은 함정을 적어 두었다), 서버에는 `document` 가 없다 —
 * 서버 스냅숏이 `false` 인 것은 서버 렌더에서 폴링이 시작되지 않기 때문에 어느 쪽을
 * 골라도 같지만, 값이 있어야 훅이 던지지 않는다.
 */
function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)

  return () => {
    document.removeEventListener('visibilitychange', onChange)
  }
}

function useDocumentHidden(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.hidden,
    () => false,
  )
}

export function useNotifications({
  unreadOnly,
  limit,
  poll,
  enabled,
}: UseNotificationsOptions): NotificationsController {
  const [state, setState] = useState<NotificationsState>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState(0)
  const hidden = useDocumentHidden()

  /**
   * 이번 다시 읽기가 **조용한 것인가.**
   *
   * 폴링이 이 값을 늘 참으로 만든다. 30초마다 뼈대로 되돌아가는 목록은 읽을 수 없고,
   * 열려 있는 드롭다운이 그 순간 비면 누르려던 줄이 손 밑에서 사라진다
   * (`use-settlements.ts` 와 같은 장치, 훨씬 더 필요한 자리).
   */
  const quiet = useRef(false)

  /** 도는 중인지를 ref 로도 든다 — 두 번째 클릭은 다시 그리기 **전에** 도착한다. */
  const inFlight = useRef(false)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  // 「안 읽은 것만」이 바뀌면 첫 페이지로. 커서는 그 필터 안에서만 위치를 뜻한다.
  useEffect(() => {
    reset()
  }, [unreadOnly, reset])

  useEffect(() => {
    if (!enabled) return

    const controller = new AbortController()
    const silent = quiet.current

    quiet.current = false

    async function load(): Promise<void> {
      if (!silent) setState({ status: 'loading' })

      try {
        const page = await fetchNotifications(
          { ...queryOf({ unreadOnly, limit }), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({
          status: 'ready',
          notifications: page.notifications,
          nextCursor: page.nextCursor,
          unreadCount: page.unreadCount,
        })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [unreadOnly, limit, enabled, cursor, token])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  /**
   * 30초마다 (F8), **탭이 보일 때만** (R1).
   *
   * 조건이 거짓이면 타이머를 아예 걸지 않는다 — 걸어 두고 안에서 건너뛰면 「폴링을
   * 멈춘다」가 「요청만 안 한다」가 되고, 그 차이는 배터리에서 나타난다. 탭이 돌아오면
   * `hidden` 이 바뀌어 이 효과가 다시 돌고 타이머가 새로 걸린다.
   */
  useEffect(() => {
    if (!shouldPoll({ hidden, enabled: poll && enabled })) return

    const timer = setInterval(() => {
      quiet.current = true
      setToken((previous) => previous + 1)
    }, NOTIFICATION_POLL_MS)

    return () => {
      clearInterval(timer)
    }
  }, [hidden, poll, enabled])

  const markRead = useCallback(async (ids?: readonly string[]): Promise<ApiFailure | null> => {
    if (inFlight.current) return null

    inFlight.current = true
    setBusy(true)

    try {
      const answer = await readNotifications(ids)

      // 배지는 **답이 온 그 자리에서** 내린다. 다시 읽기를 기다리면 눌린 뒤에도
      // 숫자가 잠깐 그대로 서 있고, 그 사이 사람은 한 번 더 누른다.
      setState((previous) =>
        previous.status === 'ready' ? { ...previous, unreadCount: answer.unreadCount } : previous,
      )
      quiet.current = true
      setToken((previous) => previous + 1)

      return null
    } catch (error) {
      return apiFailure(error)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }, [])

  return { busy, markRead, pagination, reload, state }
}
