'use client'

import type { AdminSellerRow } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Button, Table } from '@shopping/ui/components'

import { statusVariant } from '@/lib/sellers/decisions'
import { storeClaimRate, storeCount, storeDate, storeMoney, storeRating } from '@/lib/stores/format'
import type { SellerReviewMessages, StoreListMessages } from '@/messages'

/**
 * 스토어 지표의 표 (F1 · F2 · F7).
 *
 * ## 빈칸이 두 종류다
 *
 * 클레임률은 주문이 없으면 **`null`** 로 오고(4.5), 평점은 리뷰가 없으면 0으로 온다.
 * 둘 다 숫자로 그리면 아직 아무것도 안 한 스토어가 「클레임 0%인 완벽한 스토어」이거나
 * 「0.0점짜리 최악의 스토어」로 목록의 끝에 서고, **그 자리는 진짜로 봐야 할 스토어의
 * 자리다.** 그래서 둘 다 문장으로 그린다.
 *
 * 서식기는 그 판정을 `null` 로만 돌려주고 한국어를 만들지 않는다 — 「판매 없음」은
 * 카탈로그의 것이다 (`lib/stores/format.ts`).
 *
 * ## 「데모」는 상태가 아니다
 *
 * 계정이 어떻게 만들어졌는가와 지금 영업할 수 있는가는 다른 축이다. 한 칸에 합치면
 * 「데모라서 정지됐다」로 읽히는데, 데모 스토어도 멀쩡히 판다 (F7 · `user-table.tsx` 가
 * 같은 판단을 먼저 했다).
 *
 * ## 상태 이름은 심사 탭의 것이다
 *
 * 한 화면의 두 탭이 같은 상태를 다르게 부르면 그것이 한 화면인 이유가 없어진다.
 * 색도 같은 함수에서 나온다 (`lib/sellers/decisions.ts` 의 `statusVariant`).
 */

export interface StoreTableProps {
  readonly rows: readonly AdminSellerRow[]
  readonly messages: StoreListMessages
  readonly statusLabels: SellerReviewMessages['statusLabels']
  /** 이력을 여는 문. 여는 것은 이 표가 아니라 부르는 쪽이다 (F6). */
  readonly onOpenHistory: (store: AdminSellerRow) => void
}

export function StoreTable({ rows, messages, statusLabels, onOpenHistory }: StoreTableProps) {
  const columns: readonly TableColumn<AdminSellerRow>[] = [
    {
      key: 'store',
      header: messages.columns.store,
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span className="text-fg font-medium">{row.brandName}</span>
          {row.isDemo ? (
            <span>
              <Badge size="sm" variant="neutral">
                {messages.demoBadge}
              </Badge>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: messages.columns.status,
      cell: (row) => <Badge variant={statusVariant(row.status)}>{statusLabels[row.status]}</Badge>,
    },
    {
      key: 'sales',
      header: messages.columns.sales,
      numeric: true,
      align: 'end',
      cell: (row) => storeMoney(row.metrics.salesAmount),
    },
    {
      key: 'orders',
      header: messages.columns.orders,
      numeric: true,
      align: 'end',
      cell: (row) => messages.countValue.replace('{count}', storeCount(row.metrics.orderCount)),
    },
    {
      key: 'claimRate',
      header: messages.columns.claimRate,
      numeric: true,
      align: 'end',
      cell: (row) => <ClaimRate messages={messages} row={row} />,
    },
    {
      key: 'rating',
      header: messages.columns.rating,
      align: 'end',
      cell: (row) => <Rating messages={messages} row={row} />,
    },
    {
      key: 'products',
      header: messages.columns.products,
      numeric: true,
      align: 'end',
      cell: (row) =>
        messages.productCountValue.replace('{count}', storeCount(row.metrics.productCount)),
    },
    {
      key: 'followers',
      header: messages.columns.followers,
      numeric: true,
      align: 'end',
      cell: (row) => messages.followerValue.replace('{count}', storeCount(row.followerCount)),
    },
    {
      key: 'createdAt',
      header: messages.columns.createdAt,
      cell: (row) => storeDate(row.createdAt),
    },
    {
      key: 'history',
      header: messages.columns.history,
      cell: (row) => (
        <Button
          onClick={() => {
            onOpenHistory(row)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {/* 어느 스토어의 이력인지가 이름에 들어간다 — 표의 스무 줄에 같은 이름의
              버튼이 스무 개면 화면 낭독으로는 고를 수 없다. */}
          <span className="sr-only">{row.brandName} </span>
          {messages.historyLabel}
        </Button>
      ),
    },
  ]

  return (
    <Table
      caption={messages.listLabel}
      columns={columns}
      rowKey={(row) => row.sellerId}
      rows={rows}
      sort={null}
    />
  )
}

/**
 * 클레임률, 또는 **「판매 없음」** (4.5).
 *
 * 0%가 아니다. 「클레임이 한 건도 없는 좋은 스토어」와 「아직 아무것도 안 판 스토어」는
 * 다른 사실이고, 이 칸이 그 둘을 섞으면 클레임률 정렬이 뜻을 잃는다.
 */
function ClaimRate({
  row,
  messages,
}: {
  readonly row: AdminSellerRow
  readonly messages: StoreListMessages
}) {
  const rate = storeClaimRate(row.metrics.claimRateBp)

  if (rate === null) return <span className="text-fg-subtle">{messages.noSales}</span>

  return (
    <span className="flex flex-col items-end">
      <span className="text-fg">{rate}</span>
      <span className="text-fg-subtle text-xs">
        {messages.countValue.replace('{count}', storeCount(row.metrics.claimCount))}
      </span>
    </span>
  )
}

/** 평점, 또는 **「평가 없음」**. 리뷰가 없는 스토어의 0.0점은 클레임률 0%와 같은 거짓말이다. */
function Rating({
  row,
  messages,
}: {
  readonly row: AdminSellerRow
  readonly messages: StoreListMessages
}) {
  const score = storeRating(row.metrics.ratingAvg, row.metrics.ratingCount)

  if (score === null) return <span className="text-fg-subtle">{messages.noRatings}</span>

  return (
    <span>
      {messages.ratingValue
        .replace('{score}', score)
        .replace('{count}', storeCount(row.metrics.ratingCount))}
    </span>
  )
}
