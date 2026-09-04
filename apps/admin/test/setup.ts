/**
 * Test environment for this app.
 *
 * Everything of substance is in `@shopping/api-mocks`: the mock API, the
 * handlers, the "no unhandled request" rule and the outbound socket guard all
 * arrive with one call, so adding an endpoint never touches an app.
 */

import '@testing-library/jest-dom/vitest'

import { setupTestServer } from '@shopping/api-mocks/node'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

/** Specs import this to override a handler for one test (`server.use(...)`). */
export const testServer = setupTestServer()

// React Testing Library only auto-cleans when vitest runs with globals, which
// these apps deliberately do not.
afterEach(() => {
  cleanup()
})

/**
 * How long a `findBy*` or `waitFor` keeps asking before it gives up.
 *
 * Testing Library's default is **one second**, and it is **not** vitest's
 * `testTimeout` — raising that changes nothing here, which is how this was
 * found.
 *
 * One second is a budget rather than a measurement. Nothing on these screens is
 * *supposed* to take a second, and a spec that waits five still finishes in
 * twenty milliseconds when the render lands. What the default actually bounds
 * is how much CPU the process can be starved of while it waits — and
 * `pnpm -r test:coverage` starts a vitest instance per workspace, each with a
 * worker per core.
 *
 * The symptom was a query failing with "Unable to find role=table", which reads
 * as a rendering bug and is not one: the table arrives, later than a second. It
 * moved between files as the suites grew — `attributes-page` →
 * `attributes-a11y` → `attributes-error-contract` → `sellers-page` — which is
 * what a budget problem looks like from the outside.
 *
 * **A screen that never renders still fails**, five seconds later.
 */
configure({ asyncUtilTimeout: 5_000 })

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

/**
 * Radix's `Select` scrolls the highlighted option into view and asks about
 * pointer capture before treating a drag as one. jsdom implements neither, and
 * without them the attribute console's category picker throws on open rather
 * than failing an assertion (`packages/ui/test/setup.ts` carries the same four).
 */
polyfill(Element.prototype, 'scrollIntoView', (): void => undefined)
polyfill(Element.prototype, 'hasPointerCapture', (): boolean => false)
polyfill(Element.prototype, 'setPointerCapture', (): void => undefined)
polyfill(Element.prototype, 'releasePointerCapture', (): void => undefined)

class ResizeObserverStub {
  readonly observe = (): void => undefined
  readonly unobserve = (): void => undefined
  readonly disconnect = (): void => undefined
}

polyfill(globalThis, 'ResizeObserver', ResizeObserverStub)
