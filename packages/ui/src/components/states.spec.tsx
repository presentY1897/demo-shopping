/**
 * `EmptyState`, `ErrorState` and `Skeleton` — the three states a list can be in
 * that are not "here are your rows".
 *
 * The interesting assertions are about *announcement*, not appearance: the
 * failure this trio exists to prevent is a screen that changed without telling
 * anyone who is not looking at it.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'
import { EmptyState } from './empty-state'
import { ErrorState } from './error-state'
import { Skeleton } from './skeleton'

describe('EmptyState', () => {
  it('announces itself politely', () => {
    // A list becomes empty because the user filtered it. Silence reads as "the
    // page did not respond".
    render(<EmptyState title="No results" />)

    expect(screen.getByRole('status')).toHaveTextContent('No results')
  })

  it('runs the action it was given', async () => {
    const user = setupUser()
    const onClear = vi.fn()

    render(
      <EmptyState
        action={<Button onClick={onClear}>Clear filters</Button>}
        description="Try a different keyword."
        title="No results"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe('ErrorState', () => {
  it('announces itself assertively', () => {
    render(<ErrorState title="Could not load orders" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load orders')
  })

  it('retries from the keyboard', async () => {
    const user = setupUser()
    const onRetry = vi.fn()

    render(<ErrorState onRetry={onRetry} retryLabel="Try again" title="Could not load orders" />)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows a technical detail alongside the human sentence', () => {
    render(
      <ErrorState
        description="Please try again in a moment."
        detail="req_01H9Z"
        title="Could not load orders"
      />,
    )

    expect(screen.getByText('req_01H9Z')).toBeVisible()
    expect(screen.getByText('Please try again in a moment.')).toBeVisible()
  })

  it('has no retry button when no handler was given', () => {
    render(<ErrorState title="Could not load orders" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('Skeleton', () => {
  it('is hidden from assistive technology', () => {
    // Three grey rectangles are not information. The announcement is the label.
    const { container } = render(<Skeleton lines={3} />)

    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('announces the wait when given a label', () => {
    render(<Skeleton label="Loading orders" lines={3} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading orders')
  })

  it('draws the number of rows it was asked for', () => {
    const { container } = render(<Skeleton lines={4} />)

    expect(container.querySelectorAll('[data-shape="text"] > span')).toHaveLength(4)
  })

  it('draws one box for a shape that is not text', () => {
    const { container } = render(<Skeleton lines={4} shape="circle" />)

    expect(container.querySelectorAll('[data-shape="circle"] > span')).toHaveLength(1)
  })

  it('never draws fewer than one row', () => {
    const { container } = render(<Skeleton lines={0} />)

    expect(container.querySelectorAll('[data-shape="text"] > span')).toHaveLength(1)
  })
})
