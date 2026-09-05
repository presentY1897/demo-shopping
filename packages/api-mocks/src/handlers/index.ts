import type { RequestHandler } from 'msw'

import { adminSellerHandlers } from './admin-sellers'
import { attributeHandlers } from './attributes'
import { cartHandlers } from './cart'
import { categoryHandlers } from './categories'
import { checkoutHandlers } from './checkout'
import { demoHandlers } from './demo'
import { healthHandlers } from './health'
import { paymentHandlers } from './payment'
import { productHandlers } from './products'
import { searchHandlers } from './search'
import { sellerConsoleHandlers } from './seller-console'
import { sellerHandlers } from './sellers'
import { profileHandlers } from './profile'
import { sessionHandlers } from './session'
import { uploadHandlers } from './uploads'
import { userRolesHandlers } from './user-roles'

/**
 * What every front-end test starts from: the success answer for each endpoint
 * we mock.
 *
 * Anything else — a 500, an unreachable API, a stale payload — is declared by
 * the one spec that wants it via `server.use(...)`, so a test that says nothing
 * about failures is a test of the happy path and cannot become one by accident.
 */
export const defaultHandlers: readonly RequestHandler[] = [
  ...healthHandlers,
  ...sessionHandlers,
  ...demoHandlers,
  ...userRolesHandlers,
  ...profileHandlers,
  ...cartHandlers,
  ...checkoutHandlers,
  ...paymentHandlers,
  ...categoryHandlers,
  ...attributeHandlers,
  ...productHandlers,
  ...searchHandlers,
  ...sellerConsoleHandlers,
  ...sellerHandlers,
  ...adminSellerHandlers,
  ...uploadHandlers,
]

export { adminSellerHandlers, resetAdminSellerStore } from './admin-sellers'
export { attributeHandlers, resetAttributeStore } from './attributes'
export { cartHandlers, resetCartStore } from './cart'
export { categoryHandlers, categoryRowsSnapshot, resetCategoryStore } from './categories'
export { checkoutHandlers, resetCheckoutStore } from './checkout'
export { demoHandlers, failNextDemoIssue, mockDemoAccount, resetDemoStore } from './demo'
export { paymentHandlers, resetPaymentStore } from './payment'
export { productHandlers, productRowsSnapshot, resetProductStore } from './products'
export { searchHandlers } from './search'
export {
  failNextStockAdjustment,
  resetSellerConsoleStore,
  sellerConsoleHandlers,
  sellerConsoleSnapshot,
} from './seller-console'
export { resetSellerStore, sellerHandlers, sellerRequests, sellerRowSnapshot } from './sellers'
export type { SellerRequestRecord } from './sellers'
export {
  addressRowsSnapshot,
  failNextDefaultAssignment,
  preferenceSnapshot,
  profileHandlers,
  resetProfileStore,
} from './profile'
export { resetUploadStore, uploadHandlers } from './uploads'
export { failNextRefresh, mockSession, resetSessionStore, sessionHandlers } from './session'
export { healthHandlers, userRolesHandlers }
