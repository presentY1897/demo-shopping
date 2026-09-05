'use client'

import { Button, DataList, EmptyState, useInfiniteScroll } from '@shopping/ui/components'
import Link from 'next/link'
import { useState } from 'react'

import type { OrderFilter } from '@/lib/orders/order-filters'
import { DEFAULT_ORDER_FILTER, isDefaultFilter } from '@/lib/orders/order-filters'
import { useOrderHistory } from '@/lib/orders/use-order-history'
import type { MyPageMessages } from '@/messages'

import { AccountLoadFailure, AccountLoading, AccountWriteFailure } from './account-notices'
import { OrderFilterBar } from './order-filter-bar'
import { OrderSummaryRow } from './order-summary-row'

/**
 * `/mypage/orders` — 주문 내역 (TASK-0063).
 *
 * ## 이 화면이 사람에게 지켜야 하는 것
 *
 * **조건은 서버가 건다.** 두 셀렉트가 질의가 되고(`order-filters.ts`) 목록은 그
 * 답을 그린다. 그전에는 화면이 불러온 것 위에서 걸렀고, 그래서 「조건에 맞는 주문이
 * 더 있을 수 있습니다」라는 한 줄로 자기 한계를 말해야 했다 — 지금 그 문장은
 * **거짓**이다. 서버가 걸렀으므로 남은 장이 있으면 조건에 맞는 것이 있을 수 있는 게
 * 아니라 **있고**, 그 사실을 말하는 것은 「더 보기」다.
 *
 * **빈 상태가 둘이다.** 아무것도 안 산 사람과 조건을 좁힌 사람은 다음에 할 일이
 * 다르다 — 앞쪽은 상품을 보러 가고 뒤쪽은 조건을 넓힌다. 기본 조건이 「최근
 * 3개월」이라 이 구분은 서버가 걸러 준 뒤에도 그대로 필요하다.
 *
 * ## 왜 이전/다음이 아니라 누적인가
 *
 * `use-order-history.ts` 가 그 이유를 갖고 있다. 여기서는 그 결과만 그린다 —
 * 센티널과 「더 보기」 버튼이고, 버튼은 `IntersectionObserver` 가 없는 환경에서만
 * 나온다. 그 규약은 `ProductList` 의 것을 그대로 따른다 (U5: 무한 스크롤만으로는
 * 키보드로 조작할 수 없다).
 */
export function OrderHistory({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.orders

  const [filter, setFilter] = useState<OrderFilter>(DEFAULT_ORDER_FILTER)

  /**
   * 「지금」을 마운트 시점에 한 번 고정한다.
   *
   * 렌더마다 `Date.now()` 를 부르면 「최근 3개월」의 시작이 렌더 사이에 달라지고,
   * 그 값이 질의에 들어가므로 화면이 스스로 목록을 다시 부른다. 검사가 경계를 고를
   * 수 없는 것도 그대로다 — 순수 함수 쪽이 시각을 인자로 받는 것과 같은 이유다
   * (QUALITY-GATES 6장).
   */
  const [now] = useState(() => new Date())

  const history = useOrderHistory(filter, now)
  const shown = history.items

  const { sentinelRef, supported } = useInfiniteScroll({
    hasMore: history.hasMore,
    loading: history.loadingMore,
    onLoadMore: history.loadMore,
  })

  /**
   * 조건을 **사람이** 좁혔는가. 빈 상태 둘을 가르고, 「조건 지우기」가 할 일이 있게 한다.
   *
   * **기본값이 아무것도 좁히지 않는 것이 이 갈래를 성립시킨다.** 기본이 「최근
   * 3개월」이었다면 사람이 고르지 않은 조건이 결과를 지우고, 오래된 주문만 있는
   * 계정이 「아직 주문한 상품이 없습니다」를 보게 된다 — 틀린 문장이고, 그 사람
   * 눈에는 자기 주문이 사라진 것으로 보인다 (`DEFAULT_ORDER_PERIOD` 주석).
   */
  const filtered = !isDefaultFilter(filter)

  return (
    <div className="flex flex-col gap-4">
      <OrderFilterBar filter={filter} messages={copy} onChange={setFilter} />

      <DataList
        empty={
          filtered ? (
            <EmptyState
              action={
                <Button
                  onClick={() => {
                    setFilter(DEFAULT_ORDER_FILTER)
                  }}
                  variant="outline"
                >
                  {copy.resetFilter}
                </Button>
              }
              description={copy.filteredEmptyBody}
              title={copy.filteredEmptyTitle}
            />
          ) : (
            <EmptyState
              action={
                <Link className="text-primary text-sm font-medium underline" href="/search">
                  {copy.emptyAction}
                </Link>
              }
              description={copy.emptyBody}
              title={copy.emptyTitle}
            />
          )
        }
        error={
          history.state.status === 'error' ? (
            <AccountLoadFailure
              failure={history.state.failure}
              messages={messages}
              onRetry={history.reload}
            />
          ) : null
        }
        loading={<AccountLoading label={copy.loadingLabel} />}
        state={stateOf(history.state.status, shown.length)}
      >
        {/*
          **불러온 개수 하나다.** 조건에 드는 것과 불러온 것이 이제 같은 집합이라
          두 숫자를 나란히 적으면 언제나 같은 값을 두 번 쓰게 된다.
        */}
        <p className="text-fg-muted text-sm" role="status">
          {copy.countLabel.replace('{count}', String(shown.length))}
        </p>

        <ul aria-label={copy.listLabel} className="grid gap-3">
          {shown.map((order) => (
            <OrderSummaryRow key={order.id} messages={copy} order={order} />
          ))}
          {/* 센티널은 `<ul>` 안이어야 목록 의미가 깨지지 않는다 (`useInfiniteScroll`). */}
          <li aria-hidden="true" ref={sentinelRef} />
        </ul>
      </DataList>

      {history.loadMoreFailure === null ? null : (
        <AccountWriteFailure
          failure={history.loadMoreFailure}
          messages={messages}
          title={copy.loadMoreFailedTitle}
        />
      )}

      {/*
        스크롤로도 내려오지만 버튼이 없으면 키보드만으로는 끝에 닿지 못한다 (U5).
        `supported` 가 `false` 인 곳 — 서버 렌더, jsdom, 옛 브라우저 — 에서는 이것이
        유일한 길이다.
      */}
      {history.hasMore && (!supported || history.loadMoreFailure !== null) ? (
        <Button
          loading={history.loadingMore}
          onClick={history.loadMore}
          type="button"
          variant="outline"
        >
          {history.loadingMore ? copy.loadingMore : copy.loadMore}
        </Button>
      ) : null}
    </div>
  )
}

/** `DataList` 의 네 상태를, 읽기의 세 상태와 「조건에 맞는 것이 없다」에서. */
function stateOf(status: 'loading' | 'error' | 'ready', count: number) {
  if (status === 'loading') return 'loading'
  if (status === 'error') return 'error'

  return count === 0 ? 'empty' : 'ready'
}
