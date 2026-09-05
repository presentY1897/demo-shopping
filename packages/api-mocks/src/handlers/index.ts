import type { RequestHandler } from 'msw'

import { adminSellerHandlers } from './admin-sellers'
import { attributeHandlers } from './attributes'
import { cartHandlers } from './cart'
import { categoryHandlers } from './categories'
import { checkoutHandlers } from './checkout'
import { demoHandlers } from './demo'
import { healthHandlers } from './health'
import { orderHandlers } from './orders'
import { paymentHandlers } from './payment'
import { productHandlers } from './products'
import { searchHandlers } from './search'
import { sellerConsoleHandlers } from './seller-console'
import { sellerOrderHandlers } from './seller-orders'
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
  ...orderHandlers,
  ...paymentHandlers,
  ...categoryHandlers,
  ...attributeHandlers,
  ...productHandlers,
  ...searchHandlers,
  ...sellerConsoleHandlers,
  ...sellerOrderHandlers,
  ...sellerHandlers,
  ...adminSellerHandlers,
  ...uploadHandlers,
]

export { adminSellerHandlers, resetAdminSellerStore } from './admin-sellers'
export { attributeHandlers, resetAttributeStore } from './attributes'
export { cartHandlers, resetCartStore } from './cart'
export { categoryHandlers, categoryRowsSnapshot, resetCategoryStore } from './categories'
export { checkoutHandlers, resetCheckoutStore } from './checkout'
/**
 * 카드 계약 (TASK-0058). 핸들러가 아니라 **핸들러와 픽스처가 함께 읽는 모양**이고,
 * 그 파일이 왜 `fixtures/` 밖에 있는지는 거기 적혀 있다.
 */
export {
  CARD_LIMIT_MAX,
  CARD_LIMIT_MIN,
  MOCK_CARD_EXPIRES_AT,
  MOCK_CARDS_PER_USER,
} from './card-contract'
export type { CardTransaction, IssuedCard } from './card-contract'
export { demoHandlers, failNextDemoIssue, mockDemoAccount, resetDemoStore } from './demo'
/**
 * 구매자의 주문 (TASK-0063). 목록·상세·가능 액션·전이가 한 저장소를 본다.
 *
 * `MOCK_ORDER_NOW` 와 id 들은 픽스처와 핸들러가 **함께** 읽는 값이라 핸들러 쪽
 * 파일에 산다 — 카드가 같은 이유로 `card-contract.ts` 를 갖는다.
 */
export { MOCK_ORDER_PAGE_SIZE, orderHandlers, resetOrderStore } from './orders'
export { MOCK_ORDER_IDS, MOCK_ORDER_NOW, MOCK_SELLER_ORDER_IDS } from './order-contract'
export {
  declineNextTossApproval,
  paymentHandlers,
  resetPaymentStore,
  unresolveNextApproval,
} from './payment'
export { productHandlers, productRowsSnapshot, resetProductStore } from './products'
export { searchHandlers } from './search'
export {
  failNextStockAdjustment,
  resetSellerConsoleStore,
  sellerConsoleHandlers,
  sellerConsoleSnapshot,
} from './seller-console'
/**
 * 판매자 콘솔의 주문 (TASK-0060).
 *
 * 구매자의 `orders` **뒤에** 등록된다. `/seller-orders/:id/actions` 와
 * `…/transitions` 는 두 화면이 함께 쓰는 라우트이고, 기본 목록에서 먼저 맞는 쪽이
 * 이기기 때문이다 — 판매자 화면의 검사는 `server.use(...sellerOrderHandlers)` 로
 * 자기 저장소를 앞에 세운다.
 */
export {
  failNextShipment,
  resetSellerOrderStore,
  sellerOrderHandlers,
  sellerOrderSnapshot,
} from './seller-orders'
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
