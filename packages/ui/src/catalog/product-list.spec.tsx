/**
 * 목록의 네 가지 상태 (TASK-0040 F7) 와 무한 스크롤 (F5).
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DENSITY_GRID_COLUMNS } from '../density/density'
import { ProductList } from './product-list'
import type { ProductListLabels } from './product-list'

const labels: ProductListLabels = {
  loading: '상품을 불러오는 중입니다',
  emptyTitle: '결과가 없어요',
  emptyDescription: '조건을 바꿔 다시 찾아보세요.',
  errorTitle: '불러오지 못했습니다',
  retry: '다시 시도',
  loadMore: '더 보기',
  gridLabel: '검색 결과',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function rows(count: number) {
  return Array.from({ length: count }, (_unused, index) => <li key={index}>상품 {index}</li>)
}

describe('F7 — 네 가지 상태', () => {
  it('읽는 중에는 그리드 모양의 자리를 잡아 둔다', () => {
    // 스피너는 행이 도착할 때 아래를 전부 밀어낸다. 같은 열 수의 뼈대는 안 민다 —
    // 그것이 CLS 가 재는 것의 대부분이다.
    render(
      <ProductList density={2} labels={labels} state="loading">
        {rows(0)}
      </ProductList>,
    )

    expect(screen.getByRole('status')).toHaveTextContent(labels.loading)
    const [grid] = screen.getAllByRole('list')

    if (grid === undefined) throw new Error('그리드가 없습니다.')

    expect(within(grid).getAllByRole('listitem')).toHaveLength(DENSITY_GRID_COLUMNS[2].xl * 2)
  })

  it('결과가 없으면 조건을 바꾸라고 말한다', () => {
    render(
      <ProductList density={2} labels={labels} state="empty">
        {rows(0)}
      </ProductList>,
    )

    expect(screen.getByText(labels.emptyTitle)).toBeVisible()
  })

  it('실패하면 다시 시도할 수 있다', async () => {
    const onRetry = vi.fn()

    render(
      <ProductList density={2} labels={labels} onRetry={onRetry} state="error">
        {rows(0)}
      </ProductList>,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: labels.retry }))

    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('결과가 있으면 그리드를 그린다', () => {
    render(
      <ProductList density={2} labels={labels} state="ready">
        {rows(3)}
      </ProductList>,
    )

    expect(
      within(screen.getByRole('list', { name: labels.gridLabel })).getAllByRole('listitem'),
    ).toHaveLength(3)
  })
})

describe('F5 — 무한 스크롤', () => {
  it('관찰자가 없으면 버튼을 대신 낸다', async () => {
    // 관찰자로만 내려갈 수 있는 목록은 관찰자가 없는 사람에게는 거기서 끝나는
    // 목록이다.
    vi.stubGlobal('IntersectionObserver', undefined)

    const onLoadMore = vi.fn()

    render(
      <ProductList density={2} hasMore labels={labels} onLoadMore={onLoadMore} state="ready">
        {rows(2)}
      </ProductList>,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: labels.loadMore }))

    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('더 없으면 아무 것도 내지 않는다', () => {
    render(
      <ProductList density={2} hasMore={false} labels={labels} onLoadMore={vi.fn()} state="ready">
        {rows(2)}
      </ProductList>,
    )

    expect(screen.queryByRole('button', { name: labels.loadMore })).toBeNull()
  })

  it('더 부를 방법을 주지 않으면 자리도 만들지 않는다', () => {
    render(
      <ProductList density={2} hasMore labels={labels} state="ready">
        {rows(2)}
      </ProductList>,
    )

    expect(screen.queryByRole('button', { name: labels.loadMore })).toBeNull()
  })
})
