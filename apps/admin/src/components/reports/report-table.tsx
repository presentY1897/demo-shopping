'use client'

import type { Report } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Button, Table } from '@shopping/ui/components'

import { reportDateTime } from '@/lib/reports/format'
import { canHandle, statusVariant } from '@/lib/reports/outcomes'
import type { ReportMessages } from '@/messages'

/**
 * 신고 목록의 표 — **여기서 판단이 끝나야 한다.**
 *
 * ## 발췌와 신고 횟수가 열로 있는 이유
 *
 * 계약이 `targetExcerpt` 와 `targetReportCount` 를 싣는 것은 관리자가 **대상 화면으로
 * 가지 않고** 판단할 수 있게 하기 위해서다(`reports.ts`). 그 둘을 표에서 빼면 한
 * 건마다 상품 페이지를 새 탭으로 열어야 하고, 그러면 대기 줄은 훑을 수 없는 것이
 * 된다. 다섯 번째 신고와 첫 신고는 같은 내용이어도 다른 무게를 갖는다.
 *
 * ## 「가려짐」은 신고의 상태가 아니다
 *
 * `targetHidden` 은 **대상**이 지금 가려져 있는가이고, 자동 임시 숨김도 여기 나타난다
 * (TASK-0091 4.3). 상태 뱃지와 나란히 서지만 다른 것을 말하므로 뱃지가 둘이다 —
 * 하나로 합치면 「관리자가 가렸다」와 「자동으로 가려졌다」를 구분할 수 없게 된다.
 *
 * ## 처리된 줄에는 버튼이 없다
 *
 * 처리된 신고는 다시 처리하지 않는다(`canHandle`). 그 자리에는 언제 어떤 사유로
 * 처리됐는지가 대신 선다 — 비워 두면 목록은 「무엇이 남았는가」만 말하고 「무엇을
 * 했는가」는 아무 데서도 말하지 않는다 (F6).
 */

export interface ReportTableProps {
  readonly rows: readonly Report[]
  readonly messages: ReportMessages
  readonly onHandle: (report: Report) => void
}

export function ReportTable({ rows, messages, onHandle }: ReportTableProps) {
  const copy = messages.list

  const columns: readonly TableColumn<Report>[] = [
    {
      key: 'createdAt',
      header: copy.columns.createdAt,
      cell: (row) => reportDateTime(row.createdAt),
    },
    {
      key: 'target',
      header: copy.columns.target,
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span className="text-fg font-medium">{messages.targetTypeLabels[row.targetType]}</span>
          <span className="text-fg-subtle text-xs">
            {copy.reportCount.replace('{count}', String(row.targetReportCount))}
          </span>
          {row.targetHidden ? (
            <span>
              <Badge size="sm" variant="neutral">
                {copy.targetHidden}
              </Badge>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'reason',
      header: copy.columns.reason,
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span>{messages.reasonLabels[row.reason]}</span>
          {row.detail === null ? null : (
            <span className="text-fg-subtle text-xs whitespace-pre-wrap">{row.detail}</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: copy.columns.status,
      cell: (row) => (
        <Badge variant={statusVariant(row.status)}>{messages.statusLabels[row.status]}</Badge>
      ),
    },
    {
      key: 'excerpt',
      header: copy.columns.excerpt,
      cell: (row) =>
        row.targetExcerpt === null ? (
          // 빈칸이 아니라 문장이다. 빈칸은 「내용이 없다」와 「못 읽었다」를 섞는다.
          <span className="text-fg-subtle">{copy.excerptEmpty}</span>
        ) : (
          // 두 줄까지만. 리뷰 한 편이 통째로 들어오면 다른 열이 전부 밀린다 —
          // 전문은 처리 대화상자가 그린다.
          <span className="line-clamp-2 max-w-80 whitespace-pre-wrap">{row.targetExcerpt}</span>
        ),
    },
    {
      key: 'handle',
      header: copy.columns.handle,
      cell: (row) =>
        canHandle(row.status) ? (
          <Button
            onClick={() => {
              onHandle(row)
            }}
            size="sm"
            type="button"
            variant="primary"
          >
            {copy.handleLabel}
          </Button>
        ) : (
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-fg-muted">
              {copy.handledAt.replace(
                '{datetime}',
                row.handledAt === null
                  ? messages.handle.summary.none
                  : reportDateTime(row.handledAt),
              )}
            </span>
            {row.handledNote === null ? null : (
              <span className="text-fg-subtle whitespace-pre-wrap">
                {copy.handledNote.replace('{note}', row.handledNote)}
              </span>
            )}
          </div>
        ),
    },
  ]

  return (
    <Table
      caption={copy.listLabel}
      columns={columns}
      rowKey={(row) => row.id}
      rows={rows}
      sort={null}
    />
  )
}
