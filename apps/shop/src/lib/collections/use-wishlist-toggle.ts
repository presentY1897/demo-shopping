'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'

import { toggleWishlist } from './collections-api'
import {
  ensureWishlistKnown,
  forgetWishlist,
  publishWishlisted,
  useWishlisted,
} from './wishlist-state'

/**
 * 찜 버튼 하나의 상태 (TASK-0086 F1 · F2 · F6).
 *
 * ## 낙관적으로 그리고, 실패하면 되돌린다
 *
 * 서버 응답을 기다리면 반응이 느리게 느껴진다(4장). 그래서 누르는 순간 반대 상태를
 * 표에 적고, 답이 오면 **답이 말하는 상태로** 덮는다 — 「내가 적은 값이 맞았겠지」로
 * 두면 다른 탭에서 이미 뺀 것이 반영되지 않는다.
 *
 * 실패하면 **누르기 전 값으로 되돌린다.** 되돌릴 값이 답 안에 있는 것이 아니라
 * 누르기 전에 우리가 알고 있던 값이므로, 그 값을 잡아 두었다가 쓴다. 「모른다」에서
 * 눌러 실패했으면 다시 「모른다」로 — 실패를 「안 함」으로 바꾸면 화면이 모르는 것을
 * 아는 척하게 된다.
 *
 * ## 로그인하지 않은 사람은 이 훅을 부르지 않는다
 *
 * `signedIn` 이 거짓이면 `toggle` 은 아무 일도 하지 않고, 화면은 그 자리에 버튼이
 * 아니라 **로그인으로 가는 링크**를 그린다(F6 · R1). 눌러서 401 을 받는 것은 사람이
 * 고칠 수 없는 실패이고, 비로그인 찜을 로컬에 담지 않는 것은 R1 의 판단이다 —
 * 장바구니와 달리 구매 흐름을 막지 않는다.
 */

export interface WishlistToggle {
  /** `true` 찜함 · `false` 안 함 · `null` 아직 모른다. */
  readonly active: boolean | null
  /** 지금 서버에 나가 있는가. 중복 클릭을 막는 값이다 (U3). */
  readonly pending: boolean
  /** 마지막 토글이 실패했는가. 되돌린 뒤 이 줄이 붙는다 (F2). */
  readonly failed: boolean
  readonly toggle: () => void
}

export function useWishlistToggle(productId: string): WishlistToggle {
  const { state } = useAuth()
  const signedIn = state.status === 'signedIn'
  const active = useWishlisted(productId)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // 로그인한 사람에게만 목록을 묻는다. 익명에게 물으면 401 이 온다.
    if (signedIn) ensureWishlistKnown()
    else forgetWishlist()
  }, [signedIn])

  const toggle = useCallback(() => {
    if (!signedIn || pending) return

    // 「모른다」에서 누르는 것은 「담아 달라」다 — 담아 둔 상품 위에서 두 번 누르는
    // 것보다 처음 담는 쪽이 압도적으로 흔하고, 어느 쪽이든 답이 사실을 덮는다.
    const wanted = active !== true

    setFailed(false)
    setPending(true)
    publishWishlisted(productId, wanted)

    async function send(previous: boolean | null): Promise<void> {
      try {
        const answer = await toggleWishlist(productId)

        publishWishlisted(productId, answer.active)
      } catch {
        if (previous === null) forgetProduct()
        else publishWishlisted(productId, previous)

        setFailed(true)
      } finally {
        setPending(false)
      }
    }

    /**
     * 「모른다」로 되돌리는 방법.
     *
     * 표에서 한 칸만 지울 수는 없다 — 지우는 함수를 두면 그것이 「찜 해제」와
     * 헷갈린다. 대신 표 전체를 비우고 다시 묻게 한다. 실패한 사람 한 명의 화면에서
     * 요청 하나가 더 나가는 것이 「모르는 것을 아는 척」보다 낫다.
     */
    function forgetProduct(): void {
      forgetWishlist()
      if (signedIn) ensureWishlistKnown()
    }

    void send(active)
  }, [active, pending, productId, signedIn])

  return { active, failed, pending, toggle }
}
