'use client'

import type { ApiFailure, SellerClaimListItem } from '@shopping/shared'
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
  Tabs,
} from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useMinWidth } from '@shopping/ui/layout'
import { useCallback } from 'react'

import type { SellerClaimTab } from '@/lib/claims/claim-console'
import { SELLER_CLAIM_TABS, tabCountOf } from '@/lib/claims/claim-console'
import { useSellerClaims } from '@/lib/claims/use-seller-claims'
import { dateTime } from '@/lib/orders/format'
import type { ClaimListMessages } from '@/messages'
import { messagesFor } from '@/messages'

import { ClaimFilters } from './claim-filters'

/**
 * `/claims` — 들어온 취소·반품, 그 위의 뱃지, 그리고 지연 강조.
 *
 * **표와 카드 중 하나만 마운트한다** (설계서 「모바일 전용 UI 패턴」). 미디어 쿼리로
 * 둘 다 그리면 DOM 이 두 배가 되고 접근성 트리도 중복된다 — 그래서 뷰포트 훅이 고르고,
 * 열의 정의(`TableColumn[]`)는 **한 벌**이라 두 모양이 다른 것을 보여 줄 수 없다.
 *
 * **서버 렌더에서 아무것도 기다리지 않는다.** 제목·탭·필터는 API 가 깨어나는 동안
 * 만들어져 나가고, 그것이 이 화면에 네 상태가 있는 이유다 (P5 · U1).
 *
 * **정렬은 서버의 것이다.** 「대기가 먼저」는 커서의 첫 칸이고(`stageRank`), 화면이 줄을
 * 다시 정렬하면 그 순간 커서가 가리키던 자리와 화면의 순서가 갈린다.
 */
export interface ClaimListWorkspaceProps {
  readonly title: string
  readonly messages?: ClaimListMessages
}

/** 데스크톱과 모바일을 가르는 폭. 주문 목록과 같은 지점이다 — 같은 콘솔의 같은 표다. */
const TABLE_MIN_WIDTH = 768

export function ClaimListWorkspace({
  title,
  messages = messagesFor().claimList,
}: ClaimListWorkspaceProps) {
  const claims = useSellerClaims()
  const vocabulary = messagesFor().claims
  const wide = useMinWidth(TABLE_MIN_WIDTH)

  const { state, summary, pagination } = claims
  const items = state.status === 'ready' ? state.items : []
  const describe = useCallback(
    (value: ApiFailure) =>
      failureMessage(value, { errors: messagesFor().errors, failures: messagesFor().apiFailures }),
    [],
  )

  const columns: readonly TableColumn<SellerClaimListItem>[] = [
    {
      key: 'orderNumber',
      header: messages.table.orderNumber,
      cell: (row) => <Link href={`/claims/${row.id}`}>{row.orderNumber}</Link>,
    },
    {
      key: 'type',
      header: messages.table.type,
      cell: (row) => vocabulary.typeLabels[row.type],
    },
    {
      key: 'status',
      header: messages.table.status,
      cell: (row) => <Badge variant="neutral">{vocabulary.statusLabels[row.status]}</Badge>,
    },
    {
      key: 'stage',
      header: messages.table.stage,
      // 대기만 눈에 띄게 한다. 셋 다 강조하면 아무것도 강조되지 않는다.
      cell: (row) => (
        <Badge variant={row.stage === 'WAITING' ? 'warning' : 'neutral'}>
          {vocabulary.stageLabels[row.stage]}
        </Badge>
      ),
    },
    {
      key: 'items',
      header: messages.table.items,
      cell: (row) => (
        <span className="flex flex-col">
          <span>{headlineOf(row, messages)}</span>
          <span className="text-fg-muted text-xs">
            {messages.table.quantity.replace('{count}', String(row.totalQuantity))}
          </span>
        </span>
      ),
    },
    {
      key: 'requestedAt',
      header: messages.table.requestedAt,
      cell: (row) => dateTime(row.requestedAt),
    },
    {
      key: 'dueAt',
      header: messages.table.dueAt,
      /*
       * **지연을 색만으로 말하지 않는다.**
       *
       * 붉은 글씨는 색을 구분하지 못하는 사람에게 그냥 글씨이고, 흑백 인쇄에서는
       * 아무것도 아니다. 그래서 배지가 **문장을 들고** 있고, 색은 그 문장을 거드는
       * 것이지 문장을 대신하지 않는다 (설계서 접근성 규칙).
       */
      cell: (row) => (
        <span className="flex flex-col gap-1">
          <span>{dateTime(row.dueAt)}</span>
          {row.overdue ? <Badge variant="danger">{messages.deadline.overdue}</Badge> : null}
        </span>
      ),
    },
  ]

  const rows = (
    <>
      {wide ? (
        <Table
          caption={messages.table.caption}
          columns={columns}
          rowKey={(row) => row.id}
          rows={items}
          stickyHeader
        />
      ) : (
        <TableToCards
          actions={(row) => <Link href={`/claims/${row.id}`}>{messages.table.open}</Link>}
          caption={messages.table.caption}
          columns={columns}
          rowKey={(row) => row.id}
          rows={items}
          titleKey="orderNumber"
        />
      )}
      <Pagination
        hasNext={pagination.hasNext}
        hasPrevious={pagination.hasPrevious}
        label={messages.pagination.label}
        nextLabel={messages.pagination.next}
        onNext={pagination.goNext}
        onPrevious={pagination.goPrevious}
        previousLabel={messages.pagination.previous}
        status={messages.pagination.page.replace('{page}', String(pagination.pageIndex + 1))}
      />
    </>
  )

  const body = (
    <DataList
      empty={
        claims.isFiltered ? (
          <EmptyState
            description={messages.filteredEmpty.description}
            title={messages.filteredEmpty.title}
          />
        ) : (
          <EmptyState description={messages.empty.description} title={messages.empty.title} />
        )
      }
      error={
        <ErrorState
          description={state.status === 'error' ? describe(state.failure) : undefined}
          onRetry={claims.reload}
          retryLabel={messages.retry}
          title={messages.errorTitle}
        />
      }
      loading={<Skeleton label={messages.loadingLabel} shape="text" />}
      state={state.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : state.status}
    >
      {rows}
    </DataList>
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-fg text-2xl font-bold">{title}</h1>
          <p className="text-fg-muted text-sm">{messages.description}</p>
          {/*
            **기한의 정의를 감추지 않는다.** 서버는 주말만 빼고 공휴일은 보지 않으므로
            (`claim-deadline.ts`), 그 사실을 적어 두지 않으면 연휴에 뜨는 「기한 초과」가
            버그로 신고된다.
          */}
          <p className="text-fg-subtle text-xs">{messages.deadline.rule}</p>
        </div>
        <p className="flex flex-wrap items-center gap-2">
          {summary === null ? null : summary.waiting === 0 ? (
            <Badge variant="neutral">{messages.badges.none}</Badge>
          ) : (
            <Badge variant="warning">
              {messages.badges.waiting.replace('{count}', String(summary.waiting))}
            </Badge>
          )}
        </p>
      </header>

      <Tabs
        aria-label={messages.tabs.label}
        items={SELLER_CLAIM_TABS.map((tab) => ({
          value: tab,
          label:
            summary === null
              ? messages.tabs.names[tab]
              : messages.tabs.countLabel
                  .replace('{name}', messages.tabs.names[tab])
                  .replace('{count}', String(tabCountOf(tab, summary.stages))),
          // 활성 탭에만 내용을 준다. 네 벌을 만들면 같은 표가 네 번 생기고, 라딕스가
          // 하나만 그린다는 사실에 기대는 코드가 된다.
          content: tab === claims.filters.tab ? body : null,
        }))}
        onValueChange={(value) => {
          claims.setFilters({ ...claims.filters, tab: value as SellerClaimTab })
        }}
        value={claims.filters.tab}
      />

      <ClaimFilters
        disabled={state.status === 'loading'}
        messages={messages}
        onChange={claims.setFilters}
        value={claims.filters}
      />
    </div>
  )
}

/** 「울 코트 외 2건」. 개수는 서버가 세고 문장은 여기서 만든다. */
function headlineOf(row: SellerClaimListItem, messages: ClaimListMessages): string {
  if (row.itemCount <= 1) return row.headline

  return messages.table.headlineWithRest
    .replace('{headline}', row.headline)
    .replace('{rest}', String(row.itemCount - 1))
}
