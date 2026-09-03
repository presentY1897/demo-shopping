/**
 * Test environment for the component specs.
 *
 * Two jobs: register the DOM matchers, and fill the handful of browser APIs
 * jsdom does not implement. The gaps are not incidental — Radix reaches for
 * every one of them, and without the stubs a `Select` or a `Popover` throws
 * before a single assertion runs.
 *
 * Each stub is the smallest thing that keeps the component's *behaviour*
 * observable. jsdom performs no layout, so a `ResizeObserver` that never fires
 * and a `DOMRect` of zeros are honest: the specs here assert what happens when
 * keys are pressed and buttons are clicked, and the geometry is verified against
 * the real stylesheet in `test/control-size.spec.ts` instead.
 */

import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// React Testing Library only auto-cleans when Vitest runs with globals, which
// this package deliberately does not.
afterEach(() => {
  cleanup()
})

function polyfill(target: object, name: string, value: unknown): void {
  if (name in target) return
  Object.defineProperty(target, name, { configurable: true, value, writable: true })
}

/** Radix's Select scrolls the highlighted option into view as focus moves. */
polyfill(Element.prototype, 'scrollIntoView', (): void => undefined)

/** Radix's Select and Slider check pointer capture before treating a drag as one. */
polyfill(Element.prototype, 'hasPointerCapture', (): boolean => false)
polyfill(Element.prototype, 'setPointerCapture', (): void => undefined)
polyfill(Element.prototype, 'releasePointerCapture', (): void => undefined)

/** Floating UI observes the trigger and the popup to reposition on resize. */
class ResizeObserverStub {
  readonly observe = (): void => undefined
  readonly unobserve = (): void => undefined
  readonly disconnect = (): void => undefined
}
polyfill(globalThis, 'ResizeObserver', ResizeObserverStub)

/** `react-remove-scroll` asks whether the pointer is coarse before locking. */
polyfill(globalThis, 'matchMedia', (query: string) => ({
  addEventListener: (): void => undefined,
  addListener: (): void => undefined,
  dispatchEvent: (): boolean => false,
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: (): void => undefined,
  removeListener: (): void => undefined,
}))
