'use client'

/**
 * 첫 방문자에게 데모 계정을 권하는 자리 (TASK-0044 F5 · R2).
 *
 * **한 번만, 그리고 닫기 쉽게.** 두 번째 방문에 같은 안내를 다시 내면 그것은
 * 안내가 아니라 광고다. 기록은 `localStorage` 이고, 읽을 수 없는 브라우저에서는
 * **본 것으로 친다** — 기억할 수 없는 사람을 매번 붙잡는 쪽이 더 나쁘다. 밀도
 * 안내(TASK-0018 R1)가 같은 규칙을 쓴다.
 *
 * **보일지 말지는 CSS 가 정한다** (TASK-0097 F2). 서버는 이 방문자가 안내를 봤는지
 * 알 수 없으므로, 예전에는 마운트 뒤에 그렸다 — 그리고 그 순간 아래의 모든 것이
 * 197px 내려갔다. 지금은 표를 늘 그려 두고 `<html>` 의 표시 하나로 보이는지를
 * 정한다. 그 표시는 첫 페인트 전에 도는 인라인 스크립트가 붙이므로(`layout.tsx`)
 * **화면은 한 번도 움직이지 않는다.**
 *
 * 이미 로그인한 사람에게는 나오지 않는다 — 데모 계정을 권할 이유가 없다. 그 판단은
 * 세션을 받아 본 뒤에야 가능해서 한 박자 늦고, 그때 표를 뗀다. 처음 온 사람은
 * 로그인해 있지 않으므로 이 경우에 화면이 움직이는 일은 거의 없다.
 */

import { Button, buttonClassName } from '@shopping/ui/components'
import Link from 'next/link'
import { useEffect } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import {
  dismissDemoInvite,
  hideDemoInvite,
  markDemoInviteOwed,
  shouldShowDemoInvite,
} from '@/lib/demo/invite'
import type { HomeDemoMessages } from '@/messages'

export function DemoInvite({ messages }: { readonly messages: HomeDemoMessages }) {
  const { state } = useAuth()
  const signedIn = state.status === 'signedIn'

  useEffect(() => {
    // 스크립트가 붙인 표를 그대로 두는 것이 보통이고, 여기서 다시 정하는 것은 두
    // 경우다 — 로그인이 확인됐을 때, 그리고 앱 안에서 이동해 와 스크립트가 돌지
    // 않았을 때. 후자에서는 이미 그려진 화면 위의 변화라 이동이 눈에 띄지 않는다.
    if (signedIn) hideDemoInvite()
    else if (shouldShowDemoInvite()) markDemoInviteOwed()
    else hideDemoInvite()
  }, [signedIn])

  return (
    <aside
      aria-labelledby="demo-invite-title"
      // `demo-invite` 는 `globals.css` 의 규칙이 잡는 자리다 — 표가 없으면
      // `display: none` 이고, 그러면 위아래의 간격도 생기지 않는다.
      className="demo-invite border-border bg-surface-muted flex flex-col gap-2 rounded-md border p-4"
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
