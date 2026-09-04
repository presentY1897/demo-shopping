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
 * Testing Library's default is **one second**, and it is not vitest's
 * `testTimeout` — raising that changes nothing here. One second is a fair
 * budget for a component that renders from props; it is not one for a console
 * that mounts, boots a session, fetches through msw and paints a table, with
 * five other workspaces competing for the machine because `pnpm -r` runs them
 * in parallel.
 *
 * The symptom was a query failing with "Unable to find role=table", which reads
 * as a rendering bug and is not one — the table arrives, later than a second.
 * It moved between files (`attributes-page` → `attributes-a11y` →
 * `attributes-error-contract` → `sellers-page`) as suites grew, which is what
 * a budget problem looks like from the outside.
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

class ResizeObserverStub {
  readonly observe = (): void => undefined
  readonly unobserve = (): void => undefined
  readonly disconnect = (): void => undefined
}

polyfill(globalThis, 'ResizeObserver', ResizeObserverStub)
