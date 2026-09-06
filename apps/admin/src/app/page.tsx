import { PageHeader } from '@shopping/ui/console'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { ClaimAttentionPanel } from '@/components/claims/claim-attention-panel'
import { messagesFor, screenTitle } from '@/messages'

/**
 * The dashboard. Static — this page awaits nothing.
 *
 * It used to be `force-dynamic` because it read a live dependency on the server,
 * which meant every visitor waited for the API before receiving any markup at
 * all — and on a cold instance that wait ends in a timeout, not a page
 * (TASK-0101 4.3). The liveness read now happens in the browser, so there is no
 * live value in the server render to go stale and the shell can be prerendered.
 *
 * The real dashboard — takings, new orders, stock about to run out —
 * belongs to TASK-0092. Until then this route carries the liveness panel,
 * inside the console shell like every other screen.
 */
export default function HomePage() {
  const messages = messagesFor()

  return (
    <>
      <PageHeader description={messages.app.description} title={screenTitle('/')} />

      <ApiWakeGate health={messages.health} wake={messages.wake} />

      {/*
        F7 — 기한을 넘긴 클레임과 나가지 못한 환불이 **대시보드에 노출**된다.
        진짜 대시보드는 TASK-0092 의 것이고, 이 패널은 그 격자가 생기면 한 칸으로
        들어간다. 클레임을 읽을 수 없는 계정에는 아무것도 그리지 않는다.
      */}
      <ClaimAttentionPanel errors={messages.errors} messages={messages.claims} />

      <p className="text-fg-subtle text-sm">{messages.health.notice}</p>

      {/*
        The component gallery is a development tool and is not served in
        production (see app/components/page.tsx), so the way in is too. It has
        no menu entry for the same reason.
      */}
      {process.env.NODE_ENV === 'production' ? null : (
        <a className="text-primary min-h-touch text-sm underline" href="/components">
          {messages.components.linkLabel}
        </a>
      )}
    </>
  )
}
