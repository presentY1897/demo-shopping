'use client'

import { useSyncExternalStore } from 'react'

/**
 * 매초 움직이는 「지금」 (TASK-0050 F2).
 *
 * `useEffect` 안에서 `setState` 를 부르는 대신 **외부 저장소를 구독한다.** 시계는
 * React 밖에 있는 것이고, `react-hooks/set-state-in-effect` 가 막는 것이 정확히 그
 * 착각이다 — 렌더 중에 `Date.now()` 를 부르는 것은 `react-hooks/purity` 가 또 막는다.
 *
 * 구독자가 없으면 타이머도 없다. 주문서를 벗어난 뒤에도 초마다 깨어나는 인터벌은
 * 아무도 보지 않는 계산이다.
 */

const listeners = new Set<() => void>()

let current = 0
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  if (timer === null) {
    // 구독하는 순간 값을 채운다. 렌더가 아니라 구독이므로 순수성 규칙에 걸리지
    // 않고, 첫 화면이 0을 그리지도 않는다.
    current = Date.now()
    timer = setInterval(() => {
      current = Date.now()

      for (const each of listeners) each()
    }, 1_000)
  }

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function snapshot(): number {
  return current
}

/**
 * 서버 스냅샷은 0이다 — 「아직 모른다」.
 *
 * 서버에는 「지금」이 없다. 여기서 시각을 내면 하이드레이션이 어긋나고, 어긋난 쪽이
 * 이기면 남은 시간이 한순간 틀리게 보인다.
 */
function serverSnapshot(): number {
  return 0
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
