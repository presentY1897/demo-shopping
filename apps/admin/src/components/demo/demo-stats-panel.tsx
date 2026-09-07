'use client'

import type { ApiFailure, DemoStatsDay, DemoStatsResponse } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, ErrorState, Skeleton, Table } from '@shopping/ui/components'

import type { RoleCount } from '@/lib/demo/demo-console'
import { roleCounts } from '@/lib/demo/demo-console'
import { demoCount, demoDay } from '@/lib/demo/format'
import type { DemoStatsController } from '@/lib/demo/use-demo-console'
import type { DemoConsoleMessages, UserMessages } from '@/messages'

import { DemoPeriodFilters } from './demo-period-filters'

/**
 * 발급 통계 (F7).
 *
 * ## 두 축을 한 답에서 그린다
 *
 * 일별과 역할별을 따로 물으면 두 요청 사이에 발급이 일어나 합이 안 맞는다 (4.5).
 * 계약이 둘을 함께 싣는 이유가 그것이고, 화면은 그 답 하나를 두 표로 나눠 그린다.
 *
 * ## 없던 날은 **0으로 이미 채워져 온다**
 *
 * 서버가 `fillDays` 로 채운다. 화면이 다시 채우지 않는 이유는 그 채우기가 조용히
 * 서로 다르게 되기 때문이고, 빈 날을 빼면 「이틀 아무도 안 눌렀다」가 「꾸준했다」로
 * 보인다.
 *
 * ## 그림이 아니라 **표**다
 *
 * 대시보드의 거래액 추이는 선을 그리지만, 여기서 세는 것은 하루 몇 개인 작은 정수라
 * 표가 더 정확하고 스크린리더에도 그대로 읽힌다. 선을 그리려면 좌표를 만드는 순수
 * 모듈이 하나 더 필요하고(`lib/dashboard/chart.ts`), 그것이 값을 하는 자리는 값의
 * 폭이 넓을 때다.
 *
 * ## 모르는 역할을 숨기지 않는다
 *
 * `byRole` 의 열쇠는 서버의 역할 이름이고, API 와 콘솔은 따로 배포된다. 이름을 모르는
 * 줄을 빼면 역할별 합이 조용히 전체와 어긋나므로 열쇠를 그대로 그리고, 왜 그런지는
 * 문장이 말한다 (`roleCounts` · `lib/dashboard/schedulers.ts` 와 같은 판단).
 */

export interface DemoStatsPanelProps {
  readonly messages: DemoConsoleMessages
  /** 역할 이름은 회원 화면의 카탈로그에서 온다 — 두 화면이 한 역할을 다르게 부르지 않게. */
  readonly roleNames: UserMessages['roleNames']
  readonly stats: DemoStatsController
  readonly describe: (failure: ApiFailure) => string
  /** 「최근 2주로」의 기준 시각. 검사가 고정된 날짜를 넣는다. */
  readonly now?: Date
}

export function DemoStatsPanel({ messages, roleNames, stats, describe, now }: DemoStatsPanelProps) {
  const copy = messages.stats
  const { state } = stats

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg text-base font-medium">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      <DemoPeriodFilters
        disabled={state.status === 'loading'}
        messages={copy.filters}
        now={now}
        onChange={stats.setPeriod}
        problem={stats.problem}
        value={stats.period}
      />

      {state.status === 'loading' ? <Skeleton label={copy.loadingLabel} lines={6} /> : null}

      {state.status === 'error' ? (
        <ErrorState
          description={describe(state.failure)}
          onRetry={stats.reload}
          retryLabel={copy.retryLabel}
          title={copy.errorTitle}
        />
      ) : null}

      {state.status === 'ready' ? (
        <StatsBody data={state.data} messages={messages} roleNames={roleNames} />
      ) : null}
    </section>
  )
}

function StatsBody({
  data,
  messages,
  roleNames,
}: {
  readonly data: DemoStatsResponse
  readonly messages: DemoConsoleMessages
  readonly roleNames: UserMessages['roleNames']
}) {
  const copy = messages.stats
  const rows = roleCounts(data.byRole)
  const total = data.days.reduce((sum, day) => sum + day.issued, 0)

  const dayColumns: readonly TableColumn<DemoStatsDay>[] = [
    { cell: (row) => demoDay(row.date), header: copy.dateHeader, key: 'date' },
    {
      align: 'end',
      cell: (row) => demoCount(row.issued),
      header: copy.issuedHeader,
      key: 'issued',
      numeric: true,
    },
  ]

  const roleColumns: readonly TableColumn<RoleCount>[] = [
    {
      cell: (row) =>
        // 이름을 아는 역할은 한국어로, 모르는 역할은 **열쇠 그대로.** 숨기면 합이
        // 조용히 어긋난다.
        row.named ? roleNames[row.role] : row.role,
      header: copy.roleHeader,
      key: 'role',
    },
    {
      align: 'end',
      cell: (row) => demoCount(row.issued),
      header: copy.issuedHeader,
      key: 'issued',
      numeric: true,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-fg-muted">{copy.summary.activeLabel}</span>
        <Badge variant="neutral">
          {copy.summary.countValue.replace('{count}', demoCount(data.activeAccounts))}
        </Badge>

        <span className="text-fg-muted">{copy.summary.failedLabel}</span>
        <Badge variant={data.failedCleanups === 0 ? 'neutral' : 'danger'}>
          {copy.summary.countValue.replace('{count}', demoCount(data.failedCleanups))}
        </Badge>

        <span className="text-fg-subtle">
          {copy.totalIssued.replace('{count}', demoCount(total))}
        </span>
      </div>

      <Table
        caption={copy.daysCaption}
        columns={dayColumns}
        rowKey={(row) => row.date}
        rows={data.days}
        sort={null}
      />

      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm">{copy.byRoleEmpty}</p>
      ) : (
        <Table
          caption={copy.byRoleCaption}
          columns={roleColumns}
          rowKey={(row) => row.role}
          rows={rows}
          sort={null}
        />
      )}

      {rows.some((row) => !row.named) ? (
        <p className="text-fg-muted text-xs">{copy.unnamedRoleNotice}</p>
      ) : null}
    </div>
  )
}
