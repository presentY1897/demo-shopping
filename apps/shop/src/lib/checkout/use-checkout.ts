'use client'

import type { Checkout } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { closeCheckoutOnLeave, readCheckout } from './checkout-api'
import type { Remaining } from './remaining'
import { remainingAt } from './remaining'
import { useNow } from './use-now'

/**
 * 주문서 하나의 상태 (TASK-0050).
 *
 * **이 화면은 주문서를 열지 않는다.** 여는 것은 장바구니의 「주문하기」이고, 여기는
 * id 로 읽기만 한다(4.1) — 진입할 때마다 열면 새로고침 한 번에 예약이 한 벌 더
 * 잡힌다.
 *
 * **떠날 때 푼다. 다만 의존하지 않는다** (4.4). 화면이 사라질 때와 문서가 사라질 때
 * 둘 다에서 보내고, 그래도 강제 종료에는 신호가 없다 — 최종 안전망은 만료
 * 스케줄러(TASK-0051)다.
 */

export type CheckoutState =
  | { readonly status: 'loading' }
  /** 만료됐거나 이미 풀렸다. 남은 것은 장바구니로 돌아가는 일뿐이다. */
  | { readonly status: 'gone' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly checkout: Checkout }

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
  /** 주문이 만들어졌으면 떠날 때 풀지 않는다 — 그 예약은 이제 주문의 것이다. */
  const keep = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const answer = await readCheckout(id, { signal: controller.signal })

        if (!controller.signal.aborted) setState({ status: 'ready', checkout: answer.checkout })
      } catch (error: unknown) {
        if (controller.signal.aborted) return

        // 없어진 주문서와 연결이 안 되는 것은 사람이 할 일이 다르다 — 하나는
        // 장바구니로 돌아가는 것이고 하나는 다시 시도하는 것이다.
        setState({ status: isMissing(error) ? 'gone' : 'failed' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [id])

  useEffect(() => {
    const leave = (): void => {
      if (!keep.current) closeCheckoutOnLeave(id)
    }

    // 탭을 닫거나 다른 사이트로 가는 경우. `unload` 가 아니라 `pagehide` 인 이유는
    // 뒤로가기 캐시(bfcache)가 있는 브라우저에서 `unload` 가 아예 안 오기 때문이다.
    window.addEventListener('pagehide', leave)

    return () => {
      window.removeEventListener('pagehide', leave)
      // 화면을 벗어나는 경우 — 뒤로가기를 포함한다 (F4).
      leave()
    }
  }, [id])

  const remaining = useRemaining(state.status === 'ready' ? state.checkout.expiresAt : null)

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
  const placed = useCallback(() => {
    keep.current = true
  }, [])

  return { state, remaining, placed }
}

/** 없어진 주문서인가 — 만료됐거나 이미 풀렸다. */
function isMissing(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false

  const failure = error as { status?: unknown }

  return failure.status === 404
}
