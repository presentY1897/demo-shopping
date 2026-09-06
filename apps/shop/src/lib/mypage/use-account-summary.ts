'use client'

import type { ApiFailure, PointSummaryResponse, UserCouponStatus } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'

import { fetchCouponCounts } from '@/lib/coupons/coupon-box-api'
import { fetchPointSummary } from '@/lib/points/points-api'

/**
 * 마이페이지가 머리에 다는 두 숫자 — 적립금 잔액과 쿠폰 수 (TASK-0077).
 *
 * **여기서 세지 않는다.** 잔액은 `/me/points` 가, 쿠폰 수는 `/me/coupons` 의 `counts`
 * 가 답한다 — 목록을 받아 와 길이를 세면 그 수는 **한 쪽의 길이**가 되고, 스물한 장을
 * 가진 사람에게 「쿠폰 20장」이라고 말하게 된다.
 *
 * **둘이 따로 실패한다.** 요약은 여러 사실을 나란히 놓는 자리이므로 하나가 실패했다고
 * 나머지를 감출 이유가 없다 — 적립금을 못 읽었다고 쿠폰 수까지 사라지면, 사람은 자기
 * 쿠폰이 없어졌다고 읽는다. 그래서 상태가 둘이고 `Promise.allSettled` 다.
 *
 * 실패한 쪽은 **숫자 대신 아무것도 그리지 않는다.** 요약의 숫자 하나가 0으로 보이는
 * 것과 비어 있는 것은 다른 말이고, 앞엣것은 거짓말이다.
 */

export type AccountFigure<TValue> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly value: TValue }

export interface AccountSummary {
  readonly points: AccountFigure<PointSummaryResponse>
  readonly coupons: AccountFigure<Readonly<Record<UserCouponStatus, number>>>
  readonly reload: () => void
}

export function useAccountSummary(): AccountSummary {
  const [points, setPoints] = useState<AccountFigure<PointSummaryResponse>>({ status: 'loading' })
  const [coupons, setCoupons] = useState<AccountFigure<Readonly<Record<UserCouponStatus, number>>>>(
    { status: 'loading' },
  )
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      const [balance, counts] = await Promise.allSettled([
        fetchPointSummary({ signal: controller.signal }),
        fetchCouponCounts({ signal: controller.signal }),
      ])

      if (controller.signal.aborted) return

      setPoints(
        balance.status === 'fulfilled'
          ? { status: 'ready', value: balance.value }
          : { status: 'error', failure: apiFailure(balance.reason) },
      )
      setCoupons(
        counts.status === 'fulfilled'
          ? { status: 'ready', value: counts.value }
          : { status: 'error', failure: apiFailure(counts.reason) },
      )
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setPoints({ status: 'loading' })
    setCoupons({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  return { coupons, points, reload }
}
