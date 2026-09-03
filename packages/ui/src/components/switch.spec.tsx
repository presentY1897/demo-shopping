/**
 * A switch reports `role="switch"` and toggles on Space — the two things that
 * separate it from a styled checkbox.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Switch } from './switch'

describe('Switch', () => {
  it('toggles when clicked', async () => {
    const user = setupUser()
    const onCheckedChange = vi.fn()
    render(<Switch label="Order notifications" onCheckedChange={onCheckedChange} />)

    const control = screen.getByRole('switch', { name: 'Order notifications' })
    await user.click(control)

    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(control).toBeChecked()
  })

  it('toggles from the keyboard with Space', async () => {
    const user = setupUser()
    render(<Switch defaultChecked label="Order notifications" />)

    await user.tab()
    const control = screen.getByRole('switch', { name: 'Order notifications' })
    expect(control).toHaveFocus()

    await user.keyboard(' ')

    expect(control).not.toBeChecked()
  })

  it('toggles when the label text is clicked', async () => {
    const user = setupUser()
    render(<Switch label="Order notifications" />)

    await user.click(screen.getByText('Order notifications'))

    expect(screen.getByRole('switch', { name: 'Order notifications' })).toBeChecked()
  })
})
