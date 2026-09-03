/**
 * QUALITY-GATES U4 — every step of the density scale, exercised.
 *
 * The components never mention a density: `--space-unit` feeds Tailwind's
 * spacing multiplier, so `p-4` answers to the step on its own. That is exactly
 * why this file is worth having — a component that *did* branch on the step, or
 * a Radix primitive whose measurement logic disagreed with a nested
 * `data-density` scope, would only show up when the step is actually changed.
 *
 * jsdom applies no stylesheet, so these tests do not claim anything about
 * pixels: they claim that the behaviour is identical at all three steps. The
 * geometry is asserted against the real stylesheet in `test/touch-target.spec.ts`
 * and was measured in a browser besides.
 */

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderAtDensity, resetDensity, setupUser } from '../../test/support/ui'
import { DENSITY_LEVELS } from '../density/density'
import { Button } from './button'
import { Checkbox } from './checkbox'
import { Input } from './input'
import { Modal } from './modal'
import { Select } from './select'
import { Tabs } from './tabs'

afterEach(() => {
  resetDensity()
})

const CATEGORIES = [
  { label: 'Outerwear', value: 'outerwear' },
  { label: 'Knitwear', value: 'knitwear' },
]

describe.each(DENSITY_LEVELS)('at density %i', (density) => {
  it('a button still runs its handler', async () => {
    const user = setupUser()
    const onClick = vi.fn()
    renderAtDensity(density, <Button onClick={onClick}>Save</Button>)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('a field still takes input from the keyboard', async () => {
    const user = setupUser()
    renderAtDensity(density, <Input aria-label="Email" />)

    await user.tab()
    await user.keyboard('buyer@example.test')

    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('buyer@example.test')
  })

  it('a checkbox still toggles with Space', async () => {
    const user = setupUser()
    renderAtDensity(density, <Checkbox label="Agree" />)

    await user.tab()
    await user.keyboard(' ')

    expect(screen.getByRole('checkbox', { name: 'Agree' })).toBeChecked()
  })

  it('a select still opens and commits from the keyboard', async () => {
    const user = setupUser()
    renderAtDensity(
      density,
      <Select aria-label="Category" options={CATEGORIES} placeholder="Choose" />,
    )

    await user.tab()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Knitwear')
  })

  it('tabs still switch with the arrow keys', async () => {
    const user = setupUser()
    renderAtDensity(
      density,
      <Tabs
        aria-label="Order"
        items={[
          { content: 'Items panel', label: 'Items', value: 'items' },
          { content: 'Shipping panel', label: 'Shipping', value: 'shipping' },
        ]}
      />,
    )

    await user.tab()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByText('Shipping panel')).toBeVisible()
  })

  it('a modal still traps focus and closes on Escape', async () => {
    const user = setupUser()
    renderAtDensity(
      density,
      <Modal closeLabel="Close" defaultOpen title="Confirm">
        <Input aria-label="Reason" />
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')

    for (let press = 0; press < 6; press += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
