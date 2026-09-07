'use client'

import type { AdminOrderRow, ApiFailure, ErrorMessages } from '@shopping/shared'
import { failureMessage, platformOwnership } from '@shopping/shared'
import { DataList, EmptyState, ErrorState, Pagination, Skeleton } from '@shopping/ui/components'
import { useCallback, useState } from 'react'

import { useOrders } from '@/lib/catalog/use-orders'
import { useAuthorization } from '@/lib/auth/authorization'
import { useStoreChoices } from '@/lib/stores/use-stores'
import type { AdminOrderMessages } from '@/messages'

import { OrderDetailPanel } from './order-detail-panel'
import { OrderFilters } from './order-filters'
import { OrderTable } from './order-table'

/**
 * `/orders` — 주문을 사람·스토어·기간으로 가로질러 (TASK-0095).
 *
 * ## 읽기만 하는 화면이다
 *
 * 쓰기가 하나도 없다. 그래서 토스트도, 미리 죽인 버튼도, 거절을 세우는 자리도 없다 —
 * 실패는 전부 화면 안의 오류 상태로 선다. **그것이 이 화면의 설계다** (F7 · 4.4):
 * 관리자가 결과를 바꿔야 하면 클레임 개입으로 가고, 그 사실은 주문 상세가 말한다.
 *
 * ## 자격은 `order.read` 를 `any` 로 든 사람의 것이다
 *
 * `order.read` 자체는 구매자도 갖고 있고 `own` 으로 좁혀져 있을 뿐이다. 서버가 재는
 * 것은 그 **스코프**이고(`admin-catalog.service.ts` 의 `assertPlatformRead`), 화면도
 * 같은 질문을 `platformOwnership` 으로 던진다 — 물어봐야 거절당할 계정에게 오류를
 * 그리는 대신 **왜 안 되는지**를 말한다.
 */

export interface OrderListWorkspaceProps {
  readonly messages: AdminOrderMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function OrderListWorkspace({ messages, errors }: OrderListWorkspaceProps) {
  const { ready, canOn, reasonOn } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.list.loadingLabel} lines={6} />

  if (!canOn('order.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('order.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  return <OrderConsole errors={errors} messages={messages} />
}

function OrderConsole({ messages, errors }: OrderListWorkspaceProps) {
  const orders = useOrders()
  const stores = useStoreChoices()

  /** 열려 있는 주문 — **목록의 줄 그대로.** 묶음은 이미 그 안에 있다. */
  const [opened, setOpened] = useState<AdminOrderRow | null>(null)

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { state, pagination, filters } = orders
  const rows = state.status === 'ready' ? state.orders : []

  return (
    <div className="flex flex-col gap-4">
      <OrderFilters
        disabled={state.status === 'loading'}
        messages={messages.list}
        onChange={orders.setFilters}
        stores={stores}
        value={filters}
      />

      {/* 별이 박힌 이름이 고장으로 읽히지 않게, 그리고 원본이 필요할 때 어디로 가야
          하는지 알 수 있게 (4.3 · TASK-0093 F7). */}
      <p className="text-fg-muted text-xs">{messages.list.maskedNotice}</p>

      <DataList
        empty={
          orders.narrowed ? (
            <EmptyState
              description={messages.list.filteredEmptyDescription}
              title={messages.list.filteredEmptyTitle}
            />
          ) : (
            <EmptyState
              description={messages.list.emptyDescription}
              title={messages.list.emptyTitle}
            />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={orders.reload}
            retryLabel={messages.list.retryLabel}
            title={messages.list.errorTitle}
          />
        }
        loading={<Skeleton label={messages.list.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <OrderTable
          messages={messages.list}
          onOpen={setOpened}
          rows={rows}
          statusLabels={messages.statusLabels}
        />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.list.pagination.label}
          nextLabel={messages.list.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.list.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, rows.length)}
        />
      </DataList>

      {opened === null ? null : (
        <OrderDetailPanel
          describe={describe}
          messages={messages}
          onClose={() => {
            setOpened(null)
          }}
          order={opened}
        />
      )}
    </div>
  )
}

/**
 * `2 페이지 · 20건`.
 *
 * 카탈로그의 조각을 이어 붙인다. 자리 표시자는 사람에게 `{page}` 로 그려질 수 있는
 * 것이 하나 더 생기는 일이고, 여기 숫자에는 문법이 필요 없다.
 */
function pageStatus(messages: AdminOrderMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.list.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
