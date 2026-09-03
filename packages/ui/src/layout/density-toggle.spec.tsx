/**
 * The toggle, driven the way a shopper drives it.
 *
 * Two things are being checked and they are different: that a click reaches the
 * store (and therefore `<html data-density>` and localStorage, which is what
 * makes the choice survive a reload), and that the keyboard can do the same
 * thing without a mouse — QUALITY-GATES U5, and the reason this is a radio group
 * rather than three buttons.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_DENSITY, DENSITY_ATTRIBUTE, DENSITY_STORAGE_KEY } from '../density/density'
import { DensityProvider } from '../density/density-context'
import { DensityToggle } from './density-toggle'

const LABELS = { 1: 'minimal', 2: 'standard', 3: 'maximal' } as const
const LEGEND = 'display density'

function renderToggle(showLabels = false) {
  return render(
    <DensityProvider>
      <DensityToggle labels={LABELS} legend={LEGEND} showLabels={showLabels} />
    </DensityProvider>,
  )
}

function appliedDensity(): string | null {
  return document.documentElement.getAttribute(DENSITY_ATTRIBUTE)
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(DEFAULT_DENSITY))
})

afterEach(cleanup)

describe('DensityToggle', () => {
  it('offers one option per step, named by the app catalog', () => {
    renderToggle()

    expect(screen.getByRole('radiogroup', { name: LEGEND })).toBeVisible()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: LABELS[3] })).toBeVisible()
  })

  it('marks the current step as the checked option', () => {
    renderToggle()

    expect(screen.getByRole('radio', { name: LABELS[2] })).toBeChecked()
    expect(screen.getByRole('radio', { name: LABELS[1] })).not.toBeChecked()
  })

  it('applies a pick to the document and to storage', async () => {
    renderToggle()

    await userEvent.click(screen.getByRole('radio', { name: LABELS[3] }))

    expect(appliedDensity()).toBe('3')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('3')
    expect(screen.getByRole('radio', { name: LABELS[3] })).toBeChecked()
  })

  it('is one tab stop, and the arrow keys move between the steps', async () => {
    renderToggle()

    await userEvent.tab()

    expect(screen.getByRole('radio', { name: LABELS[2] })).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')

    expect(screen.getByRole('radio', { name: LABELS[3] })).toHaveFocus()

    // Space commits the focused step, and so does the arrow itself — the
    // component selects whatever the arrow focused, because that is the
    // WAI-ARIA radio pattern. That half needs `:focus-visible`, which jsdom
    // does not implement, so it is verified in Chromium instead
    // (TASK-0018 6.1 F4): 표준 → ArrowRight → 맥시멀, `data-density="3"`.
    await userEvent.keyboard(' ')

    expect(appliedDensity()).toBe('3')

    await userEvent.tab()

    expect(screen.queryAllByRole('radio').some((radio) => radio === document.activeElement)).toBe(
      false,
    )
  })

  it('shows the words when asked, and keeps them as the accessible name', () => {
    renderToggle(true)

    expect(screen.getByText(LABELS[1])).toBeVisible()
    expect(screen.getByRole('radio', { name: LABELS[1] })).toBeVisible()
  })
})
