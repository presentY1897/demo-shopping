'use client'

/**
 * 첫 방문자에게 데모 계정을 권하는 자리 (TASK-0044 F5 · R2).
 *
 * **한 번만, 그리고 닫기 쉽게.** 두 번째 방문에 같은 안내를 다시 내면 그것은
 * 안내가 아니라 광고다. 기록은 `localStorage` 이고, 읽을 수 없는 브라우저에서는
 * **본 것으로 친다** — 기억할 수 없는 사람을 매번 붙잡는 쪽이 더 나쁘다. 밀도
 * 안내(TASK-0018 R1)가 같은 규칙을 쓴다.
 *
 * 서버는 방문자가 이것을 봤는지 알 수 없으므로 첫 렌더에서는 **아무것도 그리지
 * 않는다.** `useSyncExternalStore` 의 서버 스냅샷이 `false` 인 것이 그것이고,
 * 추측해서 그렸다가 하이드레이션에서 지우면 화면이 한 번 튄다.
 *
 * 이미 로그인한 사람에게는 나오지 않는다 — 데모 계정을 권할 이유가 없다.
 */

import { Button, buttonClassName } from '@shopping/ui/components'
import Link from 'next/link'
import { useSyncExternalStore } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { dismissDemoInvite, shouldShowDemoInvite, subscribeToDemoInvite } from '@/lib/demo/invite'
import type { HomeDemoMessages } from '@/messages'

function notOnTheServer(): boolean {
  return false
}

export function DemoInvite({ messages }: { readonly messages: HomeDemoMessages }) {
  const owed = useSyncExternalStore(subscribeToDemoInvite, shouldShowDemoInvite, notOnTheServer)
  const { state } = useAuth()

  // Nothing to offer somebody who is already signed in.
  if (!owed || state.status === 'signedIn') return null

  return (
    <aside
      aria-labelledby="demo-invite-title"
      className="border-border bg-surface-muted flex flex-col gap-2 rounded-md border p-4"
    >
      <h2 className="text-fg text-base font-semibold" id="demo-invite-title">
        {messages.title}
      </h2>
      <p className="text-fg-muted text-sm">{messages.body}</p>

      <div className="flex flex-wrap gap-2">
        <Link className={buttonClassName({ size: 'sm' })} href="/login">
          {messages.cta}
        </Link>
        <Button
          onClick={() => {
            dismissDemoInvite()
          }}
          size="sm"
          variant="ghost"
        >
          {messages.dismiss}
        </Button>
      </div>
    </aside>
  )
}
