'use client'

import type { ApiFailure, StockLedgerEntry } from '@shopping/shared'
import { DataList, EmptyState, ErrorState, Skeleton, Table } from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'

import type { LedgerState } from '@/lib/products/use-variant-stock'
import type { StockLedgerMessages } from '@/messages'

/**
 * What explains the number (F7).
 *
 * The history is the reason the adjustment control can be a delta and nothing
 * else: every movement is a row here with the balance it produced, so "왜 17인가"
 * has an answer that does not depend on anybody remembering. A screen that let
 * stock be *set* would have rows this table could not explain.
 */
export interface StockLedgerPanelProps {
  readonly messages: StockLedgerMessages
  readonly state: LedgerState
  readonly retryLabel: string
  readonly onRetry: () => void
  readonly describe: (failure: ApiFailure) => string
}

export function StockLedgerPanel({
  messages,
  state,
  retryLabel,
  onRetry,
  describe,
}: StockLedgerPanelProps) {
  const entries = state.status === 'ready' ? state.entries : []

  const columns: readonly TableColumn<StockLedgerEntry>[] = [
    { key: 'seq', header: messages.seq, numeric: true, cell: (row) => row.seq },
    { key: 'type', header: messages.type, cell: (row) => messages.typeLabels[row.type] },
    {
      key: 'quantity',
      header: messages.quantity,
      numeric: true,
      // The sign is the information: `+5` and `-5` are two different events and
      // an unsigned column would make them look like one.
      cell: (row) => (row.quantity > 0 ? `+${String(row.quantity)}` : String(row.quantity)),
    },
    {
      key: 'balance',
      header: messages.balanceAfter,
      numeric: true,
      cell: (row) => row.balanceAfter.toLocaleString('ko-KR'),
    },
    { key: 'reason', header: messages.reason, cell: (row) => row.reason ?? messages.noReason },
    {
      key: 'at',
      header: messages.at,
      cell: (row) => new Date(row.createdAt).toLocaleString('ko-KR'),
    },
  ]

  return (
    <section aria-label={messages.title} className="flex flex-col gap-2">
      <h2 className="text-fg text-lg font-semibold">{messages.title}</h2>
      <DataList
        empty={<EmptyState title={messages.empty} />}
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={onRetry}
            retryLabel={retryLabel}
            title={messages.title}
          />
        }
        loading={<Skeleton label={messages.title} shape="text" />}
        state={state.status === 'ready' ? (entries.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <Table
          caption={messages.caption}
          columns={columns}
          rowKey={(row) => String(row.seq)}
          rows={entries}
        />
      </DataList>
    </section>
  )
}
