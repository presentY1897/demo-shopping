'use client'

import type { ApiFailure, Notification } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'

import { shopNotifications } from './notification-scope'
import { fetchNotifications, readNotifications } from './notifications-api'
import { pollDecision } from './polling'

/**
 * 알림함 — 헤더의 드롭다운과 `/mypage/notifications` 가 **같은 훅**이다
 * (TASK-0090 F2 · F3 · F4 · F8).
 *
 * ## 하나인 이유
 *
 * 둘이 부르는 라우트가 같고(`GET /me/notifications`) 다른 것은 질의 두 개뿐이다 —
 * 몇 개를 받나, 안 읽은 것만 받나. 훅을 둘로 나누면 읽음 처리와 미읽음 수 갱신이
 * 두 벌이 되고, 그 둘이 갈리는 날 배지와 목록이 서로 다른 말을 한다.
 *
 * ## 미읽음 수를 화면이 세지 않는다
 *
 * 목록과 함께 오고(`unreadCount`), 읽음 처리의 답으로도 온다. 화면이 「방금 하나
 * 읽었으니 하나 빼자」로 두면 다른 탭에서 읽은 것이 반영되지 않고, `unreadOnly` 로
 * 좁혀 받은 목록의 길이를 세면 5건까지만 받는 헤더가 「미읽음 5」에서 멈춘다.
 *
 * ## 폴링은 세 가지를 지킨다
 *
 * 30초 주기(4장), **숨은 탭에서 중단**(R1), 그리고 다시 보이는 순간 즉시 한 번.
 * 마지막 하나가 없으면 탭을 되돌아온 사람이 최대 30초 동안 옛 배지를 본다 — 멈춘
 * 것을 사람이 알 방법은 없으므로 그 30초는 「알림이 안 온다」로 읽힌다.
 *
 * 언제 폴링하는지의 판단 자체는 순수한 함수에 있다(`polling.ts`). 틀려도 조용한
 * 판단이라 화면을 그리지 않고 검사할 수 있어야 한다.
 */

export type InboxState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

export interface Inbox {
  readonly state: InboxState
  readonly notifications: readonly Notification[]
  /** **필터와 무관한** 계정의 미읽음 수. 모르면 `null` — 0 이 아니다. */
  readonly unreadCount: number | null
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly reload: () => void
  /** 하나를 읽음으로. 알림을 눌러 링크로 갈 때도 이것이 함께 불린다 (F2 · F4). */
  readonly read: (id: string) => void
  /** 전부 읽음으로. 계약이 **id 를 주지 않으면 전부**로 읽는다 (F4). */
  readonly readAll: () => void
  readonly failed: boolean
}

export interface InboxOptions {
  readonly limit: number
  /** 헤더의 드롭다운은 안 읽은 것만 본다. 알림함 페이지는 전부 본다. */
  readonly unreadOnly: boolean
  /** 30초마다 다시 묻는가. 헤더만 참이다 — 페이지는 열려 있는 화면 하나다. */
  readonly poll: boolean
}

/** 서버 렌더에는 「숨은 탭」이라는 것이 없다. */
function hiddenNow(): boolean {
  return globalThis.document?.visibilityState === 'hidden'
}

export function useNotifications({ limit, poll, unreadOnly }: InboxOptions): Inbox {
  const { state: auth } = useAuth()
  const signedIn = auth.status === 'signedIn'

  const [state, setState] = useState<InboxState>({ status: 'loading' })
  const [notifications, setNotifications] = useState<readonly Notification[]>([])
  const [unreadCount, setUnreadCount] = useState<number | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [failed, setFailed] = useState(false)
  const [hidden, setHidden] = useState(hiddenNow)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!poll) return undefined

    function onVisibility(): void {
      const away = hiddenNow()

      setHidden(away)
      // 돌아온 순간 한 번 더 묻는다. 없으면 최대 30초 동안 옛 배지를 본다.
      if (!away) setTick((current) => current + 1)
    }

    globalThis.document.addEventListener('visibilitychange', onVisibility)

    return () => {
      globalThis.document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [poll])

  const decision = pollDecision({ hidden, signedIn })
  const intervalMs = decision.kind === 'poll' && poll ? decision.intervalMs : null

  useEffect(() => {
    if (intervalMs === null) return undefined

    const timer = setInterval(() => {
      setTick((current) => current + 1)
    }, intervalMs)

    return () => {
      clearInterval(timer)
    }
  }, [intervalMs])

  useEffect(() => {
    if (!signedIn) return undefined

    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchNotifications(
          { cursor: null, limit, unreadOnly },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return

        setNotifications(shopNotifications(page.notifications))
        setUnreadCount(page.unreadCount)
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
  }, [limit, signedIn, tick, unreadOnly])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setTick((current) => current + 1)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return

    setLoadingMore(true)

    async function next(from: string): Promise<void> {
      try {
        const page = await fetchNotifications({ cursor: from, limit, unreadOnly })

        setNotifications((existing) => [...existing, ...shopNotifications(page.notifications)])
        setUnreadCount(page.unreadCount)
        setCursor(page.nextCursor)
      } catch {
        // 목록은 그대로 남는다. 다시 누르면 같은 커서로 다시 묻는다.
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor)
  }, [cursor, limit, loadingMore, unreadOnly])

  /**
   * 읽음 처리 하나.
   *
   * **화면에서 먼저 지우지 않는다.** 안 읽은 것만 보는 드롭다운에서 그렇게 하면
   * 누른 알림이 손가락 아래에서 사라지고, 링크를 따라가려던 사람이 무엇을 눌렀는지
   * 잃는다. 대신 그 줄에 `readAt` 을 적어 **읽은 것으로 보이게** 한다.
   */
  const mark = useCallback((ids: readonly string[] | null): void => {
    setFailed(false)

    async function send(): Promise<void> {
      try {
        const answer = await readNotifications(ids === null ? {} : { ids: [...ids] })
        const at = new Date().toISOString()

        setNotifications((existing) =>
          existing.map((notification) =>
            (ids === null || ids.includes(notification.id)) && notification.readAt === null
              ? { ...notification, readAt: at }
              : notification,
          ),
        )
        setUnreadCount(answer.unreadCount)
      } catch {
        setFailed(true)
      }
    }

    void send()
  }, [])

  const read = useCallback(
    (id: string) => {
      mark([id])
    },
    [mark],
  )

  const readAll = useCallback(() => {
    mark(null)
  }, [mark])

  return {
    failed,
    hasMore: state.status === 'ready' && cursor !== null,
    loadMore,
    loadingMore,
    notifications,
    read,
    readAll,
    reload,
    state: signedIn ? state : { status: 'ready' },
    unreadCount: signedIn ? unreadCount : null,
  }
}
