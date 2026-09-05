'use client'

import { useSyncExternalStore } from 'react'

/**
 * 헤더 배지가 읽는 숫자 (TASK-0046).
 *
 * **모듈 하나에 값 하나.** 헤더는 모든 화면에 있고 장바구니 화면은 그중 하나라,
 * 둘을 잇는 방법이 필요하다. React 컨텍스트로 감싸는 방법도 있지만 그러면 셸
 * 전체가 이 값 때문에 다시 그려진다 — 배지 하나가 바뀌는 일에 그것은 과하다.
 *
 * `null` 은 **모른다**는 뜻이고 `0` 은 「비었다」는 뜻이다. 둘을 같게 두면 로그인
 * 직후의 한순간에 「0」이 보이고, 그것은 담아 둔 것이 있는 사람에게 거짓말이다 —
 * 그래서 모를 때는 배지를 아예 그리지 않는다.
 */

let count: number | null = null

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** 장바구니 응답을 받은 곳이 부른다 — 읽기든 쓰기든. */
export function publishCartCount(next: number): void {
  if (count === next) return

  count = next

  for (const listener of listeners) listener()
}

/** 로그아웃처럼 「이제 모른다」로 돌아가는 순간. */
export function forgetCartCount(): void {
  if (count === null) return

  count = null

  for (const listener of listeners) listener()
}

function snapshot(): number | null {
  return count
}

/**
 * 서버 스냅샷은 언제나 `null` 이다.
 *
 * 장바구니는 한 사람의 것이고 서버 렌더에는 그 사람이 없다. 여기서 숫자를 내면
 * 하이드레이션이 어긋나고, 어긋난 쪽이 이기면 남의 숫자가 잠깐 보인다.
 */
function serverSnapshot(): number | null {
  return null
}

export function useCartCount(): number | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
