'use client'

import type { ApiFailure, Settlement, SettlementListResponse } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import {
  Badge,
  DataList,
  EmptyState,
  ErrorState,
  Link,
  Pagination,
  Skeleton,
  Table,
  TableToCards,
} from '@shopping/ui/components'
import type { BadgeVariant, TableColumn } from '@shopping/ui/components'
import { useMinWidth } from '@shopping/ui/layout'
import { useCallback } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { count, day, money } from '@/lib/orders/format'
import { inclusiveEnd, settlementHref } from '@/lib/settlements/settlement-console'
import { useSellerSettlements } from '@/lib/settlements/use-seller-settlements'
import type { Messages } from '@/messages'
import { messagesFor } from '@/messages'

import { SettlementFilters } from './settlement-filters'
import { SettlementOutlookPanel } from './settlement-outlook-panel'

/**
 * `/settlements` — 「언제 얼마가 들어오나」 (TASK-0082).
 *
 * 위에서 아래로 **시간 순**이다: 아직 정산서가 아닌 돈(예정액)이 먼저 오고, 이미
 * 정산서가 된 회차들이 그 아래에 온다. 반대로 놓으면 판매자가 가장 먼저 묻는 것이
 * 화면 아래에 있게 된다.
 *
 * **표와 카드 중 하나만 마운트한다** (설계서 「모바일 전용 UI 패턴」). 미디어 쿼리로
 * 둘 다 그리면 DOM 이 두 배가 되고 접근성 트리도 중복된다.
 *
 * **서버 렌더에서 아무것도 기다리지 않는다.** 제목과 필터는 이 경계 바깥에서 만들어져
 * 나가고, 그것이 이 목록에 네 상태가 있는 이유다 (P5 · U1).
 */
export interface SettlementListWorkspaceProps {
  readonly title: string
  readonly messages?: Messages
}

/** 데스크톱과 모바일을 가르는 폭. 쿠폰·클레임·주문 목록과 같은 지점이다. */
const TABLE_MIN_WIDTH = 768

/** 입점 신청. 스토어가 없는 계정이 여기서 할 수 있는 유일한 다음 걸음이다. */
const APPLY_HREF = '/apply'

export function SettlementListWorkspace({
  title,
  messages = messagesFor(),
}: SettlementListWorkspaceProps) {
  const { state } = useAuth()
  const copy = messages.settlementList
  const sellerId = state.status === 'signedIn' ? state.user.sellerId : null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-fg text-2xl font-bold">{title}</h1>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </header>

      {/*
        세션을 아직 모른다. 「스토어가 없다」와 **같은 화면을 보여 주면 안 되는** 상태다 —
        묻지도 않고 입점 신청을 권하는 셈이 된다.
      */}
      {state.status === 'checking' ? <Skeleton label={copy.loadingLabel} shape="text" /> : null}

      {/*
        스토어가 없는 계정. 목록을 **부르지도 않는다** — `sellerId` 없이 부르면 서버는
        그것을 플랫폼 전체 목록 요청으로 읽고 403 을 돌려주므로, 아직 신청하지 않았을
        뿐인 사람이 「권한이 없어요」를 보게 된다 (F1).
      */}
      {state.status !== 'checking' && sellerId === null ? (
        <EmptyState
          action={<Link href={APPLY_HREF}>{copy.noStore.applyLabel}</Link>}
          description={copy.noStore.body}
          title={copy.noStore.title}
        />
      ) : null}

      {sellerId === null ? null : <SettlementConsole messages={messages} sellerId={sellerId} />}
    </div>
  )
}

function SettlementConsole({
  sellerId,
  messages,
}: {
  readonly sellerId: string
  readonly messages: Messages
}) {
  const copy = messages.settlementList
  const settlements = useSellerSettlements(sellerId)
  const wide = useMinWidth(TABLE_MIN_WIDTH)

  const { state, pagination } = settlements
  const items = state.status === 'ready' ? state.items : []

  const describe = useCallback(
    (failure: ApiFailure) =>
      failureMessage(failure, { errors: messages.errors, failures: messages.apiFailures }),
    [messages],
  )

  const columns: readonly TableColumn<Settlement>[] = [
    {
      cell: (row) => (
        <span className="flex flex-col">
          <span>
            {copy.table.periodRange
              .replace('{from}', day(row.periodStart))
              .replace('{until}', day(inclusiveEnd(row.periodEnd)))}
          </span>
          {row.holdReason === null ? null : (
            <span className="text-fg-muted text-xs">
              {copy.table.holdReason.replace('{reason}', row.holdReason)}
            </span>
          )}
        </span>
      ),
      header: copy.table.period,
      key: 'period',
    },
    {
      /*
       * **상태를 색만으로 말하지 않는다.** 배지가 문장을 들고 있고 색은 그것을
       * 거들 뿐이다 (설계서 접근성 규칙).
       */
      cell: (row) => (
        <Badge variant={BADGE_VARIANTS[row.status]}>
          {messages.settlements.statusLabels[row.status]}
        </Badge>
      ),
      header: copy.table.status,
      key: 'status',
    },
    {
      align: 'end',
      cell: (row) => money(row.salesAmount),
      header: copy.table.salesAmount,
      key: 'sales',
      numeric: true,
    },
    {
      align: 'end',
      // **여기서 계산하지 않는다** (F3). 서버가 보낸 값을 그대로 그린다.
      cell: (row) => money(row.payoutAmount),
      header: copy.table.payoutAmount,
      key: 'payout',
      numeric: true,
    },
    {
      cell: (row) => <Link href={settlementHref(row.id)}>{copy.table.detailLabel}</Link>,
      header: copy.table.actions,
      key: 'actions',
    },
  ]

  return (
    <>
      <SettlementOutlookPanel messages={messages} state={settlements.outlook} />

      <SettlementFilters
        disabled={state.status === 'loading'}
        messages={messages}
        onChange={settlements.setFilters}
        value={settlements.filters}
      />

      <DataList
        empty={
          settlements.isFiltered ? (
            <EmptyState
              description={copy.filteredEmpty.description}
              title={copy.filteredEmpty.title}
            />
          ) : (
            <EmptyState description={copy.empty.description} title={copy.empty.title} />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={settlements.reload}
            retryLabel={copy.retry}
            title={copy.errorTitle}
          />
        }
        loading={<Skeleton label={copy.loadingLabel} shape="text" />}
        state={state.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : state.status}
      >
        {/*
          **필터 전체의 합계**다. 페이지의 합이 아니다 — 계약이 그렇게 보내고, 페이지
          합으로 답하면 다음 장을 넘길 때마다 총액이 달라진다.
        */}
        {state.status === 'ready' ? <Totals messages={messages} totals={state.totals} /> : null}

        {wide ? (
          <Table
            caption={copy.table.caption}
            columns={columns}
            rowKey={(row) => row.id}
            rows={items}
            stickyHeader
          />
        ) : (
          <TableToCards
            caption={copy.table.caption}
            columns={columns}
            rowKey={(row) => row.id}
            rows={items}
            titleKey="period"
          />
        )}

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={copy.pagination.label}
          nextLabel={copy.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={copy.pagination.previous}
          status={copy.pagination.page.replace('{page}', String(pagination.pageIndex + 1))}
        />
      </DataList>
    </>
  )
}

/** 지금 조건이 고른 것들의 합. 서버가 보낸 값이라 페이지를 넘겨도 변하지 않는다. */
function Totals({
  messages,
  totals,
}: {
  readonly messages: Messages
  readonly totals: SettlementListResponse['totals']
}) {
  const copy = messages.settlementList.totals

  return (
    <section
      aria-label={copy.regionLabel}
      className="border-border flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border p-3"
    >
      <h2 className="text-fg-muted text-sm">{copy.regionLabel}</h2>
      <p className="text-fg text-xl font-bold">
        {copy.payout.replace('{amount}', money(totals.payoutAmount))}
      </p>
      <p className="text-fg-muted text-sm">{copy.count.replace('{count}', count(totals.count))}</p>
    </section>
  )
}

/**
 * 상태마다의 색.
 *
 * `Record<SettlementStatus, …>` 이라 계약에 상태가 하나 늘면 여기가 컴파일에서 걸린다.
 *
 * 강조는 **판매자가 알아야 하는 것**에만 준다. 보류는 지급이 멈춰 있다는 뜻이라
 * 경고이고, 지급 완료는 좋은 소식이라 성공이다. 대기와 승인됨은 정상 진행이므로
 * 중립이다 — 넷 다 강조하면 아무것도 강조되지 않는다.
 */
const BADGE_VARIANTS: Readonly<Record<Settlement['status'], BadgeVariant>> = {
  APPROVED: 'neutral',
  HOLD: 'warning',
  PAID: 'success',
  PENDING: 'neutral',
}
