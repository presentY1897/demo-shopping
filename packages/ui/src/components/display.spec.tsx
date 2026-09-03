/**
 * Badge, Tag, Avatar and Divider.
 *
 * Three of the four are static, so there is little to *do* to them — the
 * assertions are about what a screen reader receives: a separator with an
 * orientation, an avatar that still identifies someone when its image fails, a
 * removable tag whose remove control has a name. The one interactive part, the
 * remove button, is exercised with the pointer and the keyboard.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Avatar } from './avatar'
import { Badge } from './badge'
import { Divider } from './divider'
import { Tag } from './tag'

describe('Badge', () => {
  it('renders its text', () => {
    render(<Badge variant="success">배송완료</Badge>)

    expect(screen.getByText('배송완료')).toBeVisible()
  })
})

describe('Tag', () => {
  it('removes on click', async () => {
    const user = setupUser()
    const onRemove = vi.fn()
    render(
      <Tag onRemove={onRemove} removeLabel="Remove the colour filter">
        Colour: black
      </Tag>,
    )

    await user.click(screen.getByRole('button', { name: 'Remove the colour filter' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('removes from the keyboard', async () => {
    const user = setupUser()
    const onRemove = vi.fn()
    render(
      <Tag onRemove={onRemove} removeLabel="Remove the colour filter">
        Colour: black
      </Tag>,
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Remove the colour filter' })).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('has nothing to focus when it is not removable', async () => {
    const user = setupUser()
    render(<Tag>Colour: black</Tag>)

    await user.tab()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })
})

describe('Avatar', () => {
  it('falls back to an initial that still identifies the person', () => {
    // jsdom never loads the image, which is the same state as a broken URL.
    render(<Avatar alt="김민준" src="https://example.test/missing.png" />)

    expect(screen.getByText('김')).toBeVisible()
  })

  it('accepts an explicit fallback', () => {
    render(<Avatar alt="스토어" fallback="ST" />)

    expect(screen.getByText('ST')).toBeVisible()
  })
})

describe('Divider', () => {
  it('reports its orientation', () => {
    render(<Divider orientation="vertical" />)

    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical')
  })

  it('is hidden from assistive technology when decorative', () => {
    render(<Divider decorative />)

    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('carries its label', () => {
    render(<Divider label="또는" />)

    expect(screen.getByRole('separator')).toHaveTextContent('또는')
  })
})
