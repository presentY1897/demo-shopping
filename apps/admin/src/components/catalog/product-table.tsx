'use client'

import { ProductIdentity } from '@shopping/ui/components'

import type { ProductSummary } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Button, Table } from '@shopping/ui/components'

import { catalogCount, catalogPrice } from '@/lib/catalog/format'
import type { ModerationAction } from '@/lib/catalog/product-console'
import { moderationActionFor } from '@/lib/catalog/product-console'
import type { AdminProductListMessages, AdminProductMessages } from '@/messages'

/**
 * 전체 상품의 표 (F1 · F2).
 *
 * ## 조치 칸이 상태를 따라간다
 *
 * **판매 중인 것만 내리고 내려진 것만 올린다** (4.2). 그 판정은 순수 함수의 것이고
 * (`moderationActionFor`), 서버의 판정을 비추는 거울이다 — 초안 옆에 「내리기」를
 * 그리면 그 버튼은 눌려도 409 를 받고, 그때 사람은 자기가 뭘 잘못했는지 알 수 없다.
 *
 * 버튼을 감추는 대신 **왜 없는지**를 적는 이유는 콘솔이 실제보다 적은 기능을 가진
 * 것처럼 보이지 않게 하기 위해서다 (TASK-0023 4장과 같은 규약).
 *
 * ## 「강제 숨김」을 상태 이름과 따로 그린다
 *
 * `SUSPENDED` 는 관리자가 내린 상태이고, 판매자가 스스로 내린 `INACTIVE` 와 다르다.
 * 상태 이름만으로는 그 둘이 비슷해 보이므로, 관리자가 손댄 줄에는 배지를 하나 더 단다.
 *
 * ## 스토어와 카테고리는 **이름으로** 그린다
 *
 * 계약이 싣는 것은 `sellerId` 와 `categoryId` 뿐이다(`productSummarySchema`). 그 둘을
 * 이름으로 바꾸는 표는 필터가 이미 들고 있으므로 함께 쓴다 — 못 찾으면 문장을 그린다.
 * uuid 를 그대로 그리면 표가 읽히지 않는다.
 */

export interface ProductTableProps {
  readonly rows: readonly ProductSummary[]
  readonly messages: AdminProductListMessages
  readonly statusLabels: AdminProductMessages['statusLabels']
  /** `sellerId` → 브랜드 이름. 없는 키는 「이름을 못 찾은 스토어」다. */
  readonly storeNames: ReadonlyMap<string, string>
  /** `categoryId` → 조상까지 이어 붙인 이름. */
  readonly categoryNames: ReadonlyMap<number, string>
  readonly onModerate: (product: ProductSummary, action: ModerationAction) => void
  readonly busy: boolean
}

export function ProductTable({
  rows,
  messages,
  statusLabels,
  storeNames,
  categoryNames,
  onModerate,
  busy,
}: ProductTableProps) {
  const columns: readonly TableColumn<ProductSummary>[] = [
    {
      key: 'product',
      header: messages.columns.product,
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <ProductIdentity src={row.thumbnailUrl}>{row.name}</ProductIdentity>
          <span className="text-fg-subtle text-xs">
            {messages.variantValue.replace('{count}', catalogCount(row.variantCount))}
          </span>
        </div>
      ),
    },
    {
      key: 'seller',
      header: messages.columns.seller,
      cell: (row) => storeNames.get(row.sellerId) ?? messages.unknownSeller,
    },
    {
      key: 'category',
      header: messages.columns.category,
      cell: (row) => categoryNames.get(row.categoryId) ?? messages.unknownCategory,
    },
    {
      key: 'status',
      header: messages.columns.status,
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge variant={row.status === 'ACTIVE' ? 'success' : 'neutral'}>
            {statusLabels[row.status]}
          </Badge>
          {/* 관리자가 내린 것과 판매자가 스스로 내린 것은 다른 사실이다 (4.2). */}
          {row.status === 'SUSPENDED' ? (
            <Badge size="sm" variant="danger">
              {messages.hiddenBadge}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: 'price',
      header: messages.columns.price,
      numeric: true,
      align: 'end',
      cell: (row) => catalogPrice(row.minPrice) ?? messages.noPrice,
    },
    {
      key: 'stock',
      header: messages.columns.stock,
      numeric: true,
      align: 'end',
      cell: (row) => messages.stockValue.replace('{count}', catalogCount(row.stock)),
    },
    {
      key: 'action',
      header: messages.columns.action,
      cell: (row) => (
        <Moderation busy={busy} messages={messages} onModerate={onModerate} row={row} />
      ),
    },
  ]

  return (
    <Table
      className="[contain:layout]"
      caption={messages.listLabel}
      columns={columns}
      rowKey={(row) => row.id}
      rows={rows}
      sort={null}
    />
  )
}

/** 내리기 · 다시 올리기, 또는 **왜 아무것도 못 하는지.** */
function Moderation({
  row,
  messages,
  onModerate,
  busy,
}: {
  readonly row: ProductSummary
  readonly messages: AdminProductListMessages
  readonly onModerate: (product: ProductSummary, action: ModerationAction) => void
  readonly busy: boolean
}) {
  const action = moderationActionFor(row.status)

  if (action === null) return <span className="text-fg-subtle">{messages.notModeratable}</span>

  return (
    <Button
      disabled={busy}
      onClick={() => {
        onModerate(row, action)
      }}
      size="sm"
      type="button"
      variant={action === 'hide' ? 'danger' : 'outline'}
    >
      {/* 표의 스무 줄에 같은 이름의 버튼이 스무 개면 화면 낭독으로는 고를 수 없다. */}
      <span className="sr-only">{row.name} </span>
      {action === 'hide' ? messages.hideLabel : messages.restoreLabel}
    </Button>
  )
}
