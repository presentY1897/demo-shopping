'use client'

import type { ApiFailure, ErrorMessages, HandleReportRequest, Report } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import { useCallback, useState } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import { useReports } from '@/lib/reports/use-reports'
import type { ReportMessages } from '@/messages'

import { ReportFilters } from './report-filters'
import { ReportHandleDialog } from './report-handle-dialog'
import { ReportTable } from './report-table'

/**
 * `/reports` — 들어온 신고를 읽고, 한 건씩 판단한다 (TASK-0091).
 *
 * ## 볼 수 있는 자격과 처리할 수 있는 자격이 **같다**
 *
 * 목록도 처리도 `content.moderate` 하나다(`report.controller.ts`). 그래서 이 화면에는
 * 정산 화면 같은 `GuardedButton` 이 없다 — 목록이 보이는 계정은 처리 버튼도 누를 수
 * 있다.
 *
 * **그런데도 거절은 온다** (F7 · D-058). 데모 관리자는 그 퍼미션을 `demo` 로 좁혀
 * 갖고 있어 **목록은 전부 읽지만** 실계정이 쓴 글에는 403 을 받는다. 어느 줄이 그런
 * 줄인지는 화면이 미리 알 수 없다 — 스코프는 **대상의 주인**을 상대로 판정되고, 목록은
 * 주인을 실어 오지 않는다. 그래서 버튼을 미리 죽이지 않고, 거절을 문장으로 받는다
 * (`report-handle-dialog.tsx`). 미리 죽이려면 목록에 주인의 id 를 실어야 하고, 그것은
 * 신고 목록에 개인정보를 한 칸 더 얹는 일이다.
 *
 * ## 대기 건수는 **필터의 합이 아니다**
 *
 * 서버가 조건과 무관하게 「아직 처리하지 않은 신고 전체」를 함께 보낸다
 * (`reportListResponseSchema`). 그 사실을 화면이 문장으로 말하지 않으면, 「반려」만
 * 보고 있는 사람 앞의 12는 틀린 숫자로 보인다.
 */

export interface ReportListWorkspaceProps {
  readonly messages: ReportMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function ReportListWorkspace({ messages, errors }: ReportListWorkspaceProps) {
  const { ready, can, reason } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.list.loadingLabel} lines={6} />

  if (!can('content.moderate')) {
    return <EmptyState description={reason('content.moderate')} title={messages.forbiddenTitle} />
  }

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <ReportQueue errors={errors} messages={messages} />
    </ToastProvider>
  )
}

function ReportQueue({ messages, errors }: ReportListWorkspaceProps) {
  const reports = useReports()
  const { toast } = useToast()

  /** 지금 처리 중인 신고 — 대화상자가 열려 있는가와 같은 값이다. */
  const [handling, setHandling] = useState<Report | null>(null)

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { state, pagination, filters } = reports
  const rows = state.status === 'ready' ? state.reports : []

  async function handle(request: HandleReportRequest): Promise<ApiFailure | null> {
    if (handling === null) return null

    const result = await reports.handle(handling.id, request)

    // 이미 도는 중이었다 — 아무것도 보내지 않았고, 말할 것도 없다.
    if (result === null) return null

    if (!result.ok) return result.failure

    setHandling(null)
    toast({ title: messages.toast.handled[request.outcome], variant: 'success' })

    return null
  }

  return (
    <div className="flex flex-col gap-4">
      <PendingPanel messages={messages} reports={reports} />

      <ReportFilters
        disabled={state.status === 'loading'}
        messages={messages.list}
        onChange={reports.setFilters}
        targetTypeLabels={messages.targetTypeLabels}
        value={filters}
      />

      <DataList
        empty={
          reports.narrowed ? (
            <EmptyState
              description={messages.list.filteredEmptyDescription}
              title={messages.list.filteredEmptyTitle}
            />
          ) : (
            <EmptyState
              description={messages.list.emptyDescription}
              title={messages.list.emptyTitle}
            />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={reports.reload}
            retryLabel={messages.list.retryLabel}
            title={messages.list.errorTitle}
          />
        }
        loading={<Skeleton label={messages.list.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <ReportTable messages={messages} onHandle={setHandling} rows={rows} />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.list.pagination.label}
          nextLabel={messages.list.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.list.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, rows.length)}
        />
      </DataList>

      {handling === null ? null : (
        <ReportHandleDialog
          describe={describe}
          errors={errors}
          messages={messages}
          onCancel={() => {
            setHandling(null)
          }}
          onConfirm={handle}
          onRefresh={() => {
            setHandling(null)
            reports.reload()
          }}
          report={handling}
        />
      )}
    </div>
  )
}

/**
 * 아직 처리하지 않은 신고가 몇 건인가 — **지금 보고 있는 조건과 무관하게.**
 *
 * 「대기 건만 보기」가 여기 있는 이유는, 그 숫자를 본 사람이 다음에 하려는 일이
 * 정확히 그것이기 때문이다. 셀렉트로 내려가 「처리 대기」를 고르게 하면 같은 일이 두
 * 걸음이 된다.
 */
function PendingPanel({
  messages,
  reports,
}: {
  readonly messages: ReportMessages
  readonly reports: ReturnType<typeof useReports>
}) {
  const copy = messages.list.pending
  const { state, filters } = reports

  if (state.status !== 'ready') return null

  return (
    <section
      aria-label={copy.title}
      className="border-border bg-surface-muted flex flex-wrap items-center gap-3 rounded-md border p-3"
    >
      <h2 className="text-fg text-sm font-medium">{copy.title}</h2>

      {state.pendingCount === 0 ? (
        <p className="text-fg-muted text-sm">{copy.none}</p>
      ) : (
        <>
          <Badge variant="warning">
            {copy.countValue.replace('{count}', String(state.pendingCount))}
          </Badge>
          {filters.scope === 'PENDING' ? null : (
            <Button
              onClick={() => {
                reports.setFilters({ ...filters, scope: 'PENDING' })
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {copy.only}
            </Button>
          )}
        </>
      )}

      <p className="text-fg-subtle basis-full text-xs">{copy.scopeNotice}</p>
    </section>
  )
}

/**
 * `2 페이지 · 20건`.
 *
 * 카탈로그의 조각을 이어 붙인다. 자리 표시자는 사람에게 `{page}` 로 그려질 수 있는
 * 것이 하나 더 생기는 일이고, 여기 숫자에는 문법이 필요 없다 (`settlements` 화면과
 * 같은 방식).
 */
function pageStatus(messages: ReportMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.list.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
