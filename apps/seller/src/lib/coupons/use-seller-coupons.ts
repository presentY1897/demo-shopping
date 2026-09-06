'use client'

import type {
  ApiFailure,
  Coupon,
  CouponLifecycle,
  CouponListEntry,
  CouponListQueryParams,
  CreateCouponRequest,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useRef, useState } from 'react'

import { createCoupon, fetchSellerCoupons, setCouponSuspended } from './console-api'

/**
 * 이 스토어가 발행한 쿠폰 한 페이지, 그 위의 상태 필터, 그리고 두 개의 쓰기.
 *
 * `use-seller-claims.ts` 와 같은 뼈대다 — 서버 렌더에서 아무것도 기다리지 않고,
 * 커서는 `useCursorPagination` 이 들고, 필터가 바뀌면 첫 페이지로 돌아간다.
 * **닮은 훅을 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * 다른 것이 둘 있다.
 *
 * **`sellerId` 를 인자로 받는다.** 이 목록이 누구 것인지를 정하는 값이고, 없으면
 * 서버는 플랫폼 쿠폰 목록으로 읽어 403 을 돌려준다 — 「내 쿠폰이 없다」가 아니라
 * 「권한이 없다」로 끝나는 것이다. 훅 안에서 세션을 읽지 않는 이유는 그 판단이
 * **화면의 것**이기 때문이다: 스토어가 없는 계정에는 이 훅을 아예 마운트하지 않고
 * 입점 신청으로 안내한다.
 *
 * **조용한 다시 읽기가 있다.** 중단·재개와 발행은 전부 이 화면 안에서 일어나고,
 * 그때 목록이 스켈레톤으로 되돌아가면 방금 무엇이 바뀌었는지 볼 수 없다. 쓰기가
 * 답한 `Coupon` 만으로 줄을 고칠 수 없다는 사실이 이 장치를 필요하게 만든다 —
 * 목록의 줄에는 정책 말고도 **상태와 통계**가 실려 있고, 그 둘은 서버가 계산한다.
 */

export type SellerCouponsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly CouponListEntry[]
      readonly nextCursor: string | null
    }

/**
 * 필터 바가 들고 있는 것.
 *
 * `null` 은 「전체」다. 계약의 `lifecycle` 은 목록이지만 화면이 고르는 것은 한
 * 값이고, 보낼 때 한 원소짜리 목록으로 감싼다 — 문법은 여전히 쉼표 하나다
 * (`claim-filters.tsx` 가 상태 축에 대해 같은 말을 적어 두었다).
 */
export interface SellerCouponFilters {
  readonly lifecycle: CouponLifecycle | null
}

export const EMPTY_COUPON_FILTERS: SellerCouponFilters = { lifecycle: null }

/** 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다. */
export function queryOf(sellerId: string, filters: SellerCouponFilters): CouponListQueryParams {
  return {
    sellerId,
    ...(filters.lifecycle === null ? {} : { lifecycle: [filters.lifecycle] }),
  }
}

/**
 * 쓰기 하나의 결말.
 *
 * 던지지 않는다 — 부르는 쪽이 계속 그려야 하고, 실패는 `ApiFailure` 로 화면에
 * 닿아야 문장을 카탈로그가 정한다 (TASK-0117).
 */
export type SellerCouponWrite =
  | { readonly ok: true; readonly coupon: Coupon }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface SellerCouponsController {
  readonly state: SellerCouponsState
  readonly filters: SellerCouponFilters
  readonly setFilters: (filters: SellerCouponFilters) => void
  readonly isFiltered: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
  /** 발행. 성공하면 목록을 **조용히** 다시 읽는다. */
  readonly issue: (request: CreateCouponRequest) => Promise<SellerCouponWrite>
  /** 발행 중단·재개. 지금 멈춰 있는 쿠폰에는 `false` 를 보낸다. */
  readonly setSuspended: (couponId: string, suspended: boolean) => Promise<SellerCouponWrite>
  /** 지금 쓰기가 나가 있는 쿠폰의 id. 그 줄의 버튼만 잠근다 (U3). */
  readonly pendingId: string | null
}

export function useSellerCoupons(sellerId: string): SellerCouponsController {
  const [state, setState] = useState<SellerCouponsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<SellerCouponFilters>(EMPTY_COUPON_FILTERS)
  const [reloadToken, setReloadToken] = useState(0)
  const [pendingId, setPendingId] = useState<string | null>(null)

  /** 화면을 스켈레톤으로 되돌리지 않아야 하는 다시 읽기. */
  const silent = useRef(false)

  const paging = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = paging

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      if (!silent.current) setState({ status: 'loading' })
      silent.current = false

      try {
        const page = await fetchSellerCoupons(
          { ...queryOf(sellerId, filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ status: 'ready', items: page.coupons, nextCursor: page.nextCursor })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [sellerId, filters, cursor, reloadToken])

  /**
   * 필터가 바뀌면 첫 페이지로 돌아간다.
   *
   * 커서는 **그 정렬과 그 필터 안에서만** 위치를 뜻한다. 넘겨받은 커서를 그대로
   * 쓰면 이제 존재하지 않는 목록을 이어 달라고 하는 셈이다.
   */
  const setFilters = useCallback(
    (next: SellerCouponFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  /** 쓰기가 끝난 뒤 목록을 다시 읽되, 스켈레톤으로 되돌리지 않는다. */
  const refresh = useCallback(() => {
    silent.current = true
    setReloadToken((token) => token + 1)
  }, [])

  const issue = useCallback(
    async (request: CreateCouponRequest): Promise<SellerCouponWrite> => {
      try {
        const { coupon } = await createCoupon(request)

        refresh()

        return { ok: true, coupon }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [refresh],
  )

  const setSuspended = useCallback(
    async (couponId: string, suspended: boolean): Promise<SellerCouponWrite> => {
      setPendingId(couponId)

      try {
        const { coupon } = await setCouponSuspended(couponId, suspended)

        refresh()

        return { ok: true, coupon }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      } finally {
        setPendingId(null)
      }
    },
    [refresh],
  )

  return {
    state,
    filters,
    setFilters,
    isFiltered: filters.lifecycle !== null,
    pagination: paging,
    reload,
    issue,
    setSuspended,
    pendingId,
  }
}
