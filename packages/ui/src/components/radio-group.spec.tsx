/**
 * The radio group's whole reason for existing is the roving tab index: one Tab
 * stop for the group, arrow keys inside it. Both halves are asserted here,
 * because a group where every radio is its own tab stop looks identical on
 * screen and is wrong.
 *
 * **Selection-follows-focus is verified with Space here, not with the arrow key
 * alone.** Radix checks the newly focused radio from a `focus` handler that
 * reads a flag a *document-level* `keydown` listener sets; in a browser the
 * focus event is queued and runs after the key event has finished bubbling, in
 * jsdom `element.focus()` dispatches synchronously and the flag is still false.
 * The behaviour is real and was confirmed in Chromium — it is the environment
 * that cannot observe it, so asserting it here would only be asserting jsdom.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Radio, RadioGroup } from './radio-group'
import { Button } from './button'

function ShippingChoices({ onValueChange }: { readonly onValueChange?: (value: string) => void }) {
  return (
    <>
      <Button>Before</Button>
      <RadioGroup aria-label="Shipping" defaultValue="standard" onValueChange={onValueChange}>
        <Radio label="Standard" value="standard" />
        <Radio label="Express" value="express" />
        <Radio label="Pickup" value="pickup" />
      </RadioGroup>
      <Button>After</Button>
    </>
  )
}

describe('RadioGroup', () => {
  it('moves between options with the arrow keys', async () => {
    const user = setupUser()
    render(<ShippingChoices />)

    await user.tab()
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Express' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Pickup' })).toHaveFocus()

    // Wraps, so the arrow keys never dead-end.
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveFocus()
  })

  it('selects the focused option with Space', async () => {
    const user = setupUser()
    const onValueChange = vi.fn()
    render(<ShippingChoices onValueChange={onValueChange} />)

    await user.tab()
    await user.tab()
    await user.keyboard('{ArrowDown}')
    await user.keyboard(' ')

    expect(onValueChange).toHaveBeenCalledWith('express')
    expect(screen.getByRole('radio', { name: 'Express' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Standard' })).not.toBeChecked()
  })

  it('is a single tab stop, so Tab leaves the group rather than walking it', async () => {
    const user = setupUser()
    render(<ShippingChoices />)

    await user.tab()
    await user.tab()
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('selects when an option label is clicked', async () => {
    const user = setupUser()
    render(<ShippingChoices />)

    await user.click(screen.getByText('Pickup'))

    expect(screen.getByRole('radio', { name: 'Pickup' })).toBeChecked()
  })
})
