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
