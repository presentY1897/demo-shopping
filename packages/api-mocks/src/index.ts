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
  httpFailureOn,
  malformedResponse,
  networkFailure,
  networkFailureAfterOn,
  networkFailureOn,
} from './failures'
export {
  categoryHandlers,
  defaultHandlers,
  healthHandlers,
  resetCategoryStore,
  userRolesHandlers,
} from './handlers'
export { mockMethods, mockPaths } from './paths'
export type { MockMethod, MockPath } from './paths'
export { fixtureRegistry } from './registry'
export type { RegisteredFixture } from './registry'
export { neverAnswers, neverAnswersOn, sleepingInstance, slowResponse, wakesAfter } from './waking'
export * from './fixtures'
