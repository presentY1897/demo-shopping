'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { signInHref } from '@/lib/auth/next-path'

import { toggleWishlist } from './collections-api'
import {
  ensureWishlistKnown,
  forgetWishlist,
  publishWishlisted,
  wishlistedNow,
} from './wishlist-state'

/**
 * 목록의 카드 스무 개가 **함께 쓰는** 찜 핸들러 (TASK-0086 F1 · F2 · F6).
 *
 * ## 왜 카드마다 훅을 두지 않나
 *
 * 카드는 `packages/ui` 의 `ProductCard` 이고 그 컴포넌트가 받는 것은 `onWishlist(id)`
 * 하나다. 판단을 카드 안으로 넣으려면 그 패키지가 세션과 라우터를 알아야 하는데,
 * 그것은 앱의 것이지 공용 UI 의 것이 아니다. 그래서 판단은 목록 쪽에 한 벌 있고,
 * 카드는 id 만 넘긴다. **눌린 상태는** 카드가 직접 표에서 읽는다
 * (`components/catalog/search-hit-card.tsx`).
 *
 * ## 낙관적으로 뒤집고, 실패하면 되돌린다
 *
 * 카드가 눌린 상태를 그리게 된 뒤로(4.6) 이 훅도 상세의 버튼과 같은 일을 한다 —
 * 누르는 순간 표를 뒤집고, 답이 오면 **답이 말하는 상태로** 덮는다. 답을 기다렸다
 * 그리면 스무 개짜리 격자에서 그 지연이 특히 크게 느껴진다.
 *
 * 「모른다」에서 눌러 실패했으면 다시 「모른다」로 돌아간다. 실패를 「안 함」으로
 * 바꾸면 화면이 모르는 것을 아는 척하게 된다.
 *
 * ## 남는 문장은 **실패뿐**이다
 *
 * 담겼는지 빠졌는지는 이제 하트가 `aria-pressed` 로 말한다 — 같은 사실을 문장으로
 * 한 번 더 말하면 스크린 리더는 한 번의 클릭에 두 번 말하게 된다. 하지만 **실패는
 * `aria-pressed` 가 말할 수 없다**: 되돌아간 하트는 「원래 그랬던 것」과 구별되지
 * 않고, 사람은 자기가 잘못 눌렀다고 읽는다. 그래서 그 한 줄만 남았다.
 *
 * ## 로그인하지 않은 사람은 로그인으로 간다
 *
 * 하트는 그대로 있고, 누르면 401 이 아니라 로그인 화면이다 (F6). 카드의 하트는
 * 버튼이라 링크로 바꿀 수 없으므로 여기서 이동시킨다 — 지금 보던 주소가 `next` 로
 * 따라간다.
 */

export interface CardWishlist {
  readonly toggle: (productId: string) => void
  /** 마지막 토글이 실패했는가. 되돌린 하트만으로는 아무 일도 없었던 것처럼 보인다. */
  readonly failed: boolean
}

export function useCardWishlist(): CardWishlist {
  const { state } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const signedIn = state.status === 'signedIn'
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (signedIn) ensureWishlistKnown()
    else forgetWishlist()
  }, [signedIn])

  const toggle = useCallback(
    (productId: string) => {
      if (!signedIn) {
        router.push(signInHref('/login', pathname))

        return
      }

      // 「모른다」에서 누르는 것은 「담아 달라」다 — 담아 둔 상품 위에서 두 번 누르는
      // 것보다 처음 담는 쪽이 압도적으로 흔하고, 어느 쪽이든 답이 사실을 덮는다.
      const previous = wishlistedNow(productId)

      setFailed(false)
      publishWishlisted(productId, previous !== true)

      async function send(): Promise<void> {
        try {
          // 답이 곧 지금 상태다. 화면이 세면 다른 탭에서 이미 뺀 것이 반영되지 않는다.
          const answer = await toggleWishlist(productId)

          publishWishlisted(productId, answer.active)
        } catch {
          // 표에서 한 칸만 지울 수는 없다 — 지우는 함수를 두면 그것이 「찜 해제」와
          // 헷갈린다. 대신 표 전체를 비우고 다시 묻게 한다 (`use-wishlist-toggle.ts`).
          if (previous === null) {
            forgetWishlist()
            ensureWishlistKnown()
          } else {
            publishWishlisted(productId, previous)
          }

          setFailed(true)
        }
      }

      void send()
    },
    [pathname, router, signedIn],
  )

  return { failed, toggle }
}
