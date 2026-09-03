/**
 * Test environment for this app.
 *
 * Everything of substance is in `@shopping/api-mocks`: the mock API, the
 * handlers, the "no unhandled request" rule and the outbound socket guard all
 * arrive with one call, so adding an endpoint never touches an app.
 *
 * The rest is the handful of browser APIs jsdom does not implement. The header
 * renders Radix overlays — a tooltip on each density step, a popover on a phone,
 * the menu sheet — and every one of them reaches for a geometry API before a
 * single assertion runs. `matchMedia` is deliberately *not* filled in here: the
 * viewport is what the header branches on, so a spec states it explicitly with
 * `test/support/viewport.ts` rather than inheriting a global default.
 */

import '@testing-library/jest-dom/vitest'

import { setupTestServer } from '@shopping/api-mocks/node'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/** Specs import this to override a handler for one test (`server.use(...)`). */
export const testServer = setupTestServer()

// React Testing Library only auto-cleans when vitest runs with globals, which
// these apps deliberately do not.
afterEach(() => {
  cleanup()
})

function polyfill(target: object, name: string, value: unknown): void {
  if (name in target) return
  Object.defineProperty(target, name, { configurable: true, value, writable: true })
}

/** Floating UI observes the trigger and the panel to reposition on resize. */
class ResizeObserverStub {
  readonly observe = (): void => undefined
  readonly unobserve = (): void => undefined
  readonly disconnect = (): void => undefined
}
polyfill(globalThis, 'ResizeObserver', ResizeObserverStub)

/** Radix checks pointer capture before treating a press as a drag. */
polyfill(Element.prototype, 'hasPointerCapture', (): boolean => false)
polyfill(Element.prototype, 'setPointerCapture', (): void => undefined)
polyfill(Element.prototype, 'releasePointerCapture', (): void => undefined)
polyfill(Element.prototype, 'scrollIntoView', (): void => undefined)
