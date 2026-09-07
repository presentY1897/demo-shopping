import { PageHeader } from '@shopping/ui/console'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { ClaimAttentionPanel } from '@/components/claims/claim-attention-panel'
import { DashboardWorkspace } from '@/components/dashboard/dashboard-workspace'
import { messagesFor, screenTitle } from '@/messages'

/**
 * `/` — 관리자 대시보드 (TASK-0092).
 *
 * **아무것도 `await` 하지 않는다.** 제목과 설명은 이 서버 컴포넌트의 것이고, 세 문은
 * 클라이언트 경계가 효과에서 읽는다. 예전에는 `force-dynamic` 으로 서버에서 살아 있는
 * 값을 하나 읽었는데, 그러면 모든 방문자가 마크업 한 조각을 받기 전에 API 를 기다렸고
 * 차가운 인스턴스에서 그 기다림은 페이지가 아니라 타임아웃으로 끝났다 (TASK-0101 4.3).
 *
 * ## 위에서부터 읽는 순서가 곧 설계다
 *
 * 1. **API 깨우기** — 세 문 전부가 살아 있는 API 를 전제한다. 잠든 인스턴스에서는 이
 *    패널이 「무엇이 잘못됐나」에 먼저 답한다 (TASK-0101).
 * 2. **처리 대기와 밀린 클레임** — 「지금 뭘 해야 하는가」. 대시보드의 목적이 이것이라
 *    지표보다 위에 있다 (TASK-0092 4장).
 * 3. **지표 · 추이 · 순위**, 그리고 **시스템 상태** — `DashboardWorkspace` 안에 있다.
 */
export default function HomePage() {
  const { claims, components, dashboard, errors, health, wake } = messagesFor()

  return (
    <>
      {/* 설명은 **이 화면의 것**이다. `app.description` 은 콘솔 전체를 소개하는 문장이라
          탭 제목과 메타데이터의 몫이고(`app/layout.tsx`), 화면 머리에서는 「여기서 무엇을
          하는가」에 답해야 한다. */}
      <PageHeader description={dashboard.description} title={screenTitle('/')} />

      <ApiWakeGate health={health} wake={wake} />

      {/*
        기한을 넘긴 클레임과 나가지 못한 환불 (TASK-0071 F7). 대기 **건수**는 아래
        `DashboardWorkspace` 의 처리 대기 줄이 말하고, 이 패널은 **무엇이** 밀렸는지를
        말한다 — 세 번째 화면을 열지 않고 판단하게 하는 것이 그 패널의 목적이다.
        클레임을 읽을 수 없는 계정에는 아무것도 그리지 않는다.
      */}
      <ClaimAttentionPanel errors={errors} messages={claims} />

      <DashboardWorkspace errors={errors} messages={dashboard} />

      {/*
        The component gallery is a development tool and is not served in
        production (see app/components/page.tsx), so the way in is too. It has
        no menu entry for the same reason.
      */}
      {process.env.NODE_ENV === 'production' ? null : (
        <a className="text-primary min-h-touch text-sm underline" href="/components">
          {components.linkLabel}
        </a>
      )}
    </>
  )
}
