'use client'

import type {
  ApiFailure,
  BulkIssueResponse,
  BulkIssueTarget,
  CouponListEntry,
  CouponStats,
  CreateCouponRequest,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  bulkIssueCoupon,
  createPlatformCoupon,
  fetchPlatformCoupons,
  setCouponSuspended,
} from './console-api'
import type { PlatformCouponFilters } from './platform-coupons'
import { EMPTY_PLATFORM_COUPON_FILTERS, isNarrowed, queryOf } from './platform-coupons'

/**
 * 한 페이지의 플랫폼 쿠폰과, 그 목록에 하는 세 가지 일.
 *
 * `use-admin-claims.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지 않고, 커서는
 * `useCursorPagination` 이 들며, 필터가 바뀌면 첫 페이지로 돌아간다. **닮은 훅을 새
 * 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * 다른 것이 하나 있고, 그것은 이 화면이 **목록 위에서 쓰기를 한다**는 사실에서 나온다:
 * 클레임 콘솔의 개입은 전부 상세에서 일어나 목록으로 돌아오는 길이 라우팅이었지만,
 * 중단·재개와 일괄 지급은 줄 위에서 일어난다. 그래서 조용한 다시 읽기(`refresh`)가
 * 있고, 그것이 「멈췄는데 목록은 여전히 진행 중이라고 적혀 있는」 화면을 막는다 —
 * 상태는 저장된 칸이 아니라 **계산되는 값**이라(`couponLifecycleOf`) 응답 하나를
 * 덮어써서는 맞출 수 없다.
 *
 * **쓰기는 던지지 않고 답한다.** 부르는 쪽이 전부 다이얼로그와 토스트라, 예외를
 * 던지면 화면이 그리기를 멈추는 대신 각자 `try` 로 감싸게 된다.
 */

export type PlatformCouponsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly entries: readonly CouponListEntry[]
      /**
       * 이 콘솔이 낸 쿠폰 **전부**의 누계 — 필터와 페이지에 무관하다.
       *
       * 줄들의 합이 아니라 서버가 따로 세어 보낸 값이라(`couponListResponseSchema`),
       * 화면이 페이지를 넘겨도 흔들리지 않는다. 여기서 합을 다시 계산하면 그 성질이
       * 사라진다.
       */
      readonly totals: CouponStats
      readonly nextCursor: string | null
    }

/** 쓰기 하나의 결과. 실패는 값이고, 문장으로 바꾸는 것은 화면의 몫이다. */
export type CouponMutationResult<TValue = undefined> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface PlatformCouponsController {
  readonly state: PlatformCouponsState
  readonly filters: PlatformCouponFilters
  readonly setFilters: (filters: PlatformCouponFilters) => void
  readonly narrowed: boolean
  readonly pagination: CursorPagination
  /** 뼈대부터 다시 그린다. 오류 화면의 「다시 시도」가 부른다. */
  readonly reload: () => void
  readonly create: (input: CreateCouponRequest) => Promise<CouponMutationResult>
  readonly setSuspended: (couponId: string, suspended: boolean) => Promise<CouponMutationResult>
  readonly bulkIssue: (
    couponId: string,
    target: BulkIssueTarget,
  ) => Promise<CouponMutationResult<BulkIssueResponse>>
}

export function usePlatformCoupons(): PlatformCouponsController {
  const [state, setState] = useState<PlatformCouponsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<PlatformCouponFilters>(EMPTY_PLATFORM_COUPON_FILTERS)
  const [reloadToken, setReloadToken] = useState(0)
  /**
   * 이번 다시 읽기가 **조용한 것인가.**
   *
   * 쓰기 뒤의 다시 읽기는 뼈대를 지우지 않는다 — 중단 버튼 하나에 목록이 통째로
   * 사라졌다가 돌아오면, 방금 무엇을 눌렀는지가 화면에서 사라진다. 상태가 아니라
   * 참조인 이유는 이 값이 **한 번의 실행**에만 해당하기 때문이다: 상태로 두면 조용히
   * 한 번 읽은 뒤 필터를 바꾼 사람에게도 「불러오는 중」이 영영 나타나지 않는다.
   */
  const quiet = useRef(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  useEffect(() => {
    const controller = new AbortController()

    const silent = quiet.current

    quiet.current = false

    async function load(): Promise<void> {
      // 조용한 다시 읽기에서는 「불러오는 중」으로 되돌아가지 않는다.
      if (!silent) setState({ status: 'loading' })

      try {
        const page = await fetchPlatformCoupons(
          { ...queryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({
          entries: page.coupons,
          nextCursor: page.nextCursor,
          status: 'ready',
          totals: page.totals,
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
  }, [filters, cursor, reloadToken, refreshToken])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * 커서는 **그 정렬과 그 필터 안에서만** 위치를 뜻한다. 넘겨받은 커서를 그대로 쓰면
   * 이제 존재하지 않는 목록을 이어 달라고 하는 셈이다 (설계서 커서 규약).
   */
  const setFilters = useCallback(
    (next: PlatformCouponFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  const refresh = useCallback(() => {
    quiet.current = true
    setRefreshToken((token) => token + 1)
  }, [])

  const create = useCallback(
    async (input: CreateCouponRequest): Promise<CouponMutationResult> => {
      try {
        await createPlatformCoupon(input)
        // 새 쿠폰은 목록의 맨 앞에 선다. 첫 페이지로 돌아가지 않으면 방금 만든 것이
        // 어디에도 보이지 않는 채 「발행했습니다」만 남는다.
        reset()
        refresh()

        return { ok: true, value: undefined }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      }
    },
    [refresh, reset],
  )

  const setSuspended = useCallback(
    async (couponId: string, suspended: boolean): Promise<CouponMutationResult> => {
      try {
        await setCouponSuspended(couponId, suspended)
        // 응답의 쿠폰으로 그 줄만 갈아 끼우지 않는다 — 목록이 그리는 것은 **계산된
        // 상태**이고, 그것은 응답에 실려 오지 않는다.
        refresh()

        return { ok: true, value: undefined }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      }
    },
    [refresh],
  )

  const bulkIssue = useCallback(
    async (
      couponId: string,
      target: BulkIssueTarget,
    ): Promise<CouponMutationResult<BulkIssueResponse>> => {
      try {
        const result = await bulkIssueCoupon(couponId, target)

        // 발급 수가 늘고, 그것이 「소진」으로 넘어갔을 수도 있다.
        refresh()

        return { ok: true, value: result }
      } catch (error) {
        return { failure: apiFailure(error), ok: false }
      }
    },
    [refresh],
  )

  const narrowed = useMemo(() => isNarrowed(filters), [filters])

  return {
    bulkIssue,
    create,
    filters,
    narrowed,
    pagination,
    reload,
    setFilters,
    setSuspended,
    state,
  }
}
