'use client'

import type { SettlementItem } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, linkClassName, Table } from '@shopping/ui/components'
import NextLink from 'next/link'

import { settlementMoney } from '@/lib/settlements/format'
import { orderHref } from '@/lib/settlements/settlement-console'
import type { SettlementMessages } from '@/messages'

/**
 * 정산서를 이루는 줄들 — **그리고 그 줄에서 주문으로 내려가는 길** (F2).
 *
 * ## 링크가 이 표의 요점이다
 *
 * 판매자가 「이 회차 금액이 이상하다」고 했을 때 관리자가 해야 하는 일은 어느
 * 주문에서 그 숫자가 왔는지 확인하는 것이다. 계약이 `orderNumber` 를 함께 싣는 이유가
 * 그것이고(`settlementItemSchema`), id 만으로는 사람이 알아보는 링크를 만들 수 없다.
 * 링크가 어디로 가는지와 그 화면이 아직 오지 않았다는 사정은 `orderHref` 에 적혀
 * 있다.
 *
 * ## 차감 줄은 **눈에 띄게 달라야 한다**
 *
 * `RETURN_ADJUSTMENT` 는 이번 회차의 판매가 아니라 이미 승인·지급된 지난 회차의
 * 판매를 되돌린 것이고, 그래서 세 금액이 전부 음수다. 같은 모양으로 그리면 표를
 * 훑는 사람은 그것을 **작은 판매**로 읽는다 — 유형 뱃지가 먼저 말하고, 음수 부호와
 * 다른 색이 그것을 확인해 준다.
 */

export interface SettlementItemsTableProps {
  readonly items: readonly SettlementItem[]
  readonly messages: SettlementMessages
}

export function SettlementItemsTable({ items, messages }: SettlementItemsTableProps) {
  const copy = messages.detail.items
  const adjusted = items.some((item) => item.type === 'RETURN_ADJUSTMENT')

  const columns: readonly TableColumn<SettlementItem>[] = [
    {
      key: 'type',
      header: copy.columns.type,
      cell: (item) => (
        <Badge variant={item.type === 'RETURN_ADJUSTMENT' ? 'danger' : 'neutral'}>
          {messages.itemTypeLabels[item.type]}
        </Badge>
      ),
    },
    {
      key: 'orderNumber',
      header: copy.columns.orderNumber,
      cell: (item) => (
        <NextLink
          aria-label={copy.openOrder.replace('{orderNumber}', item.orderNumber)}
          className={linkClassName()}
          href={orderHref(item.orderNumber, item.sellerOrderId)}
        >
          {item.orderNumber}
        </NextLink>
      ),
    },
    {
      key: 'salesAmount',
      header: copy.columns.salesAmount,
      numeric: true,
      cell: (item) => settlementMoney(item.salesAmount),
    },
    {
      key: 'commissionAmount',
      header: copy.columns.commissionAmount,
      numeric: true,
      cell: (item) => settlementMoney(item.commissionAmount),
    },
    {
      key: 'sellerCouponAmount',
      header: copy.columns.sellerCouponAmount,
      numeric: true,
      cell: (item) => settlementMoney(item.sellerCouponAmount),
    },
    {
      key: 'payoutAmount',
      header: copy.columns.payoutAmount,
      numeric: true,
      cell: (item) => <span className="font-medium">{settlementMoney(item.payoutAmount)}</span>,
    },
  ]

  return (
    <section aria-label={messages.detail.sections.items} className="flex flex-col gap-2">
      <h2 className="text-fg text-lg font-medium">{messages.detail.sections.items}</h2>

      {/*
        주문 화면이 아직 껍데기라는 사실을 말없이 넘기지 않는다 — 링크를 눌러 본
        사람이 「준비 중」 화면을 만나는 것과, 그것을 미리 아는 것은 다르다.
      */}
      <p className="text-fg-subtle text-xs">{copy.openOrderHint}</p>

      {adjusted ? (
        <p className="text-fg-muted text-sm" role="note">
          {copy.adjustmentNotice}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-fg-muted text-sm">{copy.empty}</p>
      ) : (
        <Table
          caption={copy.caption}
          columns={columns}
          rowKey={(item) => item.id}
          rows={items}
          sort={null}
        />
      )}
    </section>
  )
}
