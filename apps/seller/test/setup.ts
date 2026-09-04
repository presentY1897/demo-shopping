/**
 * Test environment for this app.
 *
 * Everything of substance is in `@shopping/api-mocks`: the mock API, the
 * handlers, the "no unhandled request" rule and the outbound socket guard all
 * arrive with one call, so adding an endpoint never touches an app.
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

/**
 * Browser APIs jsdom does not implement, which Radix reaches for.
 *
 * Floating UI observes the trigger and the panel so a popover can reposition
 * itself; jsdom has no layout and no `ResizeObserver`, so without this the
 * console's top-bar slots throw before a single assertion runs.
 * `packages/ui/test/setup.ts` carries the same stub for the same reason.
 */
function polyfill(target: object, name: string, value: unknown): void {
  if (name in target) return
  Object.defineProperty(target, name, { configurable: true, value, writable: true })
}

class ResizeObserverStub {
  readonly observe = (): void => undefined
  readonly unobserve = (): void => undefined
  readonly disconnect = (): void => undefined
}

polyfill(globalThis, 'ResizeObserver', ResizeObserverStub)
