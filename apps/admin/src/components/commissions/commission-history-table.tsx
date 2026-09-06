'use client'

import type { ApiFailure } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { DataList, EmptyState, ErrorState, Skeleton, Table } from '@shopping/ui/components'

import { commissionDateTime, commissionPercent } from '@/lib/commissions/format'
import type { CommissionChange } from '@/lib/commissions/scopes'
import type { CommissionHistoryState } from '@/lib/commissions/use-commissions'
import type { CommissionHistoryMessages } from '@/messages'

/**
 * 이 범위가 지나온 요율 — **누가, 언제, 무엇에서 무엇으로** (F5).
 *
 * ## 이력은 따로 만든 것이 아니다
 *
 * 요율을 바꾸는 것은 행을 고치는 일이 아니라 열린 행을 닫고 새 행을 여는 일이라
 * (`commission.service.ts`), 「변경 이력」은 이 표를 시간순으로 읽은 결과다. 그래서
 * 「무엇에서」는 저장된 값이 아니라 **바로 아래 줄의 요율**이고, 그 계산은
 * `commissionChanges` 가 한 번만 한다.
 *
 * ## 처음 설정된 줄에는 화살표가 없다
 *
 * 그 자리에 폴백 요율을 적으면 「기본율 3%에서 4%로 올렸다」는 **없던 사건**이
 * 이력에 생긴다. 그때 요율은 설정된 적이 없었을 뿐, 3%였던 적은 없다.
 */

export interface CommissionHistoryTableProps {
  readonly state: CommissionHistoryState
  readonly messages: CommissionHistoryMessages
  readonly onRetry: () => void
  readonly describe: (failure: ApiFailure) => string
}

export function CommissionHistoryTable({
  state,
  messages,
  onRetry,
  describe,
}: CommissionHistoryTableProps) {
  const columns: readonly TableColumn<CommissionChange>[] = [
    {
      key: 'changedAt',
      header: messages.columns.changedAt,
      cell: (change) => commissionDateTime(change.rate.validFrom),
    },
    {
      key: 'change',
      header: messages.columns.change,
      cell: (change) =>
        change.previousRateBp === null
          ? messages.firstChange.replace('{to}', commissionPercent(change.rate.rateBp))
          : messages.change
              .replace('{from}', commissionPercent(change.previousRateBp))
              .replace('{to}', commissionPercent(change.rate.rateBp)),
    },
    {
      key: 'changedBy',
      header: messages.columns.changedBy,
      cell: (change) => change.rate.createdBy.email,
    },
  ]

  const changes = state.status === 'ready' ? state.changes : []

  return (
    <section aria-label={messages.title} className="flex flex-col gap-2">
      <h2 className="text-fg text-base font-medium">{messages.title}</h2>
      <p className="text-fg-muted text-sm">{messages.description}</p>

      {/*
        범위가 아직 완결되지 않은 자리는 `DataList` 의 네 상태 어디에도 없다 —
        불러오는 중도, 실패도, 빈 목록도 아니고 **아직 묻지 않았다**이다. 그것을
        「비었습니다」로 그리면 이 범위에 이력이 없다는 뜻이 되어 버린다.
      */}
      {state.status === 'idle' ? (
        <p className="text-fg-muted text-sm">{messages.idle}</p>
      ) : (
        <DataList
          empty={<EmptyState description={messages.emptyDescription} title={messages.emptyTitle} />}
          error={
            <ErrorState
              description={state.status === 'error' ? describe(state.failure) : undefined}
              onRetry={onRetry}
              retryLabel={messages.retryLabel}
              title={messages.errorTitle}
            />
          }
          loading={<Skeleton label={messages.loadingLabel} lines={3} />}
          state={
            state.status === 'ready' ? (changes.length === 0 ? 'empty' : 'ready') : state.status
          }
        >
          <Table
            caption={messages.listLabel}
            columns={columns}
            rowKey={(change) => change.rate.id}
            rows={changes}
          />
        </DataList>
      )}
    </section>
  )
}
