'use client'

import type { AdminClaimListItem, ApiFailure } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { AdminClaimFilters } from './claim-console'
import { EMPTY_ADMIN_CLAIM_FILTERS, isNarrowed, queryOf } from './claim-console'
import { fetchAdminClaims } from './console-api'

/**
 * 한 페이지의 클레임과 그 위의 필터.
 *
 * `use-seller-review.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지 않고,
 * 커서는 `useCursorPagination` 이 들며, 필터가 바뀌면 첫 페이지로 돌아간다. **닮은
 * 훅을 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * 다른 것이 하나 있고, 그것은 **이 화면이 목록에서 아무것도 쓰지 않는다**는 사실에서
 * 나온다: 조용한 다시 읽기가 없다. 강제 처리와 이의 기각은 전부 상세에서 일어나고,
 * 목록으로 돌아오는 길은 라우팅이라 그때 이 훅은 처음부터 다시 읽는다 — 부를 사람이
 * 없는 `refresh()` 를 남겨 두면 다음 사람은 그것이 **왜** 안 불리는지를 먼저
 * 알아내야 한다.
 */

export type AdminClaimsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly AdminClaimListItem[]
      readonly nextCursor: string | null
    }

export interface AdminClaimsController {
  readonly state: AdminClaimsState
  readonly filters: AdminClaimFilters
  readonly setFilters: (filters: AdminClaimFilters) => void
  readonly narrowed: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
}

export function useAdminClaims(): AdminClaimsController {
  const [state, setState] = useState<AdminClaimsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<AdminClaimFilters>(EMPTY_ADMIN_CLAIM_FILTERS)
  const [reloadToken, setReloadToken] = useState(0)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const page = await fetchAdminClaims(
          { ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ status: 'ready', items: page.claims, nextCursor: page.nextCursor })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filters, cursor, reloadToken])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * 커서는 **그 정렬과 그 필터 안에서만** 위치를 뜻한다. 넘겨받은 커서를 그대로 쓰면
   * 이제 존재하지 않는 목록을 이어 달라고 하는 셈이다 (설계서 커서 규약).
   */
  const setFilters = useCallback(
    (next: AdminClaimFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const narrowed = useMemo(() => isNarrowed(filters), [filters])

  return { filters, narrowed, pagination, reload, setFilters, state }
}
