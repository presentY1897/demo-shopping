import { PageHeader } from '@shopping/ui/console'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { RevenueDashboard } from '@/components/revenue/revenue-dashboard'
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
 * 매출은 TASK-0082 가 여기에 붙였다 — `pages.md` 2장이 「매출 추이」를 이 경로에
 * 배정해 두었고, 사이드바의 「대시보드」가 가리키는 곳도 여기다.
 *
 * **기동 패널은 남는다.** 무료 플랜의 콜드 스타트를 말해 주는 자리는 이 앱에서
 * 여기 하나뿐이고(TASK-0101), 그것을 지우면 잠든 서버를 기다리는 판매자가 보는
 * 것은 매출 화면의 오류 문장 하나가 된다. 그래서 순서도 그대로다: 기다림을 먼저
 * 말하고, 그 뒤에 숫자가 온다. `apps/admin` 의 대시보드가 같은 이유로 같은 모양이다.
 */
export default function HomePage() {
  const messages = messagesFor()

  return (
    <>
      <PageHeader description={messages.app.description} title={screenTitle('/')} />

      <ApiWakeGate health={messages.health} wake={messages.wake} />

      <RevenueDashboard />

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
