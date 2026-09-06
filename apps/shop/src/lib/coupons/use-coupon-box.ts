'use client'

import type { ApiFailure, UserCoupon, UserCouponStatus } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { claimCoupon, fetchUserCoupons } from './coupon-box-api'

/**
 * `/mypage/coupons` 뒤의 쿠폰함 (TASK-0077 F1 · F3).
 *
 * ## 탭이 바뀌면 **다시 부른다**
 *
 * `status` 가 질의의 일부이므로(계약) 탭은 다른 질문이고, 지금까지 이어 붙인 것은 그
 * 질문의 답이 아니다 — 남겨 두면 「사용함」 탭에 쓸 수 있는 쿠폰이 섞여 남는다. 받은
 * 것 위에서 거르는 길도 있었지만 그러면 커서가 「전부」의 커서가 되어, 탭마다 남은
 * 장이 있는지를 말할 수 없다 (주문 내역이 필터를 서버로 옮긴 것과 같은 판단).
 *
 * ## 수는 **탭과 함께 움직이지 않는다**
 *
 * `counts` 는 `status` 로 좁혀도 같은 값이라(계약), 탭을 옮겨도 배지 셋이 그대로다.
 * 그래서 마지막으로 받은 수를 들고 있다가 다음 답이 올 때 갈아 끼운다 — 탭을 옮길
 * 때마다 `null` 로 되돌리면 배지 셋이 매번 사라졌다 나타나고, 그 깜빡임은 「수가
 * 바뀌었다」로 읽힌다.
 *
 * ## 받은 뒤에는 목록을 **다시 읽는다**
 *
 * 응답이 들고 온 장을 목록 앞에 끼워 넣지 않는다. 그렇게 하면 배지의 수는 옛 값으로
 * 남고, 그때 화면은 「사용 가능 3장」이라고 말하면서 네 장을 보여 준다 —
 * `use-cards.ts` 가 쓰기 뒤에 목록을 다시 읽는 것과 같은 이유이고, 여기서는 그
 * 어긋남이 배지라는 눈에 보이는 자리에 나타난다.
 */

export type CouponBoxState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready' }

/** 코드 등록의 결말. 성공하면 **어느 쿠폰이 들어왔는지**까지 말한다. */
export type CouponClaimResult =
  | { readonly ok: true; readonly coupon: UserCoupon }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface CouponBox {
  readonly tab: UserCouponStatus
  readonly select: (tab: UserCouponStatus) => void
  readonly state: CouponBoxState
  /** 지금 탭에서 지금까지 불러온 장 전부. 최신순이다. */
  readonly items: readonly UserCoupon[]
  /** 탭에 붙는 세 수. 첫 답이 오기 전에는 `null` — 0과 구분해야 한다. */
  readonly counts: Readonly<Record<UserCouponStatus, number>> | null
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly loadMoreFailure: ApiFailure | null
  readonly reload: () => void
  readonly claim: (code: string) => Promise<CouponClaimResult>
}

/** 어느 요청의 결과인가. 탭이 바뀌면 지난 결과는 **다른 질문의 답**이 된다. */
interface Settled {
  readonly key: string
  readonly state: CouponBoxState
}

export function useCouponBox(initialTab: UserCouponStatus = 'ISSUED'): CouponBox {
  const [tab, setTab] = useState<UserCouponStatus>(initialTab)
  const [settled, setSettled] = useState<Settled | null>(null)
  const [items, setItems] = useState<readonly UserCoupon[]>([])
  const [counts, setCounts] = useState<Readonly<Record<UserCouponStatus, number>> | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailure, setLoadMoreFailure] = useState<ApiFailure | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /** 「다시 시도」와 「받은 뒤 다시 읽기」는 같은 탭의 새 요청이라 열쇠에 회차가 붙는다. */
  const requestKey = `${tab}#${String(reloadToken)}`

  /**
   * 「기다리는 중」은 **저장하지 않고 유도한다.**
   *
   * 탭이 바뀌면 화면은 그 순간부터 기다리는 중인데, 그것을 효과 안에서 `setState` 로
   * 적으면 렌더가 한 번 더 돈다(`react-hooks/set-state-in-effect`). 「마지막으로 받은
   * 답이 지금 탭의 것인가」를 물으면 같은 사실이 상태 없이 나온다.
   */
  const state: CouponBoxState = settled?.key === requestKey ? settled.state : { status: 'loading' }

  /**
   * 이미 요청한 커서.
   *
   * 「더 보기」를 빠르게 두 번 누르면 같은 커서로 두 번 묻고, 그러면 같은 장이 목록에
   * 두 벌 들어간다. `loadingMore` 만으로는 그 사이의 경주를 막지 못한다 — 상태 갱신은
   * 다음 렌더에서야 보인다.
   */
  const requested = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchUserCoupons(tab, null, { signal: controller.signal })
        if (controller.signal.aborted) return

        // 이어 붙이지 않고 **갈아 끼운다.** 탭이 바뀌었으면 지금까지의 것은 다른
        // 질문의 답이다.
        setItems(page.coupons)
        setCounts(page.counts)
        setCursor(page.nextCursor)
        setLoadMoreFailure(null)
        requested.current = null
        setSettled({ key: requestKey, state: { status: 'ready' } })
      } catch (error) {
        if (controller.signal.aborted) return
        setSettled({ key: requestKey, state: { status: 'error', failure: apiFailure(error) } })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
    // `requestKey` 가 「지금 무엇을 묻고 있나」의 전부다. `tab` 은 그 안에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tab` 은 `requestKey` 의 앞부분이고, 목록에 넣으면 같은 질문을 두 번 묻는다.
  }, [requestKey])

  const reload = useCallback(() => {
    setItems([])
    setCursor(null)
    setLoadMoreFailure(null)
    requested.current = null
    setReloadToken((token) => token + 1)
  }, [])

  const select = useCallback((next: UserCouponStatus) => {
    setItems([])
    setCursor(null)
    setLoadMoreFailure(null)
    requested.current = null
    setTab(next)
  }, [])

  const loadMore = useCallback(() => {
    if (cursor === null || requested.current === cursor) return

    requested.current = cursor
    setLoadingMore(true)
    setLoadMoreFailure(null)

    async function next(from: string, status: UserCouponStatus): Promise<void> {
      try {
        const page = await fetchUserCoupons(status, from)

        // 이어 붙인다. 갈아치우면 「더 보기」가 목록을 지우는 버튼이 된다.
        setItems((existing) => [...existing, ...page.coupons])
        setCounts(page.counts)
        setCursor(page.nextCursor)
      } catch (error) {
        setLoadMoreFailure(apiFailure(error))
        // 같은 커서를 다시 시도할 수 있어야 한다. 실패한 요청이 그 쪽을 영원히
        // 잠그면 사람이 할 수 있는 일이 새로고침뿐이 된다.
        requested.current = null
      } finally {
        setLoadingMore(false)
      }
    }

    void next(cursor, tab)
  }, [cursor, tab])

  const claim = useCallback(
    async (code: string): Promise<CouponClaimResult> => {
      try {
        const { userCoupon } = await claimCoupon(code)

        // 받은 장은 `ISSUED` 다. 다른 탭에서 코드를 넣었으면 그 탭을 다시 읽어 봐야
        // 아무것도 달라지지 않으므로, 새 장이 있는 탭으로 옮겨 준다 — 그러지 않으면
        // 「받았습니다」라고 말한 화면에 받은 것이 없다.
        if (tab === 'ISSUED') reload()
        else select('ISSUED')

        return { ok: true, coupon: userCoupon }
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [reload, select, tab],
  )

  return {
    claim,
    counts,
    // **답을 받은 뒤에만 참이다.** 탭을 바꾼 직후의 커서는 지난 질문의 것이라,
    // 그것으로 「더 보기」를 그리면 아직 오지도 않은 목록의 다음 쪽을 권하게 된다.
    hasMore: state.status === 'ready' && cursor !== null,
    items,
    loadMore,
    loadMoreFailure,
    loadingMore,
    reload,
    select,
    state,
    tab,
  }
}
