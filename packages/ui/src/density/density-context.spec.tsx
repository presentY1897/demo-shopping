import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_STORAGE_KEY,
  type DensityLevel,
} from './density'
import { DensityProvider, useDensity } from './density-context'
import { densityBootScript } from './density-script'

/** Stands in for the toggle `apps/shop` gets in TASK-0018. */
function DensityProbe() {
  const { density, setDensity, levels } = useDensity()

  return (
    <div>
      <output>{density}</output>
      {levels.map((level) => (
        <button
          key={level}
          onClick={() => {
            setDensity(level)
          }}
          type="button"
        >
          {`step-${String(level)}`}
        </button>
      ))}
    </div>
  )
}

function shown(): number {
  return Number(screen.getByRole('status').textContent)
}

/** What the browser does before React wakes up. */
function boot(serverDensity: DensityLevel | null = null): void {
  const element = document.createElement('script')
  element.textContent = densityBootScript(serverDensity)
  document.head.append(element)
  element.remove()
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(DEFAULT_DENSITY))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DensityProvider', () => {
  it('starts on the default with nothing stored', () => {
    render(
      <DensityProvider>
        <DensityProbe />
      </DensityProvider>,
    )
    expect(shown()).toBe(DEFAULT_DENSITY)
  })

  it('applies a chosen step to the document and to storage', () => {
    render(
      <DensityProvider>
        <DensityProbe />
      </DensityProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'step-3' }))

    expect(shown()).toBe(3)
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe('3')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('3')
  })

  it('keeps the choice across a reload', () => {
    // The whole path, in order: the visitor picks 3, the tab is thrown away, a
    // fresh document arrives carrying the server's default, the boot script
    // runs, React mounts. (TASK-0014 F3)
    render(
      <DensityProvider>
        <DensityProbe />
      </DensityProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'step-3' }))
    cleanup()

    document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(DEFAULT_DENSITY))
    boot()

    render(
      <DensityProvider>
        <DensityProbe />
      </DensityProvider>,
    )

    expect(shown()).toBe(3)
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe('3')
  })

  it('hands the change to the persistence seam', () => {
    // Where M04 will PATCH /me/preferences.
    const onPersist = vi.fn()
    render(
      <DensityProvider onPersist={onPersist}>
        <DensityProbe />
      </DensityProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'step-1' }))

    expect(onPersist).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('lets an account preference arriving later beat the device', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, '3')
    boot()

    render(
      <DensityProvider serverDensity={1}>
        <DensityProbe />
      </DensityProvider>,
    )

    expect(shown()).toBe(1)
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('1')
  })

  it('hydrates a stored step without a mismatch', () => {
    // The server has no way to know this visitor picked 3, so it renders 2 and
    // the boot script corrects the DOM before React sees it. `useSyncExternalStore`
    // is what makes that legal: React hydrates against the server snapshot and
    // re-renders with the client one, instead of reporting a mismatch.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const markup = renderToString(
      <DensityProvider>
        <DensityProbe />
      </DensityProvider>,
    )
    expect(markup).toContain('>2<')

    const container = document.createElement('div')
    container.innerHTML = markup
    document.body.append(container)

    localStorage.setItem(DENSITY_STORAGE_KEY, '3')
    boot()

    render(
      <DensityProvider>
        <DensityProbe />
      </DensityProvider>,
      { container, hydrate: true },
    )

    expect(shown()).toBe(3)
    expect(errors).not.toHaveBeenCalled()
  })
})

describe('useDensity', () => {
  it('fails loudly outside a provider', () => {
    // A toggle that silently does nothing is far harder to notice.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<DensityProbe />)).toThrow(/DensityProvider/)

    errors.mockRestore()
  })
})
