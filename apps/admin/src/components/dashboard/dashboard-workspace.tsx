'use client'

import type { ErrorMessages } from '@shopping/shared'
import { platformOwnership } from '@shopping/shared'
import { EmptyState, Skeleton } from '@shopping/ui/components'

import { useAuthorization } from '@/lib/auth/authorization'
import {
  useDashboardMetrics,
  useDashboardPending,
  useDashboardSystem,
} from '@/lib/dashboard/use-dashboard'
import type { DashboardMessages } from '@/messages'

import { MetricsPanel } from './metrics-panel'
import { PendingPanel } from './pending-panel'
import { SystemPanel } from './system-panel'

/**
 * `/` — 관리자 대시보드 (TASK-0092).
 *
 * ## 처리 대기가 맨 위다
 *
 * 4장이 그렇게 정해 두었다: 「대시보드의 목적은 예쁜 숫자가 아니라 *지금 뭘 해야
 * 하는가*다」. 거래액이 먼저 오면 이 화면은 매일 아침 훑는 보고서가 되고, 밀린 신청은
 * 스크롤 아래에 남는다.
 *
 * ## 섹션 셋이 각자 읽는다
 *
 * 훅이 셋이고 상태도 셋이다 (4.1). 지표가 실패해도 처리 대기와 시스템 상태는 그려지고,
 * 그 반대도 마찬가지다 — **실패한 섹션은 빈 섹션이지 오류 페이지가 아니다.** 하나로
 * 묶으면 가장 느린 문이 나머지를 붙잡고, 한 번의 500 이 「플랫폼이 죽었나」가 된다.
 *
 * ## 권한은 세 문 모두에 대해 같다 (F6)
 *
 * 서버가 재는 것은 `order.read` 의 **스코프**다 — 구매자도 그 퍼미션을 갖고 있지만
 * `own` 이라 세 문 전부에서 403 을 받는다(`dashboard.service.ts` 의
 * `assertPlatformRead`). 화면은 같은 질문을 `platformOwnership` 으로 던진다: 물어봐야
 * 세 번 다 거절당할 계정에게 오류 셋을 그리는 대신, **왜 안 되는지를 한 번** 말한다.
 */
export interface DashboardWorkspaceProps {
  readonly messages: DashboardMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** 기본 기간을 정하는 기준 시각. 검사가 고정된 날짜를 넣는다. */
  readonly now?: Date
}

export function DashboardWorkspace({ messages, errors, now }: DashboardWorkspaceProps) {
  const { ready, canOn, reasonOn } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.pending.loadingLabel} lines={8} />

  if (!canOn('order.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('order.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  return <DashboardSections errors={errors} messages={messages} now={now} />
}

/**
 * 세 섹션. 훅은 여기서 부른다 — 위의 게이트가 거절한 계정에서는 **아예 마운트되지
 * 않으므로**, 볼 수 없는 사람이 세 번 403 을 받는 일이 없다.
 */
function DashboardSections({ messages, errors, now }: DashboardWorkspaceProps) {
  const metrics = useDashboardMetrics(now)
  const pending = useDashboardPending()
  const system = useDashboardSystem()

  return (
    <div className="flex flex-col gap-8">
      <PendingPanel errors={errors} messages={messages} section={pending} />
      <MetricsPanel controller={metrics} errors={errors} messages={messages} now={now} />
      <SystemPanel errors={errors} messages={messages} section={system} />
    </div>
  )
}
