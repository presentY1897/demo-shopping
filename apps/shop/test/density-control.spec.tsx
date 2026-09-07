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
import { DENSITY_HINT_ATTRIBUTE, DENSITY_HINT_KEY, densityHintBootScript } from '@/lib/density-hint'
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
  // 안내가 보이는지는 이제 `<html>` 의 표시가 정한다 — 문서는 스펙 사이에
  // 살아남으므로 지우지 않으면 한 스펙의 결정이 다음으로 새어 간다.
  document.documentElement.removeAttribute(DENSITY_HINT_ATTRIBUTE)
})

afterEach(() => {
  localStorage.clear()
})

/**
 * 안내가 **보이는가**는 `<html>` 의 표시가 답한다 (TASK-0097 F1).
 *
 * 상자는 늘 그려져 있고 감추는 것은 CSS 다 — 그래야 첫 페인트 전에 결정되고, 이
 * 문단이 「가장 큰 것이 그려진 시각」을 4초까지 끌고 가지 않는다. jsdom 에는
 * 스타일시트가 없으므로 **그 값을 직접 묻는다.**
 */
function hintShown(): boolean {
  return document.documentElement.getAttribute(DENSITY_HINT_ATTRIBUTE) === 'owed'
}

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

    expect(await screen.findByText(density.hintTitle)).toBeInTheDocument()
    await waitFor(() => {
      expect(hintShown()).toBe(true)
    })
  })

  it('goes away by itself once a step is chosen', async () => {
    renderControl(VIEWPORTS.desktop)
    await waitFor(() => {
      expect(hintShown()).toBe(true)
    })

    await userEvent.click(screen.getByRole('radio', { name: density.names[3] }))

    await waitFor(() => {
      expect(hintShown()).toBe(false)
    })
  })

  it('stays away once dismissed', async () => {
    const view = renderControl(VIEWPORTS.desktop)
    await waitFor(() => {
      expect(hintShown()).toBe(true)
    })

    await userEvent.click(screen.getByRole('button', { name: density.hintDismiss }))

    expect(hintShown()).toBe(false)
    expect(localStorage.getItem(DENSITY_HINT_KEY)).not.toBeNull()

    view.unmount()
    renderControl(VIEWPORTS.desktop)

    await waitFor(() => {
      expect(hintShown()).toBe(false)
    })
  })

  it('is not shown to a visitor who already has a step stored', async () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, '1')
    renderControl(VIEWPORTS.desktop)

    await waitFor(() => {
      expect(hintShown()).toBe(false)
    })
  })
})

/**
 * 첫 페인트 전에 도는 스크립트 (TASK-0097 F1).
 *
 * 눈으로 검토하는 대신 **실행해 본다** — `density-script.spec.ts` 가 같은 이유로
 * 같은 모양이다.
 */
describe('밀도 안내 부트 스크립트', () => {
  function run(): void {
    // 문자열로 내보낸 원문을 그대로 실행해 본다 — 눈으로 읽는 대신.
    ;(0, eval)(densityHintBootScript())
  }

  it('marks the hint owed on a first visit', () => {
    run()

    expect(hintShown()).toBe(true)
  })

  it('leaves it alone once a step has been chosen', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, '1')

    run()

    expect(hintShown()).toBe(false)
  })

  it('leaves it alone once it has been dismissed', () => {
    localStorage.setItem(DENSITY_HINT_KEY, 'seen')

    run()

    expect(hintShown()).toBe(false)
  })
})
