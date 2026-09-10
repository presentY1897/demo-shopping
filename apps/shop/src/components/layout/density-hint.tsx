'use client'

/**
 * The one-time explanation of what the density toggle is (TASK-0018 R1).
 *
 * Shown only to a visitor who has never picked a step. The server cannot read
 * localStorage, so **보일지 말지는 CSS 가 정한다** — 표시 하나를 첫 페인트 전에
 * 인라인 스크립트가 붙이고(`layout.tsx`), 이 상자는 늘 그려져 있다.
 *
 * **왜 그렇게까지 하나** (TASK-0097 F1): 예전에는 마운트 뒤에 그렸다. 절대 배치라
 * 자리는 밀지 않았지만, 이 문단이 **화면에서 가장 큰 것이 그려진 시각**을 정하고
 * 있었다 — 여섯 화면 전부에서 LCP 가 이 안내였고 2.7~4.5초였는데, 같은 실행의
 * Speed Index 는 0.76초였다. 사람이 보기에 화면은 이미 다 그려져 있었다.
 *
 * It leaves on its own the moment the visitor uses the toggle — the effect
 * re-runs on every density change, and by then a step is stored — so the notice
 * never has to be dismissed by someone who has already understood it.
 */

import { usePathname } from 'next/navigation'
import { CloseIcon, IconButton } from '@shopping/ui/components'
import { subscribeToDensity } from '@shopping/ui/density'
import { useEffect, useSyncExternalStore } from 'react'

import {
  dismissDensityHint,
  hideDensityHint,
  markDensityHintOwed,
  shouldShowDensityHint,
} from '@/lib/density-hint'
import type { DensityControlMessages } from '@/messages'

export function DensityHint({ messages }: { readonly messages: DensityControlMessages }) {
  // The same hook the density value itself uses, for the same reason: the answer
  // lives in localStorage, which React does not own and the server cannot read.
  // 값은 **표를 다시 맞추기 위해서만** 쓴다 — 단계를 고르는 순간 이 구독이 깨어나고,
  // 그때 표를 뗀다. 그리는지 마는지는 여기서 정하지 않는다.
  const pathname = usePathname()
  const owed = useSyncExternalStore(subscribeToDensity, shouldShowDensityHint, notOnTheServer)

  useEffect(() => {
    if (owed) markDensityHintOwed()
    else hideDensityHint()
  }, [owed])

  if (pathname?.startsWith('/checkout') || pathname === '/cart') return null

  return (
    <div
      // `density-hint` 는 `globals.css` 의 규칙이 잡는 자리다 — 표가 없으면
      // `display: none` 이다.
      className="density-hint border-border bg-surface-raised shadow-md absolute top-full right-0 z-40 mt-2 flex w-64 gap-2 rounded-md border p-3"
      role="status"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{messages.hintTitle}</p>
        <p className="text-fg-muted text-xs">{messages.hintBody}</p>
      </div>

      <IconButton
        label={messages.hintDismiss}
        onClick={() => {
          dismissDensityHint()
        }}
        size="sm"
        variant="ghost"
      >
        <CloseIcon className="size-4" />
      </IconButton>
    </div>
  )
}

/** No localStorage during a server render, so nothing is owed there. */
function notOnTheServer(): boolean {
  return false
}
