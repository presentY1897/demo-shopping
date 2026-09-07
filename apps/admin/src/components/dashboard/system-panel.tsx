'use client'

import type {
  ApiFailure,
  DashboardSystemResponse,
  ErrorMessages,
  SchedulerHealth,
} from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import { Badge, ErrorState, linkClassName, Skeleton, Table } from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import NextLink from 'next/link'

import { dashboardCount, dashboardDateTime } from '@/lib/dashboard/format'
import type { SystemSummary } from '@/lib/dashboard/schedulers'
import {
  isSchedulerKey,
  SCHEDULER_VARIANTS,
  schedulerLabel,
  sortSchedulers,
  systemSummary,
} from '@/lib/dashboard/schedulers'
import type { DashboardSection } from '@/lib/dashboard/use-dashboard'
import type { DashboardMessages, DashboardSystemMessages } from '@/messages'

/**
 * 시스템 상태 (TASK-0092 F4) — **멈춘 배치가 보이는 자리.**
 *
 * 4장이 이유를 적고 있다: 이 프로젝트에는 배치가 열 개고, 하나가 멈추면 조용히 문제가
 * 쌓인다. 재고 예약이 안 풀리고, 정산 회차가 안 생기고, 데모 계정이 안 지워진다 —
 * 전부 며칠 뒤에 다른 증상으로 발견된다.
 *
 * ## `never` 를 붉게 칠하지 않는다
 *
 * 한 번도 안 돈 배치는 **갓 뜬 프로세스의 정상 상태**이고, 돌다가 멈춘 것은 사고다.
 * 둘을 같은 색으로 칠하면 배포 직후마다 빨간 화면을 보게 되고, 그것이 몇 번 반복되면
 * 사람은 그 색을 안 믿는다 — 그 다음에 진짜로 멈춘 배치가 생겨도 아무도 안 본다.
 * 색의 선택은 `SCHEDULER_VARIANTS` 가 한 곳에서 한다.
 *
 * ## 이름 없는 배치도 그린다
 *
 * API 와 콘솔은 따로 배포되므로 이 콘솔이 모르는 열쇠가 오는 순간이 실제로 있다. 그
 * 줄을 숨기면 **멈춘 배치가 아무 데도 안 보이게 되고**, 그것이 정확히 이 섹션이
 * 막으려던 일이다. 그래서 열쇠라도 그리고, 왜 이름이 없는지를 한 문장으로 적는다.
 */
export interface SystemPanelProps {
  readonly section: DashboardSection<DashboardSystemResponse>
  readonly messages: DashboardMessages
  readonly errors: ErrorMessages
}

export function SystemPanel({ section, messages, errors }: SystemPanelProps) {
  const copy = messages.system
  const { state } = section

  const describe = (failure: ApiFailure): string =>
    failureMessage(failure, { errors, failures: messages.failures })

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-fg text-lg font-semibold">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </header>

      {state.status === 'loading' ? <Skeleton label={copy.loadingLabel} lines={4} /> : null}

      {state.status === 'error' ? (
        <ErrorState
          description={describe(state.failure)}
          onRetry={section.reload}
          retryLabel={copy.retryLabel}
          title={copy.errorTitle}
        />
      ) : null}

      {state.status === 'ready' ? <SystemBody copy={copy} system={state.data} /> : null}
    </section>
  )
}

function SystemBody({
  copy,
  system,
}: {
  readonly copy: DashboardSystemMessages
  readonly system: DashboardSystemResponse
}) {
  const rows = sortSchedulers(system.schedulers)
  const summary = systemSummary(system.schedulers)
  const unnamed = system.schedulers.some((row) => !isSchedulerKey(row.key))

  const columns: readonly TableColumn<SchedulerHealth>[] = [
    { cell: (row) => schedulerLabel(row.key, copy.names), header: copy.nameHeader, key: 'name' },
    {
      cell: (row) => (
        <Badge variant={SCHEDULER_VARIANTS[row.status]}>{copy.statusLabels[row.status]}</Badge>
      ),
      header: copy.statusHeader,
      key: 'status',
    },
    {
      // 「아직 없음」을 빈칸으로 두지 않는다 — 빈칸은 「못 읽었다」와 구별되지 않는다.
      cell: (row) => (row.lastRunAt === null ? copy.neverRun : dashboardDateTime(row.lastRunAt)),
      header: copy.lastRunHeader,
      key: 'lastRunAt',
    },
  ]

  return (
    <>
      <SummaryLine copy={copy} summary={summary} />

      <div className="overflow-x-auto">
        <Table caption={copy.caption} columns={columns} rowKey={(row) => row.key} rows={rows} />
      </div>

      {unnamed ? <p className="text-fg-subtle text-xs">{copy.unnamedNotice}</p> : null}

      <SearchIndexSummary copy={copy} index={system.searchIndex} />
      <DemoSummary copy={copy} demo={system.demo} />
    </>
  )
}

/**
 * 표를 읽지 않고도 알아야 하는 한 문장.
 *
 * 멈춘 배치가 있을 때만 `alert` 다. 정상 상태를 assertive 로 읽어 주면 30초마다
 * 「모든 배치가 정상이에요」가 끼어들고, 그러면 진짜 알림도 같은 취급을 받는다.
 */
function SummaryLine({
  copy,
  summary,
}: {
  readonly copy: DashboardSystemMessages
  readonly summary: SystemSummary
}) {
  if (summary.kind === 'stopped') {
    return (
      <p className="text-danger text-sm font-medium" role="alert">
        {copy.summary.stopped.replace('{count}', dashboardCount(summary.count))}
      </p>
    )
  }

  if (summary.kind === 'idle') {
    return (
      <p className="text-fg-muted text-sm">
        {copy.summary.idle.replace('{count}', dashboardCount(summary.count))}
      </p>
    )
  }

  return <p className="text-fg-muted text-sm">{copy.summary.ok}</p>
}

/**
 * 색인 큐 (TASK-0092 2장 「인덱싱 큐」).
 *
 * 배치 표에 넣지 않았다. 저 표의 열은 「마지막으로 언제 돌았나」인데, 줄 서 있는 일은
 * **방금 돌았어도 뒤처져 있을 수 있다** — 같은 표에 두면 초록 불 옆에 만 건이 밀린
 * 큐가 나란히 앉는다.
 *
 * 「줄고 있는가」는 한 번의 응답으로 알 수 없어 서버가 판정하지 않는다. 대신 가장
 * 오래 기다린 줄이 언제 들어왔는지를 함께 보인다 — 그것은 한 번만 봐도 뜻이 있다.
 */
function SearchIndexSummary({
  copy,
  index,
}: {
  readonly copy: DashboardSystemMessages
  readonly index: DashboardSystemResponse['searchIndex']
}) {
  return (
    <section
      aria-label={copy.searchIndex.title}
      className="border-border flex flex-wrap items-center gap-3 rounded-md border p-3"
    >
      <h3 className="text-fg text-sm font-medium">{copy.searchIndex.title}</h3>
      <Badge variant={index.pending === 0 ? 'success' : 'warning'}>
        {copy.searchIndex.pending.replace('{count}', dashboardCount(index.pending))}
      </Badge>
      {index.oldestAt === null ? null : (
        <span className="text-fg-muted text-sm">
          {copy.searchIndex.oldest.replace('{at}', dashboardDateTime(index.oldestAt))}
        </span>
      )}
    </section>
  )
}

/** 데모 계정 현황 요약. 자세한 것은 `/demo` 가 답한다 (TASK-0096). */
function DemoSummary({
  copy,
  demo,
}: {
  readonly copy: DashboardSystemMessages
  readonly demo: DashboardSystemResponse['demo']
}) {
  return (
    <section
      aria-label={copy.demo.title}
      className="border-border flex flex-wrap items-center gap-3 rounded-md border p-3"
    >
      <h3 className="text-fg text-sm font-medium">{copy.demo.title}</h3>
      <Badge variant="neutral">
        {copy.demo.activeAccounts.replace('{count}', dashboardCount(demo.activeAccounts))}
      </Badge>
      <Badge variant="neutral">
        {copy.demo.expiringWithinHour.replace('{count}', dashboardCount(demo.expiringWithinHour))}
      </Badge>
      <NextLink className={linkClassName()} href="/demo">
        {copy.demo.link}
      </NextLink>
    </section>
  )
}
