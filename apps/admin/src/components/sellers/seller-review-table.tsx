'use client'

import type { Seller } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, linkClassName, Table } from '@shopping/ui/components'
import NextLink from 'next/link'

import type { SellerDecision } from '@/lib/sellers/decisions'
import { statusVariant } from '@/lib/sellers/decisions'
import { reviewDate, reviewDateTime } from '@/lib/sellers/format'
import type { SellerReviewMessages } from '@/messages'

import { SellerDecisionActions } from './seller-decision-actions'

/**
 * The queue, newest first.
 *
 * **The brand name is the row header and it is a link.** `Table` pins the first
 * column while the rest scrolls sideways (TASK-0016 4장), which is the whole
 * reason a console table survives 360px — a row whose identifying cell has
 * scrolled away is a row about nothing. Making it the way into the detail keeps
 * the reading order and the navigation order the same.
 *
 * **No sortable headers.** The list is a keyset page, so its ordering is part of
 * the cursor: letting a header reorder the twenty rows on screen would produce a
 * sort of one page, which is worse than no sort because it looks like one
 * (`docs/design/pages.md` 커서 규약).
 */

interface SellerReviewTableProps {
  readonly sellers: readonly Seller[]
  readonly messages: SellerReviewMessages
  readonly denialFor: (decision: SellerDecision) => string | undefined
  readonly onDecide: (seller: Seller, decision: SellerDecision) => void
}

export function SellerReviewTable({
  sellers,
  messages,
  denialFor,
  onDecide,
}: SellerReviewTableProps) {
  const columns: readonly TableColumn<Seller>[] = [
    {
      key: 'brandName',
      header: messages.columns.brandName,
      // `next/link` with the package's styling: `@shopping/ui` must not depend
      // on Next (its `Link` is a plain anchor), and a plain anchor here would
      // make every row a full page load.
      cell: (row) => (
        <NextLink className={linkClassName()} href={`/sellers/${row.id}`}>
          {row.brandName}
        </NextLink>
      ),
    },
    {
      key: 'status',
      header: messages.columns.status,
      cell: (row) => (
        <Badge variant={statusVariant(row.status)}>{messages.statusLabels[row.status]}</Badge>
      ),
    },
    {
      key: 'slug',
      header: messages.columns.slug,
      cell: (row) => <code className="text-fg-subtle text-xs">{row.slug}</code>,
    },
    {
      key: 'appliedAt',
      header: messages.columns.appliedAt,
      cell: (row) => reviewDate(row.createdAt),
    },
    {
      key: 'changedAt',
      header: messages.columns.changedAt,
      cell: (row) => reviewDateTime(row.statusChangedAt, messages.emptyValue),
    },
    {
      key: 'reason',
      header: messages.columns.reason,
      // Truncated rather than wrapped: a five hundred character rejection would
      // make one row as tall as the page. The whole sentence is on the detail.
      cell: (row) => (
        <span className="block max-w-72 truncate" title={row.statusReason ?? undefined}>
          {row.statusReason ?? messages.emptyValue}
        </span>
      ),
    },
    {
      key: 'actions',
      header: messages.columns.actions,
      align: 'end',
      cell: (row) => (
        <SellerDecisionActions
          denialFor={denialFor}
          messages={messages}
          onSelect={(decision) => {
            onDecide(row, decision)
          }}
          seller={row}
        />
      ),
    },
  ]

  return (
    <Table
      caption={messages.listLabel}
      columns={columns}
      rowKey={(row) => row.id}
      rows={sellers}
      sort={null}
    />
  )
}
