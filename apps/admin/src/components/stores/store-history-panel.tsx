'use client'

import type { AdminSellerRow, ApiFailure, SellerStatusEvent } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import {
  Badge,
  DataList,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  Table,
} from '@shopping/ui/components'

import { statusVariant } from '@/lib/sellers/decisions'
import { storeDateTime } from '@/lib/stores/format'
import { eventKind, sanctionCount } from '@/lib/stores/store-console'
import { useStoreHistory } from '@/lib/stores/use-stores'
import type { SellerReviewMessages, StoreHistoryMessages } from '@/messages'

/**
 * 한 스토어의 제재 이력 (F6).
 *
 * ## 이 창이 답하는 질문은 하나다 — **몇 번 정지됐나**
 *
 * `Seller` 는 지금 상태와 사유만 들고 있어, 정지와 해제를 반복하면 앞의 것이 덮인다.
 * 그러면 **반복 위반과 한 번의 실수를 구별할 수 없다** (4.6). 그래서 표보다 먼저 그
 * 수를 한 문장으로 그린다 — 줄을 세어 보게 하지 않는 것이 이 창의 요점이다.
 *
 * ## 상태 두 칸을 사람의 말로 옮긴다
 *
 * 「SUSPENDED → ACTIVE」를 그대로 그리면 읽는 사람이 매번 머릿속에서 「해제」로
 * 옮기고, 표의 뜻이 그 번역에 달려 있으면 그 번역은 언젠가 틀린다. 갈래를 정하는 것은
 * 순수 함수다 (`lib/stores/store-console.ts` 의 `eventKind`).
 *
 * ## 처리자에 이름이 없다
 *
 * 계약이 싣는 것은 `actorId` 뿐이고(`sellerStatusEventSchema`), 그 이력은 처리자에
 * **외래키를 걸지 않는다** — 기록을 남기는 일이 기록되는 일을 막아서는 안 되기
 * 때문이다 (4.6). 그래서 이름을 지어내지 않고, 「관리자」와 그 id 를 그린다: 누구에게
 * 물어야 할지를 아는 데는 그것으로 충분하다.
 */

export interface StoreHistoryPanelProps {
  readonly store: AdminSellerRow
  readonly messages: StoreHistoryMessages
  readonly statusLabels: SellerReviewMessages['statusLabels']
  readonly onClose: () => void
  readonly describe: (failure: ApiFailure) => string
}

export function StoreHistoryPanel({
  store,
  messages,
  statusLabels,
  onClose,
  describe,
}: StoreHistoryPanelProps) {
  const history = useStoreHistory(store.sellerId)
  const { state } = history

  const events = state.status === 'ready' ? state.events : []
  const failure = state.status === 'error' ? state.failure : null

  const columns: readonly TableColumn<SellerStatusEvent>[] = [
    {
      key: 'movedAt',
      header: messages.columns.movedAt,
      cell: (event) => storeDateTime(event.createdAt),
    },
    {
      key: 'change',
      header: messages.columns.change,
      cell: (event) => (
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={statusVariant(event.toStatus)}>{messages.kinds[eventKind(event)]}</Badge>
          <span className="text-fg-subtle text-xs">
            {/* 갈래 옆에 원래의 두 칸도 남긴다. 갈래는 읽기 위한 것이고, 실제로
                무엇에서 무엇으로 갔는지는 그 밑에 있어야 확인이 된다. */}
            {event.fromStatus === null ? '' : `${statusLabels[event.fromStatus]} → `}
            {statusLabels[event.toStatus]}
          </span>
        </span>
      ),
    },
    {
      key: 'reason',
      header: messages.columns.reason,
      cell: (event) => event.reason ?? <span className="text-fg-subtle">{messages.noReason}</span>,
    },
    {
      key: 'actor',
      header: messages.columns.actor,
      cell: (event) =>
        event.actorId === null ? (
          <span className="text-fg-subtle">{messages.systemActor}</span>
        ) : (
          <span className="flex flex-col">
            <span>{messages.adminActor}</span>
            <span className="text-fg-subtle text-xs">{event.actorId}</span>
          </span>
        ),
    },
  ]

  return (
    <Modal
      closeLabel={messages.closeLabel}
      description={store.brandName}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open
      size="lg"
      title={messages.title}
    >
      <div className="flex flex-col gap-4">
        {state.status === 'ready' ? (
          <p className="text-fg text-sm font-medium">{summaryOf(messages, events)}</p>
        ) : null}

        <DataList
          empty={<EmptyState description={messages.emptyDescription} title={messages.emptyTitle} />}
          error={
            <ErrorState
              description={failure === null ? undefined : describe(failure)}
              onRetry={history.reload}
              retryLabel={messages.retryLabel}
              title={messages.errorTitle}
            />
          }
          loading={<Skeleton label={messages.loadingLabel} lines={4} />}
          state={
            state.status === 'ready' ? (events.length === 0 ? 'empty' : 'ready') : state.status
          }
        >
          <Table
            caption={messages.listLabel}
            columns={columns}
            rowKey={(event) => event.id}
            rows={events}
            sort={null}
          />
        </DataList>
      </div>
    </Modal>
  )
}

/**
 * 「지금까지 두 번 정지된 적이 있어요」, 또는 한 번도 없었다는 말.
 *
 * 0을 자리 표시자에 넣어 「0번 정지된 적이 있어요」로 그리지 않는다 — 그 문장은 사람이
 * 쓰지 않는 문장이고, 읽는 쪽은 한 번 더 세어 봐야 뜻을 잡는다.
 */
function summaryOf(messages: StoreHistoryMessages, events: readonly SellerStatusEvent[]): string {
  const count = sanctionCount(events)

  return count === 0 ? messages.noSanction : messages.summary.replace('{count}', String(count))
}
