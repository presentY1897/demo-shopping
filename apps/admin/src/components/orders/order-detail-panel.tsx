'use client'

import type { AdminOrderPayment, AdminOrderRow, ApiFailure } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import {
  Badge,
  DataList,
  EmptyState,
  ErrorState,
  linkClassName,
  Modal,
  Skeleton,
  Table,
} from '@shopping/ui/components'
import NextLink from 'next/link'

import { catalogApprovedAt, catalogDateTime, catalogMoney } from '@/lib/catalog/format'
import { useOrderPayments } from '@/lib/catalog/use-orders'
import type { AdminOrderMessages } from '@/messages'

/**
 * 주문 하나 — **묶음 전부**, 결제와 환불, 그리고 바꿀 수 없다는 말 (F5 · F6 · F7).
 *
 * ## 묶음을 다시 묻지 않는다
 *
 * 목록의 줄이 이미 `sellerOrders` 를 전부 들고 있다(4.3). 여기서 한 번 더 부르면 스무
 * 줄이 스물한 번이 되고(A5), 게다가 그렇게 얻은 답이 방금 표에 그린 것과 다를 수도
 * 있다 — 같은 화면이 같은 주문을 두 가지로 말하게 된다.
 *
 * ## 상태를 바꾸는 버튼이 없고, **없다고 말한다**
 *
 * 이 패널에서 가장 중요한 것이 그 문장이다. 서버에도 그 문이 없다 (4.4). 버튼이 그냥
 * 없으면 읽는 사람은 그것을 **자기 권한 문제로** 읽고 다른 계정으로 다시 들어와 같은
 * 화면을 본다 — 그리고 그 사이에 클레임은 처리되지 않는다. 그래서 왜 없는지와 대신
 * 어디로 가야 하는지를 함께 적고, 그 자리에서 갈 수 있게 링크를 둔다.
 *
 * ## 승인 시각이 빈칸일 수 있다
 *
 * 승인 전에 끊긴 결제 시도가 실제로 남는다(`approvedAt` 이 nullable 이다). 빈칸으로
 * 두면 「승인된 적 없음」과 「못 읽었다」가 섞이므로 문장을 그린다.
 */

export interface OrderDetailPanelProps {
  readonly order: AdminOrderRow
  readonly messages: AdminOrderMessages
  readonly onClose: () => void
  readonly describe: (failure: ApiFailure) => string
}

export function OrderDetailPanel({ order, messages, onClose, describe }: OrderDetailPanelProps) {
  const payments = useOrderPayments(order.orderId)
  const copy = messages.detail

  const { state } = payments
  const rows = state.status === 'ready' ? state.payments.payments : []
  const failure = state.status === 'error' ? state.failure : null

  const bundleColumns: readonly TableColumn<AdminOrderRow['sellerOrders'][number]>[] = [
    {
      key: 'brand',
      header: copy.bundleColumns.brand,
      cell: (bundle) => bundle.brandName,
    },
    {
      key: 'status',
      header: copy.bundleColumns.status,
      cell: (bundle) => <Badge variant="neutral">{messages.statusLabels[bundle.status]}</Badge>,
    },
    {
      key: 'paidAmount',
      header: copy.bundleColumns.paidAmount,
      numeric: true,
      align: 'end',
      cell: (bundle) => catalogMoney(bundle.paidAmount),
    },
  ]

  const paymentColumns: readonly TableColumn<AdminOrderPayment>[] = [
    {
      key: 'provider',
      header: copy.paymentColumns.provider,
      cell: (payment) => payment.provider,
    },
    {
      key: 'status',
      header: copy.paymentColumns.status,
      cell: (payment) => payment.status,
    },
    {
      key: 'amount',
      header: copy.paymentColumns.amount,
      numeric: true,
      align: 'end',
      cell: (payment) => catalogMoney(payment.amount),
    },
    {
      key: 'canceledAmount',
      header: copy.paymentColumns.canceledAmount,
      numeric: true,
      align: 'end',
      cell: (payment) => catalogMoney(payment.canceledAmount),
    },
    {
      key: 'approvedAt',
      header: copy.paymentColumns.approvedAt,
      cell: (payment) =>
        catalogApprovedAt(payment.approvedAt) ?? (
          <span className="text-fg-subtle">{copy.notApproved}</span>
        ),
    },
  ]

  return (
    <Modal
      closeLabel={copy.closeLabel}
      description={order.orderNumber}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open
      size="lg"
      title={copy.title}
    >
      <div className="flex flex-col gap-6">
        <dl className="border-border grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
          <dt className="text-fg-muted">{copy.orderNumberLabel}</dt>
          <dd className="text-fg">{order.orderNumber}</dd>
          <dt className="text-fg-muted">{copy.buyerLabel}</dt>
          <dd className="text-fg">{order.maskedBuyerName}</dd>
          <dt className="text-fg-muted">{copy.createdAtLabel}</dt>
          <dd className="text-fg">{catalogDateTime(order.createdAt)}</dd>
          <dt className="text-fg-muted">{copy.paidAmountLabel}</dt>
          <dd className="text-fg">{catalogMoney(order.paidAmount)}</dd>
        </dl>

        <section className="flex flex-col gap-2">
          <h3 className="text-fg text-sm font-medium">{copy.bundlesTitle}</h3>

          <Table
            caption={copy.bundlesLabel}
            columns={bundleColumns}
            rowKey={(bundle) => bundle.sellerOrderId}
            rows={order.sellerOrders}
            sort={null}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-fg text-sm font-medium">{copy.paymentsTitle}</h3>

          <DataList
            empty={
              <EmptyState
                description={copy.paymentsEmptyDescription}
                title={copy.paymentsEmptyTitle}
              />
            }
            error={
              <ErrorState
                description={failure === null ? undefined : describe(failure)}
                onRetry={payments.reload}
                retryLabel={copy.paymentsRetryLabel}
                title={copy.paymentsErrorTitle}
              />
            }
            loading={<Skeleton label={copy.paymentsLoadingLabel} lines={3} />}
            state={
              state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status
            }
          >
            <Table
              caption={copy.paymentsLabel}
              columns={paymentColumns}
              rowKey={(payment) => payment.paymentId}
              rows={rows}
              sort={null}
            />

            {state.status === 'ready' ? (
              <p className="text-fg text-sm">
                {copy.refundedLabel} {catalogMoney(state.payments.refundedAmount)}
              </p>
            ) : null}
          </DataList>
        </section>

        {/* 없는 버튼을 설명하는 자리 (F7 · 4.4). 「권한이 없어서」가 아니다. */}
        <div
          className="border-border bg-surface-muted text-fg-muted flex flex-col items-start gap-2 rounded-md border p-3 text-sm"
          role="note"
        >
          <p>{copy.statusNotice}</p>
          <NextLink className={linkClassName()} href="/claims">
            {copy.claimsLinkLabel}
          </NextLink>
        </div>
      </div>
    </Modal>
  )
}
