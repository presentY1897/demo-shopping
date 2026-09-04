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
  MOCK_REQUEST_ID,
  mockResponseHeaders,
  networkFailure,
  networkFailureAfterOn,
  networkFailureOn,
} from './failures'
export {
  addressRowsSnapshot,
  adminSellerHandlers,
  attributeHandlers,
  categoryHandlers,
  categoryRowsSnapshot,
  defaultHandlers,
  demoHandlers,
  failNextDefaultAssignment,
  failNextDemoIssue,
  failNextRefresh,
  healthHandlers,
  mockDemoAccount,
  mockSession,
  preferenceSnapshot,
  profileHandlers,
  resetAdminSellerStore,
  resetAttributeStore,
  resetCategoryStore,
  resetDemoStore,
  resetProfileStore,
  resetSellerStore,
  resetSessionStore,
  resetUploadStore,
  sellerHandlers,
  sellerRequests,
  sellerRowSnapshot,
  sessionHandlers,
  uploadHandlers,
  userRolesHandlers,
} from './handlers'
export type { SellerRequestRecord } from './handlers'
export { mockMethods, mockPaths, MOCK_STORAGE_ORIGIN, MOCK_STORAGE_PUBLIC_ORIGIN } from './paths'
export type { MockMethod, MockPath } from './paths'
export { fixtureRegistry } from './registry'
export type { RegisteredFixture } from './registry'
export { neverAnswers, neverAnswersOn, sleepingInstance, slowResponse, wakesAfter } from './waking'
export * from './fixtures'
