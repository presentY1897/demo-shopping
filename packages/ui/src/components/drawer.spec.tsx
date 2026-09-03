/**
 * The drawer is the same Radix Dialog as `Modal`, so the trap is re-verified
 * rather than assumed: the two components style the primitive differently, and a
 * styling change is exactly the kind of edit that could accidentally move the
 * content outside the focus scope.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'
import { Drawer } from './drawer'
import { DRAWER_SIDES, type DrawerSide } from './drawer'
import { Input } from './input'

function FilterDrawer({ side = 'right' }: { readonly side?: DrawerSide }) {
  return (
    <>
      <Button>Outside</Button>
      <Drawer
        closeLabel="Close"
        description="Narrow the product list."
        side={side}
        title="Filters"
        trigger={<Button>Open filters</Button>}
      >
        <Input aria-label="Keyword" />
        <Button>Apply</Button>
      </Drawer>
    </>
  )
}

describe('Drawer', () => {
  it.each(DRAWER_SIDES)('opens from every side (%s) with the same behaviour', async (side) => {
    const user = setupUser()
    render(<FilterDrawer side={side} />)

    await user.click(screen.getByRole('button', { name: 'Open filters' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Filters')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('keeps Tab inside the panel', async () => {
    const user = setupUser()
    render(<FilterDrawer />)

    await user.click(screen.getByRole('button', { name: 'Open filters' }))
    const dialog = screen.getByRole('dialog')

    for (let press = 0; press < 9; press += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = setupUser()
    render(<FilterDrawer />)

    await user.click(screen.getByRole('button', { name: 'Open filters' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open filters' })).toHaveFocus()
  })

  it('closes from the × button', async () => {
    const user = setupUser()
    render(<FilterDrawer />)

    await user.click(screen.getByRole('button', { name: 'Open filters' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
