'use client'

import type { ApiFailure, DashboardPendingResponse, ErrorMessages } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import { Badge, ErrorState, linkClassName, Skeleton } from '@shopping/ui/components'
import NextLink from 'next/link'

import { dashboardCount } from '@/lib/dashboard/format'
import { isSettled, pendingItems, totalPending } from '@/lib/dashboard/dashboard-console'
import type { DashboardSection } from '@/lib/dashboard/use-dashboard'
import type { DashboardMessages } from '@/messages'

/**
 * **대시보드의 맨 위** — 지금 사람이 해야 할 일 (TASK-0092 F2).
 *
 * 4장이 이유를 한 문장으로 적고 있다: 「대시보드의 목적은 예쁜 숫자가 아니라 *지금 뭘
 * 해야 하는가*다」. 그래서 이 섹션이 지표보다 위에 있고, 지표를 못 읽어도 이것은
 * 그려진다 — 문이 셋인 이유가 그것이다.
 *
 * ## 링크는 화면이 붙인다
 *
 * 계약은 건수만 보낸다. 어느 화면이 그 일을 처리하는지는 **콘솔의 라우트**이고, 그것을
 * API 가 알면 화면을 옮길 때마다 서버를 고쳐야 한다
 * (`dashboardPendingResponseSchema`). 경로는 `dashboard-console.ts` 의
 * `PENDING_HREFS` 한 곳에만 적혀 있고, 사이드바가 쓰는 것과 같은 문자열이다.
 *
 * ## 줄 전체가 링크다
 *
 * 「3건」 옆에 「바로가기」를 따로 두지 않는다. 그 숫자를 본 사람이 다음에 하려는 일이
 * 정확히 그 화면을 여는 것이고, 링크의 이름에 항목과 건수가 함께 들어가 있어야
 * 스크린리더로 훑는 사람도 같은 판단을 할 수 있다.
 */
export interface PendingPanelProps {
  readonly section: DashboardSection<DashboardPendingResponse>
  readonly messages: DashboardMessages
  readonly errors: ErrorMessages
}

export function PendingPanel({ section, messages, errors }: PendingPanelProps) {
  const copy = messages.pending
  const { state } = section

  const describe = (failure: ApiFailure): string =>
    failureMessage(failure, { errors, failures: messages.failures })

  return (
    <section
      aria-label={copy.title}
      className="border-border bg-surface-raised flex flex-col gap-3 rounded-md border p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-fg text-lg font-semibold">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </header>

      {state.status === 'loading' ? <Skeleton label={copy.loadingLabel} lines={2} /> : null}

      {/*
        한 섹션의 실패는 **그 섹션에서** 끝난다 (4.1). 오류 화면을 페이지 전체로
        올리면 처리 대기를 못 읽었다는 사실이 「플랫폼이 죽었나」가 된다.
      */}
      {state.status === 'error' ? (
        <ErrorState
          description={describe(state.failure)}
          onRetry={section.reload}
          retryLabel={copy.retryLabel}
          title={copy.errorTitle}
        />
      ) : null}

      {state.status === 'ready' ? <PendingList copy={copy} pending={state.data} /> : null}
    </section>
  )
}

function PendingList({
  copy,
  pending,
}: {
  readonly copy: DashboardMessages['pending']
  readonly pending: DashboardPendingResponse
}) {
  /*
    네 줄이 전부 0이면 표가 아니라 한 문장이다. 「0 · 0 · 0 · 0」은 읽는 데 네 번
    걸리고, 그것이 이 화면에서 가장 좋은 소식이다
    (`claim-attention-panel.tsx` 가 같은 판단을 먼저 했다).
  */
  if (isSettled(pending)) return <p className="text-fg-muted text-sm">{copy.allClear}</p>

  return (
    <>
      <p className="text-fg text-sm font-medium">
        {copy.totalCount.replace('{count}', dashboardCount(totalPending(pending)))}
      </p>

      <ul aria-label={copy.listLabel} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {pendingItems(pending).map((item) => (
          <li key={item.key}>
            <NextLink
              className={`${linkClassName('standalone')} border-border bg-surface min-h-touch w-full justify-between rounded-md border p-3`}
              href={item.href}
            >
              <span className="text-fg text-sm">{copy.labels[item.key]}</span>
              {/*
                0인 줄에도 숫자를 그린다 — 「이 줄은 비어 있다」와 「아직 못 읽었다」는
                다른 사실이고, 뱃지가 사라지면 둘이 같아 보인다. 색은 0에서만 중립이다.
              */}
              <Badge variant={item.count === 0 ? 'neutral' : 'warning'}>
                {copy.countValue.replace('{count}', dashboardCount(item.count))}
              </Badge>
            </NextLink>
          </li>
        ))}
      </ul>
    </>
  )
}
