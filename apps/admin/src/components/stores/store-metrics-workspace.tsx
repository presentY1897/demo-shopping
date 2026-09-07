'use client'

import type { AdminSellerRow, ApiFailure, ErrorMessages } from '@shopping/shared'
import { failureMessage, platformOwnership } from '@shopping/shared'
import { DataList, EmptyState, ErrorState, Pagination, Skeleton } from '@shopping/ui/components'
import { useCallback, useState } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import { useStores } from '@/lib/stores/use-stores'
import type { SellerReviewMessages, StoreMessages } from '@/messages'

import { StoreFilters } from './store-filters'
import { StoreHistoryPanel } from './store-history-panel'
import { StoreTable } from './store-table'

/**
 * `/sellers` 의 두 번째 탭 — **어느 스토어를 봐야 하나** (TASK-0094).
 *
 * ## 심사 큐를 대체하지 않는다
 *
 * 같은 라우트의 다른 탭이다. 묻는 축이 다르기 때문이다 — 저쪽은 「이 신청을
 * 승인할까」이고 이쪽은 「어느 스토어를 봐야 하나」다 (4.3). 계약도 같은 이유로
 * `admin/sellers` 와 `admin/stores` 로 갈려 있다.
 *
 * 승인·반려·정지·해제 버튼이 여기 없는 것도 그래서다. 이 TASK 가 더하는 것은 **지표와
 * 이력**뿐이고(4.3), 조치는 심사 탭과 그 상세 화면이 이미 하고 있다.
 *
 * ## 자격이 심사 탭과 다르다
 *
 * 지표는 `seller.read` 를 **`any` 로** 든 사람만 볼 수 있다(`admin-seller.service.ts`
 * 의 `assertPlatformRead`). `seller.read` 자체는 스토어 조회가 공개라 구매자도
 * 갖고 있으므로, 화면도 서버와 같은 질문을 `platformOwnership` 으로 던진다 — 물어봐야
 * 거절당할 계정에게 오류를 그리는 대신 **왜 안 되는지**를 말한다
 * (`user-list-workspace.tsx` 와 같은 규약).
 *
 * ## 쓰기가 없으므로 토스트도 없다
 *
 * 이 탭이 하는 일은 읽기 둘뿐이라, 실패는 전부 화면 안의 오류 상태로 선다.
 */

export interface StoreMetricsWorkspaceProps {
  readonly messages: StoreMessages
  /** 상태의 한국어 이름은 심사 탭의 것을 빌려 쓴다 — 한 화면이 한 이름을 쓴다. */
  readonly statusLabels: SellerReviewMessages['statusLabels']
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function StoreMetricsWorkspace({
  messages,
  statusLabels,
  errors,
}: StoreMetricsWorkspaceProps) {
  const { ready, canOn, reasonOn } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.list.loadingLabel} lines={6} />

  if (!canOn('seller.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('seller.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  return <StoreMetrics errors={errors} messages={messages} statusLabels={statusLabels} />
}

function StoreMetrics({ messages, statusLabels, errors }: StoreMetricsWorkspaceProps) {
  const stores = useStores()

  /** 이력이 열려 있는가 — 그리고 어느 줄에 대해서인가. */
  const [opened, setOpened] = useState<AdminSellerRow | null>(null)

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { state, pagination, filters } = stores
  const rows = state.status === 'ready' ? state.stores : []

  return (
    <div className="flex flex-col gap-4">
      <StoreFilters
        disabled={state.status === 'loading'}
        messages={messages.list}
        onChange={stores.setFilters}
        statusLabels={statusLabels}
        value={filters}
      />

      {/* 빈칸이 0이 아니라는 것을 표보다 먼저 말한다 (4.5). 이것을 모르면 클레임률
          정렬의 맨 위가 무엇인지도 오해한다. */}
      <p className="text-fg-muted text-xs">{messages.list.metricNotice}</p>

      <DataList
        empty={
          stores.narrowed ? (
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
            onRetry={stores.reload}
            retryLabel={messages.list.retryLabel}
            title={messages.list.errorTitle}
          />
        }
        loading={<Skeleton label={messages.list.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <StoreTable
          messages={messages.list}
          onOpenHistory={setOpened}
          rows={rows}
          statusLabels={statusLabels}
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
        <StoreHistoryPanel
          describe={describe}
          messages={messages.history}
          onClose={() => {
            setOpened(null)
          }}
          statusLabels={statusLabels}
          store={opened}
        />
      )}
    </div>
  )
}

/**
 * `2 페이지 · 20곳`.
 *
 * 카탈로그의 조각을 이어 붙인다. 자리 표시자는 사람에게 `{page}` 로 그려질 수 있는
 * 것이 하나 더 생기는 일이고, 여기 숫자에는 문법이 필요 없다 (`users` 화면과 같은
 * 방식).
 */
function pageStatus(messages: StoreMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.list.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
