'use client'

import type { AdminFailedRefund } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, linkClassName, Table } from '@shopping/ui/components'
import NextLink from 'next/link'

import { claimDateTime, claimMoney } from '@/lib/claims/format'
import type { ClaimVocabularyMessages, FailedRefundMessages } from '@/messages'

/**
 * 나가지 못한 환불.
 *
 * **`attempts` 와 `lastError` 를 나란히 둔다.** 다음 주기에 사라질 실패(결제사가 잠깐
 * 죽었다)와 사라지지 않을 실패(이미 다 환불된 결제)를 가르는 것이 그 둘이고, 뒤엣것만
 * 사람이 손대야 한다. 하나만 그리면 이 표는 「몇 건이 실패했다」로 끝난다.
 *
 * **`lastAttemptAt` 이 비어 있는 것은 오류가 아니다.** 아직 한 번도 시도되지 않은
 * 환불이고, 빈 칸으로 두면 그것이 「모른다」인지 「없었다」인지 읽는 사람이 알 수 없다.
 */

export interface FailedRefundTableProps {
  readonly rows: readonly AdminFailedRefund[]
  readonly caption: string
  readonly messages: FailedRefundMessages
  readonly vocabulary: ClaimVocabularyMessages
}

export function FailedRefundTable({ rows, caption, messages, vocabulary }: FailedRefundTableProps) {
  const columns: readonly TableColumn<AdminFailedRefund>[] = [
    {
      key: 'orderNumber',
      header: messages.columns.orderNumber,
      cell: (row) => (
        <NextLink className={linkClassName()} href={`/claims/${row.claimId}`}>
          {row.orderNumber}
        </NextLink>
      ),
    },
    {
      key: 'seller',
      header: messages.columns.seller,
      cell: (row) => row.brandName,
    },
    {
      key: 'status',
      header: messages.columns.status,
      cell: (row) => <Badge variant="neutral">{vocabulary.statusLabels[row.claimStatus]}</Badge>,
    },
    {
      key: 'amount',
      header: messages.columns.amount,
      numeric: true,
      cell: (row) => claimMoney(row.amount),
    },
    {
      key: 'attempts',
      header: messages.columns.attempts,
      numeric: true,
      cell: (row) => messages.attemptCount.replace('{count}', String(row.attempts)),
    },
    {
      key: 'lastError',
      header: messages.columns.lastError,
      cell: (row) => (
        <span className="block max-w-72 truncate" title={row.lastError ?? undefined}>
          {row.lastError ?? messages.noError}
        </span>
      ),
    },
    {
      key: 'waitingSince',
      header: messages.columns.waitingSince,
      cell: (row) => (
        <span className="flex flex-col">
          <span>{claimDateTime(row.waitingSince)}</span>
          <span className="text-fg-subtle text-xs">
            {row.lastAttemptAt === null ? messages.noAttempt : claimDateTime(row.lastAttemptAt)}
          </span>
        </span>
      ),
    },
  ]

  return (
    <Table
      caption={caption}
      columns={columns}
      rowKey={(row) => row.claimId}
      rows={rows}
      sort={null}
    />
  )
}
