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
  CARD_LIMIT_MAX,
  CARD_LIMIT_MIN,
  cartHandlers,
  categoryHandlers,
  categoryRowsSnapshot,
  checkoutHandlers,
  declineNextTossApproval,
  defaultHandlers,
  demoHandlers,
  failNextDefaultAssignment,
  failNextDemoIssue,
  failNextRefresh,
  failNextStockAdjustment,
  healthHandlers,
  MOCK_CARD_EXPIRES_AT,
  MOCK_CARDS_PER_USER,
  mockDemoAccount,
  MOCK_ORDER_IDS,
  MOCK_ORDER_NOW,
  MOCK_ORDER_PAGE_SIZE,
  MOCK_SELLER_ORDER_IDS,
  mockSession,
  orderHandlers,
  paymentHandlers,
  preferenceSnapshot,
  productHandlers,
  productRowsSnapshot,
  profileHandlers,
  resetAdminSellerStore,
  resetAttributeStore,
  resetCartStore,
  resetCategoryStore,
  resetCheckoutStore,
  resetDemoStore,
  resetOrderStore,
  resetPaymentStore,
  resetProductStore,
  resetProfileStore,
  failNextShipment,
  resetSellerConsoleStore,
  resetSellerOrderStore,
  resetSellerStore,
  resetSessionStore,
  resetUploadStore,
  searchHandlers,
  sellerConsoleHandlers,
  sellerConsoleSnapshot,
  sellerHandlers,
  sellerOrderHandlers,
  sellerOrderSnapshot,
  sellerRequests,
  sellerRowSnapshot,
  sessionHandlers,
  unresolveNextApproval,
  uploadHandlers,
  userRolesHandlers,
} from './handlers'
export type { CardTransaction, IssuedCard, SellerRequestRecord } from './handlers'
export {
  SEARCH_CATALOGUE,
  SEARCH_COAT_CATEGORY,
  SEARCH_SHOE_CATEGORY,
  searchFilters,
} from './handlers/search-catalogue'
export {
  productId as sellerProductId,
  SELLER_CATEGORY_IDS,
  SELLER_PRODUCT_COUNT,
  sellerProductListItem,
  sellerVariants,
  variantId as sellerVariantId,
} from './handlers/seller-console-catalogue'
export { mockMethods, mockPaths, MOCK_STORAGE_ORIGIN, MOCK_STORAGE_PUBLIC_ORIGIN } from './paths'
export type { MockMethod, MockPath } from './paths'
export { fixtureRegistry } from './registry'
export type { RegisteredFixture } from './registry'
export { neverAnswers, neverAnswersOn, sleepingInstance, slowResponse, wakesAfter } from './waking'
export * from './fixtures'
