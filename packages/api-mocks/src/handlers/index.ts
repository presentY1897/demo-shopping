import type { RequestHandler } from 'msw'

import { adminClaimHandlers } from './admin-claims'
import { adminSellerHandlers } from './admin-sellers'
import { attributeHandlers } from './attributes'
import { cartHandlers } from './cart'
import { categoryHandlers } from './categories'
import { checkoutHandlers } from './checkout'
import { claimHandlers } from './claims'
import { couponBoxHandlers } from './coupon-box'
import { pointHandlers } from './points'
import { sellerClaimHandlers } from './seller-claims'
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
  ...claimHandlers,
  ...couponBoxHandlers,
  ...pointHandlers,
  ...sellerClaimHandlers,
  ...paymentHandlers,
  ...categoryHandlers,
  ...attributeHandlers,
  ...productHandlers,
  ...searchHandlers,
  ...sellerConsoleHandlers,
  ...sellerOrderHandlers,
  ...sellerHandlers,
  ...adminSellerHandlers,
  ...adminClaimHandlers,
  ...uploadHandlers,
]

export {
  adminClaimHandlers,
  adminClaimRowsSnapshot,
  failNextAdminClaim,
  resetAdminClaimStore,
} from './admin-claims'
/**
 * 관리자 개입의 씨앗 — 목록의 열두 줄과, **아직 클레임이 없는 다섯 몫**.
 *
 * 뒤엣것이 확정 후 하자 반품(F4)의 시작점이다. 원본 거절이 없는 개입이라 목록의 어느
 * 줄로도 그 화면에 닿을 수 없고, 검사는 이 id 들로 라우팅한다.
 */
export {
  MOCK_ADMIN_CLAIM_NOW,
  MOCK_ADMIN_CLAIMABLE_IDS,
  MOCK_ADMIN_CLAIMABLE_ORDER_NUMBERS,
  MOCK_ADMIN_DEFECT_RETURN_ID,
  MOCK_ADMIN_INTERVENTION_ID,
} from './admin-claim-contract'
export { adminSellerHandlers, resetAdminSellerStore } from './admin-sellers'
/**
 * 플랫폼 부담 쿠폰의 발행자 콘솔 (TASK-0073). 목록·발행·중단·일괄 지급이 한 저장소를
 * 본다.
 *
 * **`defaultHandlers` 에 없다** — 판매자 쿠폰 대역이 같은 이유로 빠져 있고, 그 이유는
 * 아래 그쪽 블록이 적어 두었다. 이 화면의 검사는 `server.use(...platformCouponHandlers)`
 * 로 자기 저장소를 앞에 세운다.
 */
export {
  emptyPlatformCouponStore,
  failNextPlatformCoupon,
  MOCK_PLATFORM_COUPON_IDS,
  MOCK_PLATFORM_COUPON_NOW,
  platformCouponHandlers,
  platformCouponSnapshot,
  resetPlatformCouponStore,
} from './platform-coupons'
export { attributeHandlers, resetAttributeStore } from './attributes'
export { cartHandlers, resetCartStore } from './cart'
export { categoryHandlers, categoryRowsSnapshot, resetCategoryStore } from './categories'
export {
  checkoutHandlers,
  resetCheckoutStore,
  seedCheckoutCoupons,
  spendCouponElsewhere,
} from './checkout'
/**
 * 취소·반품 신청 (TASK-0066). 「무엇을 신청할 수 있나」와 신청이 한 저장소를 본다.
 *
 * 주문 대역 **뒤에** 등록된다. 다섯 몫의 상태를 `handlers/orders.ts` 의 저장소에서
 * 읽으므로, 그쪽이 답하지 않는 세상에서는 이 대역도 답할 것이 없다.
 *
 * id 와 시각은 픽스처와 핸들러가 **함께** 읽는 값이라 `claim-contract.ts` 에 산다 —
 * 주문이 같은 이유로 `order-contract.ts` 를 갖는다.
 */
export { claimHandlers, failNextClaim, resetClaimStore } from './claims'
/**
 * 구매자의 쿠폰함과 코드 등록 (TASK-0077). 목록·수·발급이 한 저장소를 본다.
 *
 * **`defaultHandlers` 에 있다** — 발행자 콘솔의 쿠폰 대역(플랫폼·판매자)이 빠져 있는
 * 것과 반대인데, 이유는 라우트가 겹치지 않기 때문이다. 저 둘은 `GET /coupons` 하나를
 * 두고 다투지만 이쪽은 `/me/coupons` 와 `/coupons/claims` 라, 어느 콘솔 대역을 앞에
 * 세워도 이 문은 그대로 열려 있다.
 */
export { couponBoxHandlers, couponBoxSnapshot, resetCouponBoxStore } from './coupon-box'
/**
 * 쿠폰함 대역의 씨앗과 조립기. 핸들러와 픽스처가 **함께** 읽으므로 픽스처 밖에 산다 —
 * `seller-coupon-contract.ts` 와 같은 이유이고, 그 파일이 그 이유를 적어 두었다.
 */
export {
  MOCK_CLAIMABLE_COUPON_CODE,
  MOCK_CLAIM_OUTCOMES,
  MOCK_COUPON_BOX_NOW,
  MOCK_COUPON_BOX_PAGE_SIZE,
  mockCouponBoxSeedAt,
  mockCouponBoxSeeds,
} from './coupon-box-contract'
/**
 * 구매자의 적립금 (TASK-0077). 잔액·원장이 한 저장소를 본다.
 *
 * **쓰기가 없다.** 적립도 사용도 주문이 일으키는 일이라 이 대역에 `POST` 가 없고,
 * 그것이 실제 컨트롤러의 모양이기도 하다.
 */
export { pointHandlers, resetPointStore } from './points'
export {
  MOCK_POINT_LEDGER_PAGE_SIZE,
  MOCK_POINT_NOW,
  MOCK_POINT_ORDER_ID,
  mockPointLedgerSeeds,
} from './point-contract'
export {
  MOCK_CLAIM_ID,
  MOCK_CLAIM_ORDER_ID,
  MOCK_CLAIM_RETURN_WINDOW_CLOSED_AT,
  MOCK_CLAIM_RETURN_WINDOW_ENDS_AT,
  MOCK_CLAIM_SELLER_ORDER_IDS,
} from './claim-contract'
/**
 * 판매자 콘솔의 클레임 (TASK-0070). 목록·요약·상세와 전이·수거·검수가 한 저장소를
 * 본다.
 *
 * 구매자의 `claims` **뒤에** 등록된다. `POST /claims/:id/transitions` 는 두 화면이
 * 함께 쓸 수 있는 라우트이고, 기본 목록에서 먼저 맞는 쪽이 이기기 때문이다 —
 * 구매자 대역이 그 문을 열지 않는 지금은 순서가 답을 바꾸지 않지만, 여는 날
 * 바꾼다.
 */
export {
  failNextSellerClaim,
  resetSellerClaimStore,
  sellerClaimHandlers,
  sellerClaimSnapshot,
} from './seller-claims'
/**
 * 판매자 클레임 대역의 씨앗과 조립기. 핸들러와 픽스처가 **함께** 읽으므로 픽스처
 * 밖에 산다 — `claim-contract.ts` 와 같은 이유이고, 그 파일이 그 이유를 적어 두었다.
 */
export {
  MOCK_SELLER_CLAIM_BRAND,
  MOCK_SELLER_CLAIM_IDS,
  MOCK_SELLER_CLAIM_NOW,
  MOCK_SELLER_CLAIM_SELLER_STEPS,
  MOCK_SELLER_CLAIM_STAGES,
} from './seller-claim-contract'
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
 * 판매자 콘솔의 쿠폰 (TASK-0074). 목록·발행·중단이 한 저장소를 본다.
 *
 * **`defaultHandlers` 에 없다.** 같은 `/coupons` 라우트를 관리자 콘솔(TASK-0073)도
 * 쓰므로, 둘 다 기본 목록에 실으면 먼저 등록된 쪽이 언제나 이겨 다른 쪽 저장소는
 * 아무 검사도 지나지 않는다. 이 화면의 검사가 `server.use(...sellerCouponHandlers)`
 * 로 자기 저장소를 앞에 세운다.
 */
export {
  failNextSellerCoupon,
  resetSellerCouponStore,
  sellerCouponHandlers,
  sellerCouponSnapshot,
} from './seller-coupons'
/**
 * 판매자 쿠폰 대역의 씨앗과 조립기. 핸들러와 픽스처가 **함께** 읽으므로 픽스처
 * 밖에 산다 — `seller-claim-contract.ts` 와 같은 이유다.
 */
export {
  MOCK_COUPON_SELLER_ID,
  MOCK_OTHER_SELLER_ID,
  MOCK_SELLER_COUPON_NOW,
  mockSellerCouponSeedAt,
  mockSellerCouponSeeds,
} from './seller-coupon-contract'
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
