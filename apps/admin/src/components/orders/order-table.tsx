'use client'

import type { AdminOrderRow } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Button, Table } from '@shopping/ui/components'

import { catalogCount, catalogDateTime, catalogMoney } from '@/lib/catalog/format'
import type { AdminOrderListMessages, AdminOrderMessages } from '@/messages'

/**
 * 전체 주문의 표 (F4 · F5).
 *
 * ## 묶음이 **전부** 한 칸에 있다
 *
 * 하나만 보이면 다중 판매자 주문의 절반이 화면에서 사라지고, CS 는 「그 주문 맞는데
 * 그 상품이 없다」를 보게 된다 (4.3). 계약이 줄마다 `sellerOrders` 를 전부 싣는 이유가
 * 그것이므로, 표도 전부 그린다 — 개수만 적고 나머지를 상세로 미루면 목록에서 다중
 * 판매자 주문을 알아볼 수 없다.
 *
 * ## 산 사람의 이름은 **이미 가려져 있다**
 *
 * 계약이 `maskedBuyerName` 만 싣는다(`adminOrderRowSchema`). 그래서 이 컴포넌트에는
 * 가리는 코드도, 가려진 값을 되돌리는 코드도 없다 — 가리는 일이 서버의 것이라야 한
 * 화면이 잊는 날 그 화면만 전부 보여 주는 일이 생기지 않고, 그때 증상은 오류가 아니라
 * **이미 공개된 개인정보**다 (TASK-0093 4.2).
 *
 * ## 상태를 바꾸는 버튼이 한 칸도 없다
 *
 * 일부러 없다 (F7 · 4.4). 왜 없는지는 상세가 말한다 — 표에서 그 문장을 스무 번 그리는
 * 것은 아무에게도 도움이 되지 않는다.
 */

export interface OrderTableProps {
  readonly rows: readonly AdminOrderRow[]
  readonly messages: AdminOrderListMessages
  readonly statusLabels: AdminOrderMessages['statusLabels']
  readonly onOpen: (order: AdminOrderRow) => void
}

export function OrderTable({ rows, messages, statusLabels, onOpen }: OrderTableProps) {
  const columns: readonly TableColumn<AdminOrderRow>[] = [
    {
      key: 'orderNumber',
      header: messages.columns.orderNumber,
      cell: (row) => <span className="text-fg font-medium">{row.orderNumber}</span>,
    },
    {
      key: 'buyer',
      header: messages.columns.buyer,
      cell: (row) => row.maskedBuyerName,
    },
    {
      key: 'bundles',
      header: messages.columns.bundles,
      cell: (row) => (
        <span className="flex flex-col gap-1">
          {row.sellerOrders.map((bundle) => (
            <span className="flex items-center gap-2" key={bundle.sellerOrderId}>
              <span className="text-fg">{bundle.brandName}</span>
              <Badge size="sm" variant="neutral">
                {statusLabels[bundle.status]}
              </Badge>
            </span>
          ))}
          {/* 몇 갈래로 갈렸는지는 묶음이 둘 이상일 때만 뜻이 있다. 한 갈래짜리
              주문에 「묶음 1개」를 붙이면 스무 줄에 같은 말이 스무 번 선다. */}
          {row.sellerOrders.length > 1 ? (
            <span className="text-fg-subtle text-xs">
              {messages.bundleValue.replace('{count}', catalogCount(row.sellerOrders.length))}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'paidAmount',
      header: messages.columns.paidAmount,
      numeric: true,
      align: 'end',
      cell: (row) => catalogMoney(row.paidAmount),
    },
    {
      key: 'createdAt',
      header: messages.columns.createdAt,
      cell: (row) => catalogDateTime(row.createdAt),
    },
    {
      key: 'open',
      header: messages.columns.open,
      cell: (row) => (
        <Button
          onClick={() => {
            onOpen(row)
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {/* 표의 스무 줄에 같은 이름의 버튼이 스무 개면 화면 낭독으로는 고를 수 없다. */}
          <span className="sr-only">{row.orderNumber} </span>
          {messages.openLabel}
        </Button>
      ),
    },
  ]

  return (
    <Table
      caption={messages.listLabel}
      columns={columns}
      rowKey={(row) => row.orderId}
      rows={rows}
      sort={null}
    />
  )
}
