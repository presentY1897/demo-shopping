'use client'

import type { WishlistItem } from '@shopping/shared'
import { useSyncExternalStore } from 'react'

import { fetchWishlistIds } from './collections-api'

/**
 * 「이 상품을 찜했나」를 아는 유일한 자리 (TASK-0086 F1 · 4.5).
 *
 * ## 상품 하나를 묻는 문은 없고, 있어서도 안 된다
 *
 * 하트는 홈의 카드 열두 개, 검색 결과의 카드 스무 개, 상세의 버튼 하나에 동시에
 * 있다. 상품마다 한 번씩 묻는 문을 내면 홈 한 장에 요청이 열두 개 나가고, 상품 상세
 * 응답도 찜 여부를 싣지 않는다(`productDetailResponseSchema`). 그래서 답은 **전부
 * 한 번에**이고, 그것이 `GET /me/wishlist/ids` 다.
 *
 * ## 목록으로는 이 물음에 답할 수 없다
 *
 * 한때 이 표를 `GET /me/wishlist` 로 채웠다. 목록은 한 쪽이 100개까지라
 * (`WISHLIST_MAX_LIMIT`), **101개를 담은 사람의 화면에서는 못 본 쪽의 상품이
 * 「모른다」로 남았다** — 새로고침할 때마다 그 하트들이 빈 채로 그려졌고, 그것이
 * F1 의 「새로고침 후 유지」가 지켜지지 않는다는 뜻이었다. 오류는 한 줄도 뜨지 않는다.
 *
 * id 만 담은 답에는 페이지가 없다. **그것이 요점이다** — 페이지가 있으면 「여기
 * 없다」가 「찜하지 않았다」를 뜻하지 못하고, 그래서 이 파일에는 「목록을 끝까지
 * 읽었나」를 세던 장치가 더는 없다.
 *
 * ## 그래도 「모른다」는 남아 있다
 *
 * `null` 은 **아직 묻지 않았다 · 로그인하지 않았다**이고, 답이 온 뒤의 「표에 없다」는
 * `false` 다. 둘을 같게 두면 답이 오기 전의 하트가 「누르지 않음」이라고 말하게 되고,
 * 담아 둔 카드가 새로고침마다 한 번씩 비었다가 찬다 — 그 사이에 누른 사람은 **이미
 * 담은 것을 뺀다** (4.6). 카드의 하트가 셋을 그리는 것이 그래서다.
 *
 * ## 컨텍스트가 아니라 모듈 하나인 이유
 *
 * 컨텍스트로 감싸면 하트 하나가 바뀔 때마다 그 셸 전체가 다시 그려진다 — 장바구니
 * 배지가 같은 이유로 같은 모양이다 (`lib/cart/cart-count.ts`).
 */

/** `productId` → 찜했는가. */
let known = new Map<string, boolean>()

/** 완전한 답을 받았나. 참일 때만 「표에 없다」가 「찜하지 않았다」가 된다. */
let loaded = false

/** 이미 물어봤나. 실패해도 참이다 — 버튼이 스무 개면 재시도도 스무 번이 된다. */
let asked = false

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** 토글의 답이 부른다. **답이 곧 지금 상태**이므로 화면이 세지 않는다. */
export function publishWishlisted(productId: string, active: boolean): void {
  if (known.get(productId) === active) return

  known = new Map(known).set(productId, active)
  emit()
}

/**
 * 위시리스트 화면이 받아 온 줄들.
 *
 * 완전함을 주장하지 않는다 — 이 목록에는 다음 장이 있을 수 있으므로 `loaded` 를
 * 건드리지 않고 **아는 것만 더한다.** 그래도 부르는 이유는 그 화면에서 상품 상세로
 * 넘어갔을 때 하트가 빈 채로 한 번 그려지는 것을 막기 때문이고, 그 깜빡임이 바로
 * 4.6 이 「이미 담은 것을 뺀다」고 적은 자리다.
 */
export function publishWishlistPage(items: readonly WishlistItem[]): void {
  if (items.length === 0) return

  const next = new Map(known)

  for (const item of items) next.set(item.productId, true)

  known = next
  emit()
}

/** 로그아웃처럼 「이제 모른다」로 돌아가는 순간. */
export function forgetWishlist(): void {
  if (known.size === 0 && !loaded && !asked) return

  known = new Map()
  loaded = false
  asked = false
  emit()
}

/**
 * 아직 묻지 않았으면 묻는다. 이미 묻고 있으면 아무 일도 하지 않는다.
 *
 * 실패해도 다시 묻지 않는 이유는 이 요청이 **화면이 청한 것이 아니기** 때문이다.
 * 사람은 찜 버튼을 보고 있을 뿐이고, 그 자리에 「목록을 못 읽었어요」를 그릴 자리는
 * 없다 — 못 읽으면 버튼은 「모른다」인 채로 여전히 눌린다.
 */
export function ensureWishlistKnown(): void {
  if (asked) return

  asked = true

  void fetchWishlistIds()
    .then(({ productIds }) => {
      const next = new Map<string, boolean>()

      // 더하는 것이 아니라 **갈아치운다.** 이 답이 완전하므로, 여기 없는 id 를
      // 표가 계속 참이라고 말하고 있을 이유가 없다.
      //
      // 답을 기다리는 사이에 누른 하트는 이 교체가 한 번 되돌린다. 그래도 괜찮은
      // 것은 **토글의 답이 곧 따라오기** 때문이다 — 모든 낙관적 갱신 뒤에는 서버가
      // 말한 상태를 적는 `publishWishlisted` 가 있고, 그 자리가 마지막 말이다.
      for (const productId of productIds) next.set(productId, true)

      known = next
      loaded = true
      emit()
    })
    .catch(() => {
      // 「모른다」인 채로 둔다. 아래 훅이 그것을 그릴 줄 안다.
    })
}

/**
 * 서버 스냅샷은 언제나 `null` 이다.
 *
 * 찜은 한 사람의 것이고 서버 렌더에는 그 사람이 없다. 여기서 답을 내면 하이드레이션이
 * 어긋나고, 어긋난 쪽이 이기면 남의 하트가 잠깐 보인다.
 */
function serverSnapshot(): null {
  return null
}

/**
 * 지금 표가 아는 값. **훅이 아니다** — 낙관적으로 뒤집기 전에 되돌릴 값을 잡아 두는
 * 자리이고, 그 일은 렌더가 아니라 클릭 핸들러 안에서 일어난다.
 */
export function wishlistedNow(productId: string): boolean | null {
  return known.get(productId) ?? (loaded ? false : null)
}

/** `true` 찜함 · `false` 안 함 · `null` 아직 모른다. */
export function useWishlisted(productId: string): boolean | null {
  return useSyncExternalStore(subscribe, () => wishlistedNow(productId), serverSnapshot)
}
