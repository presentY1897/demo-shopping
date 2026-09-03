/**
 * The mock API every front-end test speaks to.
 *
 * Environment specific entry points are separate: `@shopping/api-mocks/node`
 * for vitest, `@shopping/api-mocks/browser` for Storybook. Both build on the
 * handlers exported here, so there is one definition of what the API answers.
 */

export { defineFixture, fixtureSchemaOf, isFixture } from './define'
export {
  apiErrorBody,
  driftedHealthPayload,
  httpFailure,
  malformedResponse,
  networkFailure,
} from './failures'
export { defaultHandlers, healthHandlers, userRolesHandlers } from './handlers'
export { mockPaths } from './paths'
export type { MockPath } from './paths'
export { fixtureRegistry } from './registry'
export type { RegisteredFixture } from './registry'
export { neverAnswers, sleepingInstance, slowResponse, wakesAfter } from './waking'
export * from './fixtures'
