/**
 * The accordion's contract is that each header is a real button: it reports
 * `aria-expanded`, Enter and Space toggle it, and the arrow keys walk between
 * headers.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Accordion } from './accordion'

const SECTIONS = [
  { content: 'Free over 50,000 KRW', title: 'Shipping', value: 'shipping' },
  { content: 'Within 7 days of delivery', title: 'Returns', value: 'returns' },
  { content: 'Weekdays 10:00–18:00', title: 'Support', value: 'support' },
]

describe('Accordion', () => {
  it('opens a section on Enter and reports the state', async () => {
    const user = setupUser()
    render(<Accordion items={SECTIONS} type="single" />)

    const header = screen.getByRole('button', { name: 'Shipping' })
    expect(header).toHaveAttribute('aria-expanded', 'false')

    await user.tab()
    expect(header).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Free over 50,000 KRW')).toBeVisible()
  })

  it('closes again on Space when collapsible', async () => {
    const user = setupUser()
    render(<Accordion collapsible items={SECTIONS} type="single" />)

    const header = screen.getByRole('button', { name: 'Shipping' })
    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard(' ')

    expect(header).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps only one section open in single mode', async () => {
    const user = setupUser()
    render(<Accordion items={SECTIONS} type="single" />)

    await user.click(screen.getByRole('button', { name: 'Shipping' }))
    await user.click(screen.getByRole('button', { name: 'Returns' }))

    expect(screen.getByRole('button', { name: 'Shipping' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Returns' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps several open in multiple mode', async () => {
    const user = setupUser()
    render(<Accordion items={SECTIONS} type="multiple" />)

    await user.click(screen.getByRole('button', { name: 'Shipping' }))
    await user.click(screen.getByRole('button', { name: 'Returns' }))

    expect(screen.getByText('Free over 50,000 KRW')).toBeVisible()
    expect(screen.getByText('Within 7 days of delivery')).toBeVisible()
  })

  it('walks between headers with the arrow keys', async () => {
    const user = setupUser()
    render(<Accordion items={SECTIONS} type="single" />)

    await user.tab()
    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('button', { name: 'Returns' })).toHaveFocus()
  })
})
