/**
 * A link is a link: the platform gives it Tab and Enter, and these tests confirm
 * the component did not take that away — plus the one thing it adds, which is
 * the `rel` that has to travel with `target="_blank"`.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Link } from './link'

describe('Link', () => {
  it('is reachable by Tab and activates on Enter', async () => {
    const user = setupUser()
    const onClick = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault()
    })

    render(
      <Link href="/orders" onClick={onClick}>
        Orders
      </Link>,
    )

    await user.tab()
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('never opens a new tab without noopener', () => {
    render(
      <Link external externalLabel="(new window)" href="https://example.test">
        Docs
      </Link>,
    )

    const link = screen.getByRole('link', { name: /Docs/ })
    expect(link).toHaveAccessibleName(expect.stringContaining('new window'))
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('leaves an internal link alone', () => {
    render(<Link href="/orders">Orders</Link>)

    const link = screen.getByRole('link', { name: 'Orders' })
    expect(link).not.toHaveAttribute('target')
  })
})
