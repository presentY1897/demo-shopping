/**
 * A tooltip that only appears on hover is a tooltip half the users never see, so
 * the test that matters is the keyboard one: Tab to the trigger, the hint
 * appears; Escape, it goes away.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'
import { Tooltip } from './tooltip'

describe('Tooltip', () => {
  it('appears on keyboard focus and hides on Escape', async () => {
    const user = setupUser()
    render(
      <Tooltip content="Applies to this order only">
        <Button>Discount</Button>
      </Tooltip>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: /Discount/ })).toHaveFocus()

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Applies to this order only')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('describes its trigger rather than renaming it', async () => {
    const user = setupUser()
    render(
      <Tooltip content="Applies to this order only">
        <Button>Discount</Button>
      </Tooltip>,
    )

    await user.tab()
    await screen.findByRole('tooltip')

    // The trigger keeps its own label; the hint is supplementary. A tooltip that
    // replaced the name would leave the button unlabelled the moment it closes.
    expect(screen.getByRole('button', { name: /Discount/ })).toHaveAccessibleDescription(
      'Applies to this order only',
    )
  })

  it('hides again when focus moves on', async () => {
    const user = setupUser()
    render(
      <>
        <Tooltip content="Applies to this order only">
          <Button>Discount</Button>
        </Tooltip>
        <Button>Next</Button>
      </>,
    )

    await user.tab()
    await screen.findByRole('tooltip')

    await user.tab()

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
