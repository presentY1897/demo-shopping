/**
 * The point of `IconButton` is that it always has an accessible name, so that is
 * what the queries here rely on: every lookup goes through the label rather than
 * through a test id, and a component that stopped applying it would fail every
 * test in the file rather than one assertion in one of them.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { CloseIcon } from './icons'
import { IconButton } from './icon-button'

describe('IconButton', () => {
  it('is found and activated by its label alone', async () => {
    const user = setupUser()
    const onClick = vi.fn()

    render(
      <IconButton label="Close panel" onClick={onClick}>
        <CloseIcon />
      </IconButton>,
    )

    await user.click(screen.getByRole('button', { name: 'Close panel' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is reachable by Tab and fires on Enter', async () => {
    const user = setupUser()
    const onClick = vi.fn()

    render(
      <IconButton label="Close panel" onClick={onClick}>
        <CloseIcon />
      </IconButton>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('hides the glyph from assistive technology', () => {
    render(
      <IconButton label="Close panel">
        <CloseIcon />
      </IconButton>,
    )

    // The name must come from `label` only; an icon that also announced itself
    // would be read twice.
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveAccessibleName('Close panel')
  })

  it('blocks activation while loading', async () => {
    const user = setupUser()
    const onClick = vi.fn()

    render(
      <IconButton label="Close panel" loading onClick={onClick}>
        <CloseIcon />
      </IconButton>,
    )

    await user.click(screen.getByRole('button', { name: 'Close panel' }))

    expect(onClick).not.toHaveBeenCalled()
  })
})
