/**
 * The select is driven entirely from the keyboard here, which is the case that
 * matters: a listbox that only works with a mouse is the failure mode a
 * hand-rolled dropdown ships with, and the reason this component is built on
 * Radix at all.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Select } from './select'

const CATEGORIES = [
  { label: 'Outerwear', value: 'outerwear' },
  { label: 'Knitwear', value: 'knitwear' },
  { label: 'Shoes', value: 'shoes' },
] as const

describe('Select', () => {
  it('opens, moves and commits without a pointer', async () => {
    const user = setupUser()
    const onValueChange = vi.fn()

    render(
      <Select
        aria-label="Category"
        onValueChange={onValueChange}
        options={CATEGORIES}
        placeholder="Choose"
      />,
    )

    await user.tab()
    const trigger = screen.getByRole('combobox', { name: 'Category' })
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(onValueChange).toHaveBeenCalledWith('knitwear')
    expect(trigger).toHaveTextContent('Knitwear')
  })

  it('closes on Escape and leaves the value alone', async () => {
    const user = setupUser()
    const onValueChange = vi.fn()

    render(
      <Select
        aria-label="Category"
        defaultValue="outerwear"
        onValueChange={onValueChange}
        options={CATEGORIES}
      />,
    )

    await user.tab()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveFocus()
  })

  it('shows the placeholder until something is chosen', () => {
    render(<Select aria-label="Category" options={CATEGORIES} placeholder="Choose" />)

    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Choose')
  })

  it('cannot be opened when disabled', async () => {
    const user = setupUser()
    render(<Select aria-label="Category" disabled options={CATEGORIES} placeholder="Choose" />)

    await user.click(screen.getByRole('combobox', { name: 'Category' }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
