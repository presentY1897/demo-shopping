/**
 * Tabs are checked from the keyboard because that is where the pattern is
 * either right or wrong: one Tab stop for the list, arrows between tabs, and the
 * panel actually changing.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Tabs } from './tabs'

const ITEMS = [
  { content: 'Two pairs of trousers', label: 'Items', value: 'items' },
  { content: 'Courier pending', label: 'Shipping', value: 'shipping' },
  { content: 'Paid by card', label: 'Payment', value: 'payment' },
]

describe('Tabs', () => {
  it('shows the first panel and hides the others', () => {
    render(<Tabs aria-label="Order" items={ITEMS} />)

    expect(screen.getByText('Two pairs of trousers')).toBeVisible()
    expect(screen.queryByText('Courier pending')).not.toBeInTheDocument()
  })

  it('switches panels with the arrow keys', async () => {
    const user = setupUser()
    render(<Tabs aria-label="Order" items={ITEMS} />)

    await user.tab()
    expect(screen.getByRole('tab', { name: 'Items' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Shipping' })).toHaveFocus()
    expect(screen.getByText('Courier pending')).toBeVisible()
    expect(screen.queryByText('Two pairs of trousers')).not.toBeInTheDocument()
  })

  it('switches panels on click', async () => {
    const user = setupUser()
    render(<Tabs aria-label="Order" items={ITEMS} />)

    await user.click(screen.getByRole('tab', { name: 'Payment' }))

    expect(screen.getByText('Paid by card')).toBeVisible()
  })

  it('waits for Enter when activation is manual', async () => {
    const user = setupUser()
    render(<Tabs activationMode="manual" aria-label="Order" items={ITEMS} />)

    await user.tab()
    await user.keyboard('{ArrowRight}')

    // Focus moved but the panel did not — the point of manual activation.
    expect(screen.getByRole('tab', { name: 'Shipping' })).toHaveFocus()
    expect(screen.getByText('Two pairs of trousers')).toBeVisible()

    await user.keyboard('{Enter}')

    expect(screen.getByText('Courier pending')).toBeVisible()
  })

  it('is one tab stop, so Tab moves into the panel rather than to the next tab', async () => {
    const user = setupUser()
    render(<Tabs aria-label="Order" items={ITEMS} />)

    await user.tab()
    expect(screen.getByRole('tab', { name: 'Items' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('tab', { name: 'Shipping' })).not.toHaveFocus()
  })

  it('skips a disabled tab', async () => {
    const user = setupUser()
    render(
      <Tabs
        aria-label="Order"
        items={[
          { content: 'Two pairs of trousers', label: 'Items', value: 'items' },
          { content: 'Courier pending', disabled: true, label: 'Shipping', value: 'shipping' },
          { content: 'Paid by card', label: 'Payment', value: 'payment' },
        ]}
      />,
    )

    await user.tab()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Payment' })).toHaveFocus()
  })
})
