import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_STORAGE_KEY,
  type DensityLevel,
} from './density'
import { densityBootScript } from './density-script'

/**
 * Runs the generated source the way the browser will: as a `<script>` in the
 * document, not through `eval`. The point of the script is what it does to
 * `<html>` before the first paint, so anything less than executing it is a test
 * of a string.
 */
function boot(serverDensity: DensityLevel | null = null): void {
  const element = document.createElement('script')
  element.textContent = densityBootScript(serverDensity)
  document.head.append(element)
  element.remove()
}

beforeEach(() => {
  localStorage.clear()
  // The server always renders the default; the script's job is to correct it.
  document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(DEFAULT_DENSITY))
  vi.restoreAllMocks()
})

describe('densityBootScript', () => {
  it('leaves the default in place for a first-time visitor', () => {
    boot()
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe(String(DEFAULT_DENSITY))
  })

  it('restores the stored choice before the first paint', () => {
    // This is the reload requirement (TASK-0014 F3): the server sent 2, this
    // visitor picked 3 last time, and the correction happens without React.
    localStorage.setItem(DENSITY_STORAGE_KEY, '3')
    boot()
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe('3')
  })

  it.each(['0', '4', 'maximal', ''])('falls back to the default for a stored %o', (stored) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, stored)
    boot()
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe(String(DEFAULT_DENSITY))
  })

  it('lets the account preference beat the device', () => {
    // A signed-in shopper's `UserPreference` is the source of truth (M04 seam).
    localStorage.setItem(DENSITY_STORAGE_KEY, '3')
    boot(1)
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe('1')
  })

  it('mirrors the account preference into the device', () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, '3')
    boot(1)
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('1')
  })

  it('still applies a density when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied')
    })
    boot()
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe(String(DEFAULT_DENSITY))
  })

  it('carries no interpolated text that could close the script tag', () => {
    expect(densityBootScript(3)).not.toContain('</')
  })
})
