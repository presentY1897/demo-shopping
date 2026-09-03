/**
 * QUALITY-GATES U1 — the four states, exercised by switching between them.
 *
 * The assertion that matters is the *exclusive* one: a list showing skeletons
 * must not also be showing "결과가 없습니다", and a list that failed must not be
 * showing an empty state. Those two mix-ups are the reason this component exists
 * (TASK-0016 4장) and neither is visible from a screenshot of one state.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DataList, DATA_LIST_STATES, type DataListState } from './data-list'

const SLOTS = {
  empty: <p>No orders yet</p>,
  error: <p>Could not load orders</p>,
  loading: <p>Loading orders</p>,
}

function renderAt(state: DataListState) {
  return render(
    <DataList state={state} {...SLOTS}>
      <p>Order 20260903-0001</p>
    </DataList>,
  )
}

const CONTENT: Readonly<Record<DataListState, string>> = {
  loading: 'Loading orders',
  empty: 'No orders yet',
  error: 'Could not load orders',
  ready: 'Order 20260903-0001',
}

describe.each(DATA_LIST_STATES)('in the %s state', (state) => {
  it('shows only that state', () => {
    renderAt(state)

    expect(screen.getByText(CONTENT[state])).toBeVisible()

    for (const other of DATA_LIST_STATES) {
      if (other === state) continue
      expect(screen.queryByText(CONTENT[other])).not.toBeInTheDocument()
    }
  })
})

describe('DataList', () => {
  it('marks itself busy only while loading', () => {
    const { rerender } = renderAt('loading')
    const region = screen.getByText('Loading orders').parentElement

    expect(region).toHaveAttribute('aria-busy', 'true')

    rerender(
      <DataList state="ready" {...SLOTS}>
        <p>Order 20260903-0001</p>
      </DataList>,
    )

    expect(screen.getByText('Order 20260903-0001').parentElement).not.toHaveAttribute('aria-busy')
  })

  it('moves from loading to a real list without passing through the empty state', () => {
    const { rerender } = renderAt('loading')

    rerender(
      <DataList state="ready" {...SLOTS}>
        <p>Order 20260903-0001</p>
      </DataList>,
    )

    expect(screen.getByText('Order 20260903-0001')).toBeVisible()
    expect(screen.queryByText('No orders yet')).not.toBeInTheDocument()
  })
})
