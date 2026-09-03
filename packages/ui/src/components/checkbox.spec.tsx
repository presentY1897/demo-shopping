/**
 * Checkbox behaviour: the box toggles, the label toggles it too, and Space works
 * — the three things a user actually does with one.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Checkbox } from './checkbox'

describe('Checkbox', () => {
  it('toggles when clicked', async () => {
    const user = setupUser()
    const onCheckedChange = vi.fn()
    render(<Checkbox label="Agree to the terms" onCheckedChange={onCheckedChange} />)

    const box = screen.getByRole('checkbox', { name: 'Agree to the terms' })
    expect(box).not.toBeChecked()

    await user.click(box)

    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(box).toBeChecked()
  })

  it('toggles from the keyboard with Space', async () => {
    const user = setupUser()
    render(<Checkbox label="Agree to the terms" />)

    await user.tab()
    const box = screen.getByRole('checkbox', { name: 'Agree to the terms' })
    expect(box).toHaveFocus()

    await user.keyboard(' ')
    expect(box).toBeChecked()

    await user.keyboard(' ')
    expect(box).not.toBeChecked()
  })

  it('toggles when the label text is clicked', async () => {
    const user = setupUser()
    render(<Checkbox label="Agree to the terms" />)

    await user.click(screen.getByText('Agree to the terms'))

    expect(screen.getByRole('checkbox', { name: 'Agree to the terms' })).toBeChecked()
  })

  it('reports the indeterminate state to assistive technology', () => {
    render(<Checkbox checked="indeterminate" label="Select all" />)

    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )
  })

  it('cannot be toggled when disabled', async () => {
    const user = setupUser()
    const onCheckedChange = vi.fn()
    render(<Checkbox disabled label="Agree to the terms" onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByRole('checkbox', { name: 'Agree to the terms' }))

    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
