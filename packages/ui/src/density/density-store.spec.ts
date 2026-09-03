import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_DENSITY, DENSITY_ATTRIBUTE, DENSITY_STORAGE_KEY } from './density'
import {
  applyDensityAttribute,
  getDensitySnapshot,
  readStoredDensity,
  setDensity,
  subscribeToDensity,
  writeStoredDensity,
} from './density-store'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute(DENSITY_ATTRIBUTE)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readStoredDensity', () => {
  it('is null before the visitor has chosen anything', () => {
    expect(readStoredDensity()).toBeNull()
  })

  it('reads back what was written', () => {
    writeStoredDensity(3)
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('3')
    expect(readStoredDensity()).toBe(3)
  })

  it('ignores a value that is not a step', () => {
    // Someone editing devtools, or a key this app never wrote.
    localStorage.setItem(DENSITY_STORAGE_KEY, 'maximal')
    expect(readStoredDensity()).toBeNull()
  })

  it('survives a browser that refuses site data', () => {
    // Safari private mode throws on access rather than returning null.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied')
    })
    expect(readStoredDensity()).toBeNull()
  })
})

describe('writeStoredDensity', () => {
  it('does not take the page down when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota')
    })
    expect(() => {
      writeStoredDensity(1)
    }).not.toThrow()
  })
})

describe('getDensitySnapshot', () => {
  it('falls back to the default when nothing is set anywhere', () => {
    expect(getDensitySnapshot()).toBe(DEFAULT_DENSITY)
  })

  it('reads the attribute the boot script applied', () => {
    applyDensityAttribute(1)
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe('1')
    expect(getDensitySnapshot()).toBe(1)
  })

  it('falls back to storage when no attribute is applied yet', () => {
    writeStoredDensity(3)
    expect(getDensitySnapshot()).toBe(3)
  })

  it('lets the attribute win over storage', () => {
    // A nested `data-density` panel is a legitimate override, and the boot
    // script has already reconciled account preference against localStorage.
    writeStoredDensity(3)
    applyDensityAttribute(1)
    expect(getDensitySnapshot()).toBe(1)
  })

  it('ignores an attribute that is not a step', () => {
    document.documentElement.setAttribute(DENSITY_ATTRIBUTE, '9')
    writeStoredDensity(1)
    expect(getDensitySnapshot()).toBe(1)
  })
})

describe('setDensity', () => {
  it('applies, persists and notifies', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToDensity(listener)

    setDensity(3)

    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe('3')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('3')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('has already applied the attribute by the time a listener runs', () => {
    // A subscriber that read a stale attribute would render one density while
    // the stylesheet paints another.
    const seen: (string | null)[] = []
    const unsubscribe = subscribeToDensity(() => {
      seen.push(document.documentElement.getAttribute(DENSITY_ATTRIBUTE))
    })

    setDensity(1)
    unsubscribe()

    expect(seen).toEqual(['1'])
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    subscribeToDensity(listener)()

    setDensity(1)

    expect(listener).not.toHaveBeenCalled()
  })
})
