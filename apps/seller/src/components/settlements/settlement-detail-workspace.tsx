'use client'

import type { ApiFailure, Settlement, SettlementItem } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import {
  Badge,
  DataList,
  EmptyState,
  ErrorState,
  Link,
  Skeleton,
  Table,
} from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useCallback } from 'react'

import { day, dateTime, money } from '@/lib/orders/format'
import type { CalculationLine } from '@/lib/settlements/settlement-console'
import { calculationLines, inclusiveEnd } from '@/lib/settlements/settlement-console'
import { useSellerSettlement } from '@/lib/settlements/use-seller-settlement'
import type { Messages } from '@/messages'
import { messagesFor } from '@/messages'

/**
 * `/settlements/[id]` — 「왜 이 금액인가」 (TASK-0082 4장 · F2).
 *
 * 판매자에게 계산 근거를 **그대로** 보여 준다. 지급액만 던지면 문의가 생기고, 그
 * 문의는 관리자가 같은 화면을 열어 같은 숫자를 읽어 주는 것으로 끝난다 — 그럴 거면
 * 판매자가 처음부터 보는 편이 낫다.
 *
 * **관리자와 같은 라우트를 읽는다** (F3). 그래서 두 화면의 숫자가 어긋날 수 없고,
 * 이 화면은 아무 금액도 다시 계산하지 않는다.
 *
 * **버튼이 하나도 없다.** 승인·보류·지급은 관리자의 것이다(TASK-0081). 누를 수 없는
 * 버튼을 두면 그것을 설명하는 문장이 따라붙고, 그 문장은 판매자가 알 필요가 없다.
 */
export interface SettlementDetailWorkspaceProps {
  readonly settlementId: string
  readonly messages?: Messages
}

/** 목록으로 돌아가는 곳. 사이드바의 「정산 내역」과 같은 자리다. */
const LIST_HREF = '/settlements'

export function SettlementDetailWorkspace({
  settlementId,
  messages = messagesFor(),
}: SettlementDetailWorkspaceProps) {
  const copy = messages.settlementDetail
  const detail = useSellerSettlement(settlementId)
  const { state } = detail

  const describe = useCallback(
    (failure: ApiFailure) =>
      failureMessage(failure, { errors: messages.errors, failures: messages.apiFailures }),
    [messages],
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={LIST_HREF} variant="subtle">
          {copy.backLabel}
        </Link>
        <h1 className="text-fg text-2xl font-bold">{copy.title}</h1>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </header>

      <DataList
        /*
          닿지 않는 갈래인데도 값을 채운다 — `DataList` 가 빈 상태를 **필수 prop 으로**
          강제하기 때문이다 (`claim-detail-workspace.tsx` 와 같은 자리, 같은 이유).
          없는 정산서는 빈 답이 아니라 404 로 온다.
        */
        empty={<EmptyState description={copy.errorTitle} title={copy.errorTitle} />}
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={detail.reload}
            retryLabel={copy.retry}
            title={copy.errorTitle}
          />
        }
        loading={<Skeleton label={copy.loadingLabel} shape="text" />}
        state={state.status}
      >
        {state.status === 'ready' ? (
          <>
            <Summary messages={messages} settlement={state.detail.settlement} />
            <Calculation messages={messages} settlement={state.detail.settlement} />
            <Items items={state.detail.items} messages={messages} />
          </>
        ) : null}
      </DataList>
    </div>
  )
}

/** 회차 · 상태 · 생성 · 지급. 「이 정산서가 무엇인가」에만 답한다. */
function Summary({
  settlement,
  messages,
}: {
  readonly settlement: Settlement
  readonly messages: Messages
}) {
  const copy = messages.settlementDetail.summary

  return (
    <section
      aria-label={copy.regionLabel}
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <dl className="grid gap-3 sm:grid-cols-2">
        <Field
          label={copy.periodLabel}
          value={messages.settlementList.table.periodRange
            .replace('{from}', day(settlement.periodStart))
            .replace('{until}', day(inclusiveEnd(settlement.periodEnd)))}
        />
        <div className="flex flex-col gap-1">
          <dt className="text-fg-muted text-sm">{copy.statusLabel}</dt>
          <dd>
            <Badge variant="neutral">{messages.settlements.statusLabels[settlement.status]}</Badge>
          </dd>
        </div>
        <Field label={copy.createdLabel} value={dateTime(settlement.createdAt)} />
        {/*
          지급 전에 빈 칸을 두지 않는다. 금액 칸 옆의 빈 칸은 「0원 지급」으로 읽힌다.
        */}
        <Field
          label={copy.paidLabel}
          value={settlement.paidAt === null ? copy.notPaid : dateTime(settlement.paidAt)}
        />
      </dl>

      {/*
        보류 사유는 **해소된 뒤에도 남는다** (계약의 `holdReason`). 판매자가 묻는 것은
        대개 지급이 끝난 뒤이고, 그때 사라져 있으면 답할 것이 없다.
      */}
      {settlement.holdReason === null ? null : (
        <p
          className="border-warning bg-warning-surface text-fg rounded-md border px-4 py-3 text-sm"
          role="status"
        >
          {`${copy.holdTitle} ${settlement.holdReason}`}
        </p>
      )}
    </section>
  )
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-fg-muted text-sm">{label}</dt>
      <dd className="text-fg">{value}</dd>
    </div>
  )
}

/**
 * 계산 근거 다섯 줄 (F2 · 3장 요구사항 5).
 *
 * **수수료와 판매자 부담 쿠폰이 각각 한 줄이다.** 「차감 220,000원」 한 줄로 합치면
 * 판매자가 실제로 묻는 것 — 「플랫폼이 떼 간 것은 얼마고 내가 낸 것은 얼마냐」 —
 * 에 답할 수 없다. 성질도 다르다: 하나는 요율이, 다른 하나는 자기가 발행한 쿠폰이
 * 정한다.
 *
 * 마지막에 붙는 한 줄이 **플랫폼 쿠폰과 적립금은 차감되지 않는다**는 사실을 말한다.
 * 그것이 없으면 「구매자는 45,000원을 냈는데 왜 판매액이 50,000원이죠」가 남는다.
 */
function Calculation({
  settlement,
  messages,
}: {
  readonly settlement: Settlement
  readonly messages: Messages
}) {
  const copy = messages.settlementDetail.calculation
  const lines = calculationLines(settlement)

  const columns: readonly TableColumn<CalculationLine>[] = [
    {
      cell: (row) => (
        <span className={row.total ? 'font-bold' : undefined}>{copy.lines[row.key]}</span>
      ),
      header: copy.labelHeader,
      key: 'label',
    },
    {
      align: 'end',
      cell: (row) => (
        <span className={row.total ? 'font-bold' : undefined}>{money(row.amount)}</span>
      ),
      header: copy.amountHeader,
      key: 'amount',
      numeric: true,
    },
  ]

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <h2 className="text-fg text-lg font-semibold">{copy.title}</h2>

      <div className="overflow-x-auto">
        <Table caption={copy.caption} columns={columns} rowKey={(row) => row.key} rows={lines} />
      </div>

      <p className="text-fg-subtle text-sm">{copy.platformNote}</p>
    </section>
  )
}

/** 이 정산서에 실린 주문들. 차감 줄은 **셋 다 음수**라 세로로 더하면 위와 맞는다. */
function Items({
  items,
  messages,
}: {
  readonly items: readonly SettlementItem[]
  readonly messages: Messages
}) {
  const copy = messages.settlementDetail.items

  const columns: readonly TableColumn<SettlementItem>[] = [
    { cell: (row) => row.orderNumber, header: copy.orderNumberHeader, key: 'orderNumber' },
    {
      cell: (row) => messages.settlements.itemTypeLabels[row.type],
      header: copy.typeHeader,
      key: 'type',
    },
    {
      align: 'end',
      cell: (row) => money(row.salesAmount),
      header: copy.salesHeader,
      key: 'sales',
      numeric: true,
    },
    {
      align: 'end',
      cell: (row) => money(row.commissionAmount),
      header: copy.commissionHeader,
      key: 'commission',
      numeric: true,
    },
    {
      align: 'end',
      cell: (row) => money(row.sellerCouponAmount),
      header: copy.sellerCouponHeader,
      key: 'sellerCoupon',
      numeric: true,
    },
    {
      align: 'end',
      cell: (row) => money(row.payoutAmount),
      header: copy.payoutHeader,
      key: 'payout',
      numeric: true,
    },
  ]

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <h2 className="text-fg text-lg font-semibold">{copy.title}</h2>

      {items.length === 0 ? (
        <p className="text-fg-muted text-sm">{copy.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table caption={copy.caption} columns={columns} rowKey={(row) => row.id} rows={items} />
        </div>
      )}

      <p className="text-fg-subtle text-xs">{copy.note}</p>
    </section>
  )
}
