import type { RequestHandler } from 'msw'
import { setupWorker } from 'msw/browser'

import { defaultHandlers } from './handlers'

/**
 * The same handlers, running in a browser through a service worker.
 *
 * Nothing consumes this yet — Storybook does, in TASK-0104. It exists now
 * because it is the reason msw was chosen over a Node-only interceptor
 * (TASK-0107 4.1): one definition of the API, whatever is rendering it.
 */
export function setupMockWorker(...extraHandlers: readonly RequestHandler[]) {
  return setupWorker(...defaultHandlers, ...extraHandlers)
}
