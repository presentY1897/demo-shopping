'use client'

import type { ApplicableCoupon, Checkout, CouponRecommendation } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { readCheckout, readCheckoutCoupons } from './checkout-api'
import { refusedForCoupons } from './coupon-failure'
import { toggledSelection } from './coupon-selection'
import type { Remaining } from './remaining'
import { remainingAt } from './remaining'
import { useNow } from './use-now'

/**
 * 주문서 하나의 상태 (TASK-0050 · TASK-0075).
 *
 * **이 화면은 주문서를 열지 않는다.** 여는 것은 장바구니의 「주문하기」이고, 여기는
 * id 로 읽기만 한다(4.1) — 진입할 때마다 열면 새로고침 한 번에 예약이 한 벌 더
 * 잡힌다.
 *
 * **떠날 때 푼다. 다만 의존하지 않는다** (4.4). 화면이 사라질 때와 문서가 사라질 때
 * 둘 다에서 보내고, 그래도 강제 종료에는 신호가 없다 — 최종 안전망은 만료
 * 스케줄러(TASK-0051)다.
 *
 * ## 고른 쿠폰은 상태이고, 금액은 그 상태의 함수다 (TASK-0075)
 *
 * 쿠폰을 고르는 일이 **주문서를 다시 읽는 일**이다. 깎인 금액을 화면이 계산하지
 * 않는 이유는 계약이 적어 둔 것과 같다 — 브라우저에 계산 엔진을 한 벌 더 두면
 * 「보여 준 금액과 저장되는 금액이 다르다」가 되는 날이 오고, 그날 어느 쪽이
 * 맞는지는 아무도 말할 수 없다. 그래서 선택은 이 훅의 상태이고 금액은 서버가
 * 답하는 값이다.
 *
 * **그 다시 읽기가 예약을 건드리지 않는다.** 여는 것도 푸는 것도 아닌 `GET` 이라
 * 재고와 무관하고, 이탈 해제 효과는 `id` 에만 매여 있어 선택이 바뀌어도 다시 걸리지
 * 않는다 — 매여 있었다면 쿠폰을 고를 때마다 해제 신호가 한 번씩 나가고, 그것은
 * 고르는 도중에 자기 재고를 푸는 일이다.
 *
 * **늦게 온 답이 새 답을 덮지 못한다.** 선택이 바뀌면 앞의 요청은 중단되고
 * (`AbortController`), 중단된 요청의 답은 버려진다. 이것이 없으면 쿠폰을 빨리
 * 두 번 누른 사람이 **첫 번째 선택의 금액**을 보게 되는데, 화면의 체크는 두 번째
 * 선택을 가리키고 있다.
 */

export type CheckoutState =
  | { readonly status: 'loading' }
  /** 만료됐거나 이미 풀렸다. 남은 것은 장바구니로 돌아가는 일뿐이다. */
  | { readonly status: 'gone' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly checkout: Checkout }

/**
 * 쿠폰함의 상태 (TASK-0075).
 *
 * 주문서와 **따로** 실패한다. 쿠폰을 못 읽었다고 주문서 전체를 오류 화면으로
 * 바꾸면 살 수 있었던 사람이 아무것도 못 하게 된다 — 배송지·카드와 같은 판단이고
 * (`use-address-book.ts`), 다른 것은 여기서는 「없음」과 「못 읽었음」을 가른다는
 * 점뿐이다. 쿠폰이 없는 사람과 못 읽은 사람에게 할 말이 다르기 때문이다.
 */
export type CheckoutCouponsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'ready'
      readonly coupons: readonly ApplicableCoupon[]
      readonly recommendation: CouponRecommendation
    }

export interface CheckoutStore {
  readonly state: CheckoutState
  readonly remaining: Remaining | null
  /**
   * 주문이 만들어졌다고 알려 준다.
   *
   * **주문을 만드는 것은 이 훅이 아니다** (TASK-0054). 결제가 주문에 붙으므로
   * (`POST /payments` 가 `orderId` 를 받는다) 주문 생성과 결제는 한 흐름이어야
   * 하고, 그 흐름은 결제 쪽이 들고 있다. 여기서 만들면 주문 id 가 두 훅에 나뉘어
   * 살고, 실제로 그렇게 만들었더니 이 훅의 `place` 가 아무도 안 부르는 코드가 됐다.
   */
  readonly placed: () => void
  /** 이 주문서에 쓸 수 있(고 없)는 쿠폰 전부 (TASK-0075). */
  readonly coupons: CheckoutCouponsState
  /** 지금 고른 장들. 순서가 곧 쿼리스트링의 순서다. */
  readonly selection: readonly string[]
  /** 한 장을 고르거나 뺀다. 중복 규칙은 `coupon-selection.ts` 가 쥔다. */
  readonly chooseCoupon: (userCouponId: string) => void
  /** 추천 조합을 그대로 고른다 (F7). */
  readonly chooseRecommended: () => void
  /**
   * 고른 선택으로 주문서를 다시 읽는 중.
   *
   * 화면을 `loading` 으로 되돌리지 **않는** 이유가 이 필드의 존재 이유다. 쿠폰
   * 하나에 주문서 전체가 사라졌다 나타나면 사람은 자기가 무엇을 망가뜨렸다고
   * 생각하고, 그 사이 배송지 선택과 스크롤 위치가 함께 사라진다.
   */
  readonly restoreSelection: (ids: readonly string[]) => void
  readonly repricing: boolean
  /**
   * 서버가 그 선택을 거절했고, 우리가 되돌렸다 (400).
   *
   * 사람이 잘못 고른 것이 아니므로 화면은 막히지 않는다 — 되돌린 선택으로 주문할
   * 수 있고, 그 사실을 한 문장으로 말한다.
   */
  readonly rejected: boolean
}

/**
 * 남은 시간을 매초 다시 센다. 만료되면 화면이 통째로 바뀐다.
 *
 * 「지금」은 {@link useNow} 가 외부 저장소로 들고 있다 — 효과 안에서 `setState` 를
 * 부르는 것도, 렌더 중에 `Date.now()` 를 부르는 것도 각각 다른 규칙이 막는다.
 */
function useRemaining(expiresAt: string | null): Remaining | null {
  const now = useNow()

  if (expiresAt === null || now === 0) return null

  return remainingAt(new Date(expiresAt), new Date(now))
}

export function useCheckout(id: string): CheckoutStore {
  const [state, setState] = useState<CheckoutState>({ status: 'loading' })
  const [coupons, setCoupons] = useState<CheckoutCouponsState>({ status: 'loading' })
  const [selection, setSelection] = useState<readonly string[]>([])
  const [repricing, setRepricing] = useState(false)
  const [rejected, setRejected] = useState(false)
  /**
   * 쿠폰함을 다시 읽게 하는 값.
   *
   * 400 을 받은 뒤에 하나 올린다. 거절의 뜻이 「목록을 읽은 뒤에 그 장의 사정이
   * 바뀌었다」이므로 화면에 남은 목록도 이미 틀렸고, 되돌리기만 하고 두면 같은
   * 사람이 같은 장을 한 번 더 골라 같은 거절을 받는다.
   */
  const [couponEpoch, setCouponEpoch] = useState(0)
  /** 주문이 만들어졌으면 떠날 때 풀지 않는다 — 그 예약은 이제 주문의 것이다. */
  const keep = useRef(false)
  /**
   * 서버가 마지막으로 받아 준 선택.
   *
   * 되돌릴 곳이다. 상태가 아니라 ref 인 이유는 이 값이 **그려지지 않기** 때문이고,
   * 상태로 두면 되돌리는 순간의 렌더가 한 번 더 늘 뿐이다.
   */
  const accepted = useRef<readonly string[]>([])

  // 배열은 렌더마다 새 참조라 효과의 의존성이 될 수 없다. 문자열 하나로 줄여
  // 두면 「같은 선택이면 다시 읽지 않는다」가 참조가 아니라 값으로 정해진다.
  const selectionKey = selection.join(',')

  useEffect(() => {
    const controller = new AbortController()
    const chosen = selectionKey === '' ? [] : selectionKey.split(',')

    async function load(): Promise<void> {
      setRepricing(true)

      try {
        const answer = await readCheckout(id, {
          signal: controller.signal,
          userCouponIds: chosen,
        })

        if (controller.signal.aborted) return

        accepted.current = chosen
        setState({ status: 'ready', checkout: answer.checkout })
      } catch (error: unknown) {
        if (controller.signal.aborted) return

        // 고른 조합이 거절당한 것은 주문서가 없어진 것도 연결이 끊긴 것도 아니다.
        // **화면은 그대로 두고 선택만 되돌린다** — 여기서 `failed` 로 옮기면 쿠폰
        // 한 장 때문에 살 수 있었던 주문서가 통째로 오류 화면이 된다.
        if (refusedForCoupons(error)) {
          setRejected(true)
          setSelection(accepted.current)
          setCouponEpoch((epoch) => epoch + 1)

          return
        }

        // 없어진 주문서와 연결이 안 되는 것은 사람이 할 일이 다르다 — 하나는
        // 장바구니로 돌아가는 것이고 하나는 다시 시도하는 것이다.
        setState({ status: isMissing(error) ? 'gone' : 'failed' })
      } finally {
        if (!controller.signal.aborted) setRepricing(false)
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [id, selectionKey])

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const answer = await readCheckoutCoupons(id, { signal: controller.signal })

        if (!controller.signal.aborted) {
          setCoupons({ status: 'ready', ...answer })
        }
      } catch {
        // 주문서는 그대로 둔다. 쿠폰을 못 읽은 사람도 주문은 할 수 있다.
        if (!controller.signal.aborted) setCoupons({ status: 'failed' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [id, couponEpoch])

  const remaining = useRemaining(state.status === 'ready' ? state.checkout.expiresAt : null)

  /**
   * 한 장을 고르거나 뺀다.
   *
   * 규칙은 여기 없다 — `toggledSelection` 이 쥔다. 이 함수가 하는 일은 목록을
   * 건네주고 결과를 상태로 옮기는 것, 그리고 **앞선 거절을 치우는 것**이다:
   * 사람이 다시 고르기 시작했으면 앞의 안내는 더 이상 지금 화면의 이야기가 아니다.
   */
  const chooseCoupon = useCallback(
    (userCouponId: string) => {
      if (coupons.status !== 'ready') return

      setRejected(false)
      setSelection((current) => toggledSelection(current, userCouponId, coupons.coupons))
    },
    [coupons],
  )

  /**
   * 추천 조합을 그대로 고른다 (F7).
   *
   * **한 장씩 누르는 것과 같은 길로 가지 않는다.** 추천은 서버가 계산 엔진을
   * 돌려 낸 답이고 중복 규칙을 이미 지키고 있으므로, 여기서 다시 규칙을 태우면
   * 순서에 따라 서로를 밀어내 추천과 다른 조합이 남을 수 있다.
   */
  const chooseRecommended = useCallback(() => {
    if (coupons.status !== 'ready') return

    setRejected(false)
    setSelection(coupons.recommendation.userCouponIds)
  }, [coupons])

  /**
   * 주문이 만들어졌다 — 이 주문서의 예약은 이제 그 주문의 것이다.
   *
   * **떠날 때 푸는 것을 멈춘다.** 주문이 생긴 뒤에도 해제 신호를 보내면, 결제가
   * 거절돼 다른 카드로 다시 하려는 사람의 재고를 우리 손으로 풀어 버린다 — 4.3 이
   * 지키려는 것이 정확히 그것이다.
   *
   * 결제까지 끝나면 예약은 `CONFIRMED` 라 해제가 무해하지만, 거절과 성공을 여기서
   * 구분하지 않는 이유는 **구분이 필요 없기 때문**이다: 주문이 생긴 순간부터
   * 이 화면은 그 예약의 주인이 아니다.
   *
   * **상태를 바꾸지 않는다.** 주문이 생겼다는 것은 아직 끝이 아니고 — 끝은 결제다 —
   * 여기서 화면을 완료로 옮기면 결제하는 중에 결제 영역이 사라진다.
   */
  const restoreSelection = useCallback((ids: readonly string[]) => setSelection([...ids]), [])

  const placed = useCallback(() => {
    keep.current = true
  }, [])

  return {
    restoreSelection,
    chooseCoupon,
    chooseRecommended,
    coupons,
    placed,
    rejected,
    remaining,
    repricing,
    selection,
    state,
  }
}

/** 없어진 주문서인가 — 만료됐거나 이미 풀렸다. */
function isMissing(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false

  const failure = error as { status?: unknown }

  return failure.status === 404
}
