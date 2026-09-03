/**
 * The density control, which is the feature this whole storefront is arranged
 * around (DECISIONS 1장: 상품 표현 3단계를 사용자가 토글).
 *
 * Three things are checked and they are the three that make it worth having: it
 * is reachable on a phone, a pick reaches the document and localStorage — which
 * is what makes it survive a reload — and the first-visit explanation appears
 * once and then never again.
 */

import { DEFAULT_DENSITY, DENSITY_ATTRIBUTE, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DensityControl } from '@/components/layout/density-control'
import { DENSITY_HINT_KEY } from '@/lib/density-hint'
import { messagesFor } from '@/messages'

import { stubViewport, VIEWPORTS } from './support/viewport'

const density = messagesFor().layout.density

function renderControl(width: number) {
  stubViewport(width)

  return render(
    <DensityProvider>
      <DensityControl messages={density} />
    </DensityProvider>,
  )
}

function applied(): string | null {
  return document.documentElement.getAttribute(DENSITY_ATTRIBUTE)
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(DEFAULT_DENSITY))
})

afterEach(() => {
  localStorage.clear()
})

describe('on a phone', () => {
  it('opens the three steps from one button, with their names visible', async () => {
    renderControl(VIEWPORTS.mobile)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(density.names[2]) }))

    expect(await screen.findByRole('radiogroup', { name: density.legend })).toBeVisible()
    expect(screen.getByText(density.names[1])).toBeVisible()
    expect(screen.getByText(density.names[3])).toBeVisible()
  })

  it('applies the pick and remembers it', async () => {
    renderControl(VIEWPORTS.mobile)

    await userEvent.click(screen.getByRole('button', { name: new RegExp(density.names[2]) }))
    await userEvent.click(await screen.findByRole('radio', { name: density.names[3] }))

    expect(applied()).toBe('3')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('3')
  })
})

describe('on a desktop', () => {
  it('applies the pick straight from the header', async () => {
    renderControl(VIEWPORTS.desktop)

    await userEvent.click(screen.getByRole('radio', { name: density.names[1] }))

    expect(applied()).toBe('1')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('1')
  })
})

/** TASK-0018 R1 — the control is only a differentiator if it is noticed. */
describe('the first-visit hint', () => {
  it('is shown to a visitor who has never chosen a step', async () => {
    renderControl(VIEWPORTS.desktop)

    expect(await screen.findByText(density.hintTitle)).toBeVisible()
  })

  it('goes away by itself once a step is chosen', async () => {
    renderControl(VIEWPORTS.desktop)
    await screen.findByText(density.hintTitle)

    await userEvent.click(screen.getByRole('radio', { name: density.names[3] }))

    await waitFor(() => {
      expect(screen.queryByText(density.hintTitle)).toBeNull()
    })
  })

  it('stays away once dismissed', async () => {
    const view = renderControl(VIEWPORTS.desktop)
    await screen.findByText(density.hintTitle)

    await userEvent.click(screen.getByRole('button', { name: density.hintDismiss }))

    expect(screen.queryByText(density.hintTitle)).toBeNull()
    expect(localStorage.getItem(DENSITY_HINT_KEY)).not.toBeNull()

    view.unmount()
    renderControl(VIEWPORTS.desktop)

    expect(screen.queryByText(density.hintTitle)).toBeNull()
  })

  it('is not shown to a visitor who already has a step stored', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, '1')
    renderControl(VIEWPORTS.desktop)

    expect(screen.queryByText(density.hintTitle)).toBeNull()
  })
})
