'use client'

import type {
  AdjustPointsRequest,
  AdjustPointsResponse,
  AdminUserDetail,
  AdminUserSummary,
  ApiFailure,
  Role,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  adjustPoints,
  fetchUsers,
  grantRole,
  reinstateUser,
  revokeRole,
  suspendUser,
  viewUser,
} from './console-api'
import type { UserFilters } from './user-console'
import { EMPTY_USER_FILTERS, isNarrowed, queryOf } from './user-console'

/**
 * 회원 한 페이지, 그리고 **연 계정 하나** (TASK-0093).
 *
 * 훅이 둘인 것이 설계다. 목록은 가려진 값을 읽는 일이고 언제든 다시 읽어도 되지만,
 * 상세는 **사유를 받은 한 번의 열람**이다 — 같은 훅에 담으면 목록을 다시 읽는 모든
 * 자리가 열람 기록을 한 줄씩 늘릴 수 있는 자리가 된다 (4.3).
 *
 * 목록 쪽 뼈대는 `use-reports.ts` · `use-settlements.ts` 와 같다: 서버 렌더에서
 * 아무것도 기다리지 않고, 커서는 `useCursorPagination` 이 들며, 필터가 바뀌면 첫
 * 페이지로 돌아간다. **닮은 훅을 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째
 * 규칙이다.
 */

export type UsersState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly users: readonly AdminUserSummary[]
      readonly nextCursor: string | null
    }

/**
 * 쓰기 하나의 결말.
 *
 * **`null` 이 세 번째 답이다** — 「아무것도 보내지 않았다」. 두 번 눌린 두 번째
 * 클릭이 그 자리이고, 그것을 실패로 돌려주면 화면은 방금 시작된 요청 위에 오류를
 * 그린다 (`use-reports.ts` 와 같은 규약).
 */
export type UserWrite<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface UsersController {
  readonly state: UsersState
  readonly filters: UserFilters
  readonly setFilters: (filters: UserFilters) => void
  readonly narrowed: boolean
  readonly pagination: CursorPagination
  /** 뼈대부터 다시 그린다. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
  /**
   * 뼈대를 그리지 않고 다시 읽는다.
   *
   * 정지·해제 뒤에 부른다. 뼈대부터 다시 그리면 방금 무엇을 했는지가 화면에서
   * 사라지고, 그 자리에 「불러오는 중」이 한 번 스친다.
   */
  readonly refresh: () => void
}

export function useUsers(): UsersController {
  const [state, setState] = useState<UsersState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<UserFilters>(EMPTY_USER_FILTERS)
  const [token, setToken] = useState(0)

  /**
   * 이번 다시 읽기가 **조용한 것인가.**
   *
   * 상태가 아니라 참조인 이유는 이 값이 **한 번의 실행**에만 해당하기 때문이다.
   * 상태로 두면 조용히 한 번 읽은 뒤에 「다시 시도」를 누른 사람에게도 「불러오는
   * 중」이 영영 나타나지 않는다 (`use-reports.ts` 와 같은 판단).
   */
  const quiet = useRef(false)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  useEffect(() => {
    const controller = new AbortController()
    const silent = quiet.current

    quiet.current = false

    async function load(): Promise<void> {
      if (!silent) setState({ status: 'loading' })

      try {
        const page = await fetchUsers(
          { ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ nextCursor: page.nextCursor, status: 'ready', users: page.users })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filters, cursor, token])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * 커서는 그 정렬과 그 필터 안에서만 위치를 뜻하므로 되돌리는 것이다 (설계서 커서
   * 규약).
   */
  const setFilters = useCallback(
    (next: UserFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const refresh = useCallback(() => {
    quiet.current = true
    setToken((previous) => previous + 1)
  }, [])

  const narrowed = useMemo(() => isNarrowed(filters), [filters])

  return { filters, narrowed, pagination, refresh, reload, setFilters, state }
}

/* ------------------------------------------------------- 연 계정 하나 -- */

/**
 * 지금 열려 있는 계정.
 *
 * `opening` 이 따로 있는 이유는 그것이 **네트워크를 도는 열람**이기 때문이다. 사유를
 * 적고 누른 사람은 대화상자가 닫히기 전에 답을 기다리고 있고, 그 사이에 아무 표시도
 * 없으면 한 번 더 누른다 — 그리고 그 두 번째 클릭은 열람 기록 두 줄이 된다.
 */
export type AccountState =
  | { readonly status: 'closed' }
  | { readonly status: 'opening' }
  | { readonly status: 'open'; readonly user: AdminUserDetail }

export interface UserAccountController {
  readonly state: AccountState
  /** 쓰기가 도는 중. 두 번째 클릭이 두 번째 요청이 되지 않게 한다 (U3). */
  readonly busy: boolean
  /**
   * 가리지 않은 값을 연다 — **사유와 함께** (F7).
   *
   * 이 호출 하나가 열람 기록 한 줄이다. 그래서 다시 읽기가 없다: 아래의 쓰기들은
   * 서버가 답으로 준 것만 화면에 앉히고, 답이 없는 쓰기(정지·해제)는 부르는 쪽이
   * 목록으로 확인한다.
   */
  readonly open: (userId: string, reason: string) => Promise<UserWrite<AdminUserDetail> | null>
  readonly close: () => void
  /** 정지 (F4). 204 라 앉힐 것이 없다 — 결과는 목록이 말한다. */
  readonly suspend: (userId: string, reason: string) => Promise<UserWrite<undefined> | null>
  readonly reinstate: (userId: string) => Promise<UserWrite<undefined> | null>
  /** 적립금 조정 (F5). 답의 잔액을 그대로 앉힌다 — 화면이 더하고 빼지 않는다. */
  readonly adjust: (
    userId: string,
    request: AdjustPointsRequest,
  ) => Promise<UserWrite<AdjustPointsResponse> | null>
  /** 역할 부여·회수 (F3). 답이 **바뀐 뒤의 집합 전체**라 그대로 앉힌다. */
  readonly grant: (userId: string, role: Role) => Promise<UserWrite<readonly Role[]> | null>
  readonly revoke: (userId: string, role: Role) => Promise<UserWrite<readonly Role[]> | null>
}

export function useUserAccount(): UserAccountController {
  const [state, setState] = useState<AccountState>({ status: 'closed' })
  const [busy, setBusy] = useState(false)

  /**
   * 도는 중인지를 **ref 로도** 든다.
   *
   * 두 번 눌린 두 번째 클릭은 리액트가 `busy: true` 로 다시 그리기 **전에** 도착한다
   * (`use-reports.ts` 가 같은 이유로 같은 장치를 쓴다). 열람에서 이것은 기록 한 줄의
   * 차이라 다른 화면보다 무겁다.
   */
  const inFlight = useRef(false)

  /** 한 번의 요청. 도는 중이면 `null` — 실패가 아니라 무행동이다. */
  const run = useCallback(
    async <TValue>(call: () => Promise<TValue>): Promise<UserWrite<TValue> | null> => {
      if (inFlight.current) return null

      inFlight.current = true
      setBusy(true)

      try {
        return { ok: true, value: await call() }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [],
  )

  /**
   * 열려 있는 계정에 서버의 답을 앉힌다.
   *
   * `open` 이 아니면 아무것도 하지 않는다. **닿는 자리다** — 답을 기다리는 동안
   * 사람이 창을 닫을 수 있고, 그때 상태를 되돌려 놓으면 닫은 화면이 다시 열린다.
   */
  const patch = useCallback((change: (user: AdminUserDetail) => AdminUserDetail) => {
    setState((previous) =>
      previous.status === 'open' ? { status: 'open', user: change(previous.user) } : previous,
    )
  }, [])

  /**
   * 열람은 `run` 을 쓰지 않는다.
   *
   * 다른 쓰기와 달리 **상태가 세 번 움직이기** 때문이다 — 보내기 전에 `opening`,
   * 답이 오면 `open`, 거절당하면 다시 `closed`. `run` 을 감싸면 그 세 자리를 밖에서
   * 다시 짜맞춰야 하고, 그러려면 「도는 중이라 안 보냈다」를 한 번 더 물어보는
   * 닿지 않는 갈래가 생긴다.
   */
  const open = useCallback(
    async (userId: string, reason: string): Promise<UserWrite<AdminUserDetail> | null> => {
      if (inFlight.current) return null

      inFlight.current = true
      setBusy(true)
      setState({ status: 'opening' })

      try {
        const { user } = await viewUser(userId, reason)

        setState({ status: 'open', user })

        return { ok: true, value: user }
      } catch (error) {
        setState({ status: 'closed' })

        return { failure: apiFailure(error), ok: false }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [],
  )

  const close = useCallback(() => {
    setState({ status: 'closed' })
  }, [])

  const suspend = useCallback(
    (userId: string, reason: string) => run(() => suspendUser(userId, reason)),
    [run],
  )

  const reinstate = useCallback((userId: string) => run(() => reinstateUser(userId)), [run])

  const adjust = useCallback(
    async (userId: string, request: AdjustPointsRequest) => {
      const result = await run(() => adjustPoints(userId, request))

      if (result?.ok === true) {
        // 잔액은 **서버가 답한 값**이다. 화면이 요청한 금액을 더하면, 잔액까지만
        // 간 차감에서 그 수가 원장과 어긋난다 (4.5).
        const { balance } = result.value

        patch((user) => ({ ...user, stats: { ...user.stats, pointBalance: balance } }))
      }

      return result
    },
    [patch, run],
  )

  const changeRoles = useCallback(
    async (call: () => Promise<{ readonly roles: readonly Role[] }>) => {
      const result = await run(call)

      if (result?.ok === true) {
        const { roles } = result.value

        patch((user) => ({ ...user, roles: [...roles] }))

        return { ok: true as const, value: roles }
      }

      return result
    },
    [patch, run],
  )

  const grant = useCallback(
    (userId: string, role: Role) => changeRoles(() => grantRole(userId, role)),
    [changeRoles],
  )

  const revoke = useCallback(
    (userId: string, role: Role) => changeRoles(() => revokeRole(userId, role)),
    [changeRoles],
  )

  return { adjust, busy, close, grant, open, reinstate, revoke, state, suspend }
}
