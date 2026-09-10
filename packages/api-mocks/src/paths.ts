import { API_PATH_PREFIX } from '@shopping/shared'

/**
 * Request patterns the handlers match on.
 *
 * The host is a wildcard on purpose: shop, seller and admin each resolve their
 * own `NEXT_PUBLIC_API_URL`, and a handler pinned to one origin would silently
 * stop matching in the other two apps. The version prefix comes from
 * `@shopping/shared` so that `/api/v2` is a one line change here.
 */
/**
 * Where the mock's presigned uploads point.
 *
 * `.invalid` is reserved and unroutable (RFC 6761), so a PUT that escaped msw
 * would fail at the resolver rather than reach whatever is listening — the same
 * reasoning as the `api.test.invalid` base URL the vitest preset sets.
 */
export const MOCK_STORAGE_ORIGIN = 'https://storage.test.invalid'

/** The public read domain, which is a different deployment from the bucket. */
export const MOCK_STORAGE_PUBLIC_ORIGIN = 'https://cdn.test.invalid'

export const mockPaths = {
  health: `*${API_PATH_PREFIX}/health`,
  /**
   * `POST` to exchange the refresh cookie for an access token (TASK-0022).
   *
   * Every app calls it once on boot, so it is in `defaultHandlers` rather than
   * something a spec opts into — a screen that had to declare it would be a
   * screen whose sign-in state is decided by whoever remembered.
   */
  authRefresh: `*${API_PATH_PREFIX}/auth/refresh`,
  /** `POST` to end this app's session. The other two keep theirs (D-218). */
  authLogout: `*${API_PATH_PREFIX}/auth/logout`,
  authDemo: `*${API_PATH_PREFIX}/auth/demo`,
  userRoles: `*${API_PATH_PREFIX}/users/:userId/roles`,
  /**
   * One's own account (TASK-0111). `GET` profile + settings, `PATCH` the
   * profile, `DELETE` to withdraw.
   *
   * **No id in any of these paths.** That is the contract, not a shortening:
   * with no `userId` there is no way to *ask* for somebody else's profile, and
   * the scope check in the service is a second line of defence rather than the
   * only one.
   */
  me: `*${API_PATH_PREFIX}/me`,
  /** `GET` and `PATCH` display density, locale, currency and notification switches. */
  mePreferences: `*${API_PATH_PREFIX}/me/preferences`,
  /** `GET` the address book, `POST` a new address. */
  meAddresses: `*${API_PATH_PREFIX}/me/addresses`,
  /** `PATCH` the fields a person typed, `DELETE` one address. */
  meAddress: `*${API_PATH_PREFIX}/me/addresses/:id`,
  /** `POST` to make one address the default — the only door to that change. */
  meAddressDefault: `*${API_PATH_PREFIX}/me/addresses/:id/default`,
  /**
   * 장바구니 (TASK-0045). `GET` 전체, `POST` 담기.
   *
   * **경로에 사용자 id 가 없다.** 소유자는 토큰이 정한다 — `/me` 와 같은 모양이고,
   * 남을 가리킬 자리가 애초에 없다.
   */
  cart: `*${API_PATH_PREFIX}/cart`,
  /** `PATCH` 수량 대입. 담기와 다른 동사이므로 다른 라우트다. */
  cartItem: `*${API_PATH_PREFIX}/cart/items/:id`,
  /** `POST` 선택 삭제. 한 줄을 지우는 것도 이쪽이다. */
  cartItemsRemove: `*${API_PATH_PREFIX}/cart/items/remove`,
  /** `POST` 담기. `cartItem` 보다 **먼저** 와야 한다 — msw 는 먼저 맞는 것을 쓴다. */
  cartItems: `*${API_PATH_PREFIX}/cart/items`,
  /**
   * 주문서 (TASK-0050 4.1). `POST` 로 연다.
   *
   * 부르는 것은 **장바구니의 「주문하기」**다. 주문서 화면이 진입과 동시에 부르면
   * 새로고침 한 번에 예약이 한 벌 더 잡힌다. 경로에 사용자 id 가 없는 것은 `/cart`
   * 와 같은 이유다 — 주인은 토큰이 정한다.
   */
  checkouts: `*${API_PATH_PREFIX}/checkouts`,
  /**
   * `GET` 주문서 다시 그리기, `DELETE` 이탈 해제.
   *
   * 컬렉션 **뒤에** 온다. `:id` 는 `/` 를 넘지 못하므로 이 둘이 서로를 먹지는
   * 않지만, 옆의 장바구니·카테고리 라우트가 전부 그 순서로 적혀 있다 — 언젠가
   * `/checkouts/{리터럴}` 이 붙는 날 순서를 지켜 온 목록만 안전하다.
   */
  checkout: `*${API_PATH_PREFIX}/checkouts/:id`,
  /**
   * `GET` 이 주문서에 쓸 수 있는 쿠폰과 추천 조합 (TASK-0075).
   *
   * `:id` 는 `/` 를 넘지 못하므로 위의 `checkout` 이 이것을 먹지 않는다. 그래도
   * 핸들러 목록에서는 이쪽을 먼저 등록한다 — msw 는 **먼저 맞는 것**을 쓰고, 그
   * 규칙에 기대지 않는 순서가 옆의 `cartItemsRemove`·`cartItems` 에도 서 있다.
   */
  checkoutCoupons: `*${API_PATH_PREFIX}/checkouts/:id/coupons`,
  /**
   * `POST` 주문 생성 (TASK-0049).
   *
   * 열린 주문서를 가리키거나(`checkoutId`) 장바구니 줄을 가리킨다(`itemIds`) — 둘 중
   * 하나다 (TASK-0050 4.3).
   */
  orders: `*${API_PATH_PREFIX}/orders`,
  /**
   * `GET` 주문 하나 (TASK-0063). 묶음마다 상태와 배송이 실린다.
   *
   * 컬렉션 **뒤에** 온다. `:id` 는 `/` 를 넘지 못하므로 둘이 서로를 먹지는 않지만,
   * 옆의 라우트들이 전부 그 순서로 적혀 있다.
   */
  order: `*${API_PATH_PREFIX}/orders/:id`,
  /**
   * `GET` 이 묶음에 지금 할 수 있는 것 (TASK-0059 F7).
   *
   * **읽기가 아니라 `order.write` 를 요구한다** — 답이 「무엇을 볼 수 있나」가 아니라
   * 「무엇을 누를 수 있나」이기 때문이다. 구매자에게 돌아오는 것은 배송완료 묶음의
   * 구매확정 하나뿐이고, 나머지 상태에서는 빈 목록이다.
   */
  /**
   * 판매자 콘솔의 주문 목록 (TASK-0060). `GET` 만 있다.
   *
   * 구매자의 `/orders` 와 **다른 라우트**인 것이 계약이다 — 한 줄이 주문이 아니라
   * 판매자 몫이고, 남의 몫이 섞인 주문 합계는 실리지 않는다.
   */
  sellerOrders: `*${API_PATH_PREFIX}/seller-orders`,
  /**
   * 상태별 건수. **`sellerOrder` 보다 먼저 등록해야 한다** — msw 는 먼저 맞는 것을
   * 쓰므로 뒤에 두면 `summary` 가 주문 id 로 읽힌다. 실제 서버에서 라우트 선언 순서가
   * 같은 함정이다.
   */
  sellerOrdersSummary: `*${API_PATH_PREFIX}/seller-orders/summary`,
  /** 몫 하나 — 항목 · 수령인 · 금액 · 배송 · 이력. */
  sellerOrder: `*${API_PATH_PREFIX}/seller-orders/:id`,
  /** `POST` 발송 처리. 운송장 발급 · 전이 · 첫 추적 사건이 한 트랜잭션이다. */
  sellerOrderShipment: `*${API_PATH_PREFIX}/seller-orders/:id/shipment`,
  /**
   * `POST` 배송완료 처리 (TASK-0060 4.3).
   *
   * 전이 라우트와 **다른 문**이다. 그쪽으로 가면 주문만 움직이고 배송 표가 그대로
   * 남아, 구매자의 추적 화면이 「이동 중」인 채로 주문은 배송완료가 된다.
   */
  sellerOrderDelivery: `*${API_PATH_PREFIX}/seller-orders/:id/delivery`,
  sellerOrderActions: `*${API_PATH_PREFIX}/seller-orders/:id/actions`,
  /** `POST` 이 묶음을 다음 상태로. 구매자에게는 구매확정만 열려 있다. */
  sellerOrderTransitions: `*${API_PATH_PREFIX}/seller-orders/:id/transitions`,
  /**
   * `GET` 이 묶음에 지금 무엇을 몇 개까지 신청할 수 있나 (TASK-0066 F8).
   *
   * `actions` 가 전이에 대해 하는 일을 클레임에 대해 한다 — **화면이 상태로
   * 분기하지 않게 하려고 있다.** 「배송완료면 반품 버튼」을 화면에 적으면 그 판단이
   * 세 앱에 흩어지고, 반품 기간처럼 배포 설정(`FULFILLMENT_PACE`)에 달린 값은 화면이
   * **틀린 날짜를 자신 있게** 적게 된다.
   *
   * 몫의 컬렉션 뒤에 오는 것은 옆의 라우트들과 같은 이유다 — `:id` 는 `/` 를 넘지
   * 못해 서로를 먹지 않지만, 순서를 지켜 온 목록만 리터럴이 하나 붙는 날 안전하다.
   */
  claimable: `*${API_PATH_PREFIX}/seller-orders/:id/claimable`,
  /**
   * `POST` 취소·반품을 신청한다 (TASK-0066).
   *
   * **경로가 `/seller-orders/:id/claims` 가 아니다.** 클레임은 주문에 딸린 하위
   * 자원이 아니라 자기 수명과 자기 상태 머신을 갖는 것이고, 판매자 콘솔은 주문을
   * 거치지 않고 목록으로 연다. 어느 몫의 것인지는 몸통의 `sellerOrderId` 가 말한다.
   */
  claims: `*${API_PATH_PREFIX}/claims`,
  /**
   * `POST` 승인 · 거절 (TASK-0070).
   *
   * **판매자 콘솔의 쓰기가 `/seller-claims` 밑에 없다.** 같은 전이에 문이 둘 생기면
   * 「어느 쪽이 진짜 규칙인가」에 답할 수 있는 사람이 없어지고, 그래서 콘솔 라우트는
   * 읽기 셋뿐이다 (`SellerClaimController`).
   *
   * 리터럴이 붙은 이것이 {@link mockPaths.claim} 보다 **먼저** 온다. `:id` 는 `/` 를
   * 넘지 못해 서로를 먹지는 않지만, 옆의 라우트들이 전부 그 순서로 적혀 있다.
   */
  claimTransitions: `*${API_PATH_PREFIX}/claims/:id/transitions`,
  /**
   * `GET` 클레임 하나. 신청한 화면이 곧바로 이것을 다시 읽는다.
   *
   * 컬렉션 **뒤에** 온다 — 옆의 라우트들이 전부 그 순서다.
   */
  claim: `*${API_PATH_PREFIX}/claims/:id`,
  /**
   * `POST` 수거를 시작한다 (TASK-0067 · 0070 F3).
   *
   * **전이 라우트와 다른 문이다.** 그쪽으로 가면 상태만 옮겨지고 회수 운송장이 나지
   * 않아, 「회수 중」이라고 말해 놓고 어디로 보내야 하는지 답하지 못하는 반품이
   * 남는다. 어느 문으로 가는지는 상세의 `actions[].route` 가 답한다.
   */
  returnPickup: `*${API_PATH_PREFIX}/returns/:claimId/pickup`,
  /**
   * `POST` 입고 검수. **합격 여부가 환불을 가른다** (F4 · F5).
   *
   * `:claimId` 인 것은 반품이 클레임과 같은 열쇠를 쓰기 때문이다 — 반품은 클레임에
   * 딸린 부속이고 자기 id 를 따로 갖지 않는다.
   */
  returnInspection: `*${API_PATH_PREFIX}/returns/:claimId/inspection`,
  /**
   * 판매자 콘솔의 클레임 목록 (TASK-0070). `GET` 만 있다.
   *
   * 구매자·관리자가 함께 쓰는 `/claims` 와 **다른 라우트**인 것이 계약이다 — 한 줄에
   * 판매자에게만 뜻이 있는 셋(단계 · 기한 · 지연)이 실리고, 「기한 초과」를 구매자
   * 화면에 그리면 판매자를 재촉하는 말이 남의 화면에 뜬다.
   */
  sellerClaims: `*${API_PATH_PREFIX}/seller-claims`,
  /**
   * 상태별 · 단계별 건수. **`sellerClaim` 보다 먼저 등록해야 한다** — msw 는 먼저
   * 맞는 것을 쓰므로 뒤에 두면 `summary` 가 클레임 id 로 읽힌다. 실제 서버에서
   * 컨트롤러의 선언 순서가 같은 함정이다.
   */
  sellerClaimSummary: `*${API_PATH_PREFIX}/seller-claims/summary`,
  /** 클레임 하나 — 항목 · 사진 · 환불 예정액 · 기한 · 버튼이 한 응답이다. */
  sellerClaim: `*${API_PATH_PREFIX}/seller-claims/:id`,
  /**
   * 내 카드들 (TASK-0054). `GET` 목록, `POST` 발급 (TASK-0058).
   *
   * 경로에 사용자 id 가 없다. 주인은 토큰이 정한다 — `/cart` · `/me` 와 같은 모양이고,
   * 남의 카드를 가리킬 자리가 애초에 없다.
   *
   * 발급이 같은 경로인 것은 봉투가 컬렉션이기 때문이다. `POST /cards/issue` 같은
   * 동사 경로를 두면 이 저장소의 다른 컬렉션들과 모양이 갈린다.
   */
  cards: `*${API_PATH_PREFIX}/cards`,
  /**
   * `POST` 정지, `POST` 해제 (TASK-0058 F5).
   *
   * **정지는 삭제가 아니다.** 되살릴 수 있으므로 라우트가 둘이고, 화면도 그 카드를
   * 목록에서 지우지 않는다 (TASK-0054 4.1).
   *
   * 리터럴이 붙은 둘이 `card` 보다 **먼저** 온다. `:id` 는 `/` 를 넘지 못하므로
   * 서로를 먹지는 않지만, 옆의 라우트들이 전부 그 순서로 적혀 있다.
   */
  cardSuspend: `*${API_PATH_PREFIX}/cards/:id/suspend`,
  cardActivate: `*${API_PATH_PREFIX}/cards/:id/activate`,
  /**
   * `GET` 카드 사용 내역 (TASK-0058 4.1).
   *
   * **TASK-0053 이 만들지 않은 라우트다.** 0053 이 만든 것은 발급·목록·정지·삭제
   * 까지이고, 「환불이 잘 됐는지 잔액으로 확인」하는 동선은 원장을 읽어야 완성된다.
   *
   * 남의 카드 원장은 **있는지 없는지도** 알려 주지 않는다 — 그 사람이 무엇을 샀는지가
   * 그 목록에 그대로 적혀 있기 때문이고, 그래서 대역도 모르는 카드에 404 로 답한다.
   */
  cardTransactions: `*${API_PATH_PREFIX}/cards/:id/transactions`,
  /** `DELETE` 카드 삭제. 서버에서는 소프트 삭제다 — 원장이 이 카드를 가리킨다. */
  card: `*${API_PATH_PREFIX}/cards/:id`,
  /** `POST` 결제를 연다. 몸통은 `{ orderId, provider, cardId }` 다. */
  latestPayment: `*${API_PATH_PREFIX}/orders/:id/payment`,
  payment: `*${API_PATH_PREFIX}/payments/:id`,
  payments: `*${API_PATH_PREFIX}/payments`,
  /**
   * `POST` 승인, `POST` 매입 — **두 라우트인 것이 계약**이다 (D-031).
   *
   * 가상 카드는 그 사이에 아무 일도 하지 않지만 토스에는 은행이 있고, 두 구현이 같은
   * 순서를 따라야 추상화가 값을 한다. 컬렉션 뒤에 오는 것은 옆의 라우트들과 같은
   * 이유다 — `:id` 는 `/` 를 넘지 못하므로 서로를 먹지 않지만, 순서를 지켜 온
   * 목록만 리터럴이 하나 붙는 날 안전하다.
   */
  paymentAuthorize: `*${API_PATH_PREFIX}/payments/:id/authorize`,
  paymentCapture: `*${API_PATH_PREFIX}/payments/:id/capture`,
  /**
   * `POST` 토스 결제창이 돌아온 뒤의 승인 (TASK-0055).
   *
   * `authorize` 와 **다른 라우트인 이유**는 이 단계에만 대조할 것이 있기 때문이다 —
   * 브라우저가 `paymentKey` 와 `amount` 를 들고 돌아오고, 서버는 그 금액을 DB 의
   * 승인액과 맞춰 본 뒤에야 결제사를 부른다 (F2).
   */
  paymentTossConfirm: `*${API_PATH_PREFIX}/payments/:id/toss/confirm`,
  /** `GET` the tree, `POST` a new node. */
  categories: `*${API_PATH_PREFIX}/categories`,
  /**
   * `GET` the storefront's tree — active only, no sign-in (TASK-0042 4.2).
   *
   * Before {@link mockPaths.category}, for the same reason `reorder` is: msw
   * takes the first handler that matches and `:id` would read `tree` as one.
   */
  categoryTree: `*${API_PATH_PREFIX}/categories/tree`,
  /** `PATCH` the fields a person types, `DELETE` to retire. */
  category: `*${API_PATH_PREFIX}/categories/:id`,
  categoryMove: `*${API_PATH_PREFIX}/categories/:id/move`,
  /**
   * Must be registered **before** {@link mockPaths.category}: msw takes the
   * first handler that matches, and `:id` would happily read `reorder` as one.
   */
  categoryReorder: `*${API_PATH_PREFIX}/categories/reorder`,
  /** `GET` the definitions that apply to a category, `POST` a new one. */
  attributes: `*${API_PATH_PREFIX}/attributes`,
  /** `PATCH` the editable fields, `DELETE` to retire. */
  attribute: `*${API_PATH_PREFIX}/attributes/:id`,
  /**
   * The caller's own store: `GET` its status and reason, `PATCH` its copy
   * (TASK-0108). No id in the path — `me` cannot be pointed at anybody.
   */
  sellerMe: `*${API_PATH_PREFIX}/sellers/me`,
  /** `POST` to apply, and to apply again after a rejection. */
  sellerApplications: `*${API_PATH_PREFIX}/sellers/applications`,
  /**
   * `GET` one store as a shopper sees it — public, `ACTIVE` only (TASK-0044).
   *
   * Registered **after** the literal seller paths, the same order the API's
   * controller declares them in: msw takes the first handler that matches and
   * `:id` would read `me` as one.
   */
  storefrontSeller: `*${API_PATH_PREFIX}/sellers/:id`,
  /** `GET ?value=` — whether a brand name is free at the moment of asking. */
  sellerBrandNameAvailability: `*${API_PATH_PREFIX}/sellers/brand-name-availability`,
  /** `GET` the review queue — status filter and cursor (TASK-0108). */
  adminSellers: `*${API_PATH_PREFIX}/admin/sellers`,
  /** `GET` one application, for the review screen. */
  adminSeller: `*${API_PATH_PREFIX}/admin/sellers/:id`,
  /**
   * `POST` a decision: `approve` · `reject` · `suspend` · `reinstate`.
   *
   * One pattern rather than four because a path parameter never spans a `/`, so
   * {@link mockPaths.adminSeller} cannot swallow these and these cannot swallow
   * each other. The handler refuses an unknown fifth name with a 404, which is
   * what the real API's router does with a route that does not exist.
   */
  adminSellerDecision: `*${API_PATH_PREFIX}/admin/sellers/:id/:action`,
  /**
   * 관리자의 클레임 (TASK-0071).
   *
   * **지연 목록이 `adminClaims` 보다 **먼저** 등록돼야 하는가**를 물을 자리가 여기
   * 없다 — 이 대역에는 `admin/claims/:id` 가 아예 없다. 클레임 하나는 `/claims/:id`
   * 가 답하므로(관리자의 `claim.read` 가 `any` 다) 경로가 겹치지 않고, 그래서
   * `overdue` 는 자기 이름 그대로 매칭된다. 상세를 나중에 여기 더한다면 그때는
   * 순서가 규칙이 된다.
   */
  adminClaims: `*${API_PATH_PREFIX}/admin/claims`,
  /** `GET` 기한을 넘긴 채 처리를 기다리는 클레임. */
  adminOverdueClaims: `*${API_PATH_PREFIX}/admin/claims/overdue`,
  /** `POST` 이의를 기각한다. 인용은 강제 처리 그 자체라 라우트가 없다. */
  adminClaimAppealDismiss: `*${API_PATH_PREFIX}/admin/claims/:id/appeal/dismiss`,
  /** `GET` 나가지 못한 환불 (TASK-0068 R3 이 넘긴 항목). */
  adminFailedRefunds: `*${API_PATH_PREFIX}/admin/claim-refunds/failed`,
  /** `POST` 구매자가 거절에 이의를 제기한다. */
  claimAppeal: `*${API_PATH_PREFIX}/claims/:id/appeal`,
  /**
   * The catalogue: `POST` a listing whole (TASK-0113).
   *
   * Not under `/seller/` even though only a seller calls it. Which role may
   * call an endpoint is said once by the permission table, and a URL that says
   * it a second time eventually disagrees with the first —
   * `uploads.controller.ts` made the same call and TASK-0113 4장 followed it.
   */
  products: `*${API_PATH_PREFIX}/products`,
  /** `GET` for the editor and the preview, `PATCH` to save. */
  /** `GET` the shopper's view of one listing — public, `ACTIVE` only (TASK-0043). */
  productDetail: `*${API_PATH_PREFIX}/products/:id/detail`,
  product: `*${API_PATH_PREFIX}/products/:id`,
  /**
   * `POST` to put a listing on sale, and to take it off again.
   *
   * Registered **before** {@link mockPaths.product}: msw takes the first
   * handler that matches, and a path parameter never spans a `/`, so these two
   * cannot swallow {@link mockPaths.product} — but listing them first keeps the
   * reading order the same as the category routes next door.
   */
  productPublish: `*${API_PATH_PREFIX}/products/:id/publish`,
  productUnpublish: `*${API_PATH_PREFIX}/products/:id/unpublish`,
  search: `*${API_PATH_PREFIX}/search`,
  searchFilters: `*${API_PATH_PREFIX}/search/filters`,
  searchSuggest: `*${API_PATH_PREFIX}/search/suggest`,
  sellerProducts: `*${API_PATH_PREFIX}/seller/products`,
  sellerProductStatus: `*${API_PATH_PREFIX}/seller/products/status`,
  sellerProductVariants: `*${API_PATH_PREFIX}/seller/products/:id/variants`,
  sellerProductDuplicate: `*${API_PATH_PREFIX}/seller/products/:id/duplicate`,
  variantLedger: `*${API_PATH_PREFIX}/variants/:id/ledger`,
  variantStockAdjust: `*${API_PATH_PREFIX}/variants/:id/stock-adjustments`,
  /**
   * 발행자 콘솔의 쿠폰 (TASK-0073 · TASK-0074).
   *
   * `GET` 발행한 쿠폰 목록, `POST` 발행. 관리자와 판매자가 **같은 라우트**를 쓰고
   * 어느 목록인지는 `?sellerId=` 가 정한다 — 계약이 그렇게 생겼으므로 경로를 두 벌
   * 두면 그 순간 두 콘솔의 통계가 다른 정의를 갖게 된다.
   */
  coupons: `*${API_PATH_PREFIX}/coupons`,
  /**
   * `PATCH` 발행을 멈추거나 다시 연다.
   *
   * {@link mockPaths.coupons} 를 삼키지 않는다 — 경로 파라미터는 `/` 를 넘지
   * 못하므로 `/coupons` 와 `/coupons/:id` 는 서로를 가릴 수 없다.
   */
  coupon: `*${API_PATH_PREFIX}/coupons/:id`,
  /**
   * `POST` 조건에 맞는 회원에게 한꺼번에 지급한다 (TASK-0073 F4).
   *
   * {@link mockPaths.coupon} 보다 **좁은 경로**다. 경로 파라미터가 `/` 를 넘지 못해
   * 둘이 서로를 가리지는 않지만, 핸들러 목록에서는 이쪽을 먼저 등록한다 — msw 는
   * 먼저 맞는 것을 쓰고, 옆의 라우트들이 전부 그 순서로 서 있다.
   */
  couponBulkIssues: `*${API_PATH_PREFIX}/coupons/:id/issues/bulk`,
  /**
   * `POST` 코드를 넣어 **본인이** 받는다 (TASK-0072 F8 · TASK-0077 F3).
   *
   * {@link mockPaths.coupon} 과 같은 자리에 놓이는 리터럴 경로다. 경로 파라미터가
   * `/` 를 넘지 못하므로 저쪽이 이것을 삼킬 수는 없지만, 저쪽이 언젠가 `PATCH` 말고
   * 다른 동사를 갖게 되는 날을 대비해 **핸들러 목록에서 먼저 등록한다** — 옆의
   * `categoryReorder` 가 같은 이유로 같은 자리에 서 있다.
   */
  couponClaims: `*${API_PATH_PREFIX}/coupons/claims`,
  /**
   * 내 쿠폰함 (TASK-0077). `GET` 상태별 목록과 **탭에 붙는 수**.
   *
   * 발행자의 {@link mockPaths.coupons} 와 다른 라우트인 것이 계약이다 — 저기서 한
   * 줄은 정책 한 건이고 여기서 한 줄은 **발급된 장**이다. 경로에 사용자 id 가 없는
   * 것은 `/me` 와 같은 이유다: 주인은 토큰이 정하고, 남을 가리킬 자리가 없다.
   */
  meCoupons: `*${API_PATH_PREFIX}/me/coupons`,
  /**
   * `GET` 적립금 잔액과 그 주변 — 적립 예정·만료 예정 (TASK-0077).
   *
   * 원장과 라우트를 나눈 이유는 **읽는 빈도가 다르기** 때문이다. 마이페이지 요약은
   * 이 하나만 부르고, 원장은 적립금 화면에 들어간 사람만 넘긴다.
   */
  mePoints: `*${API_PATH_PREFIX}/me/points`,
  /**
   * `GET` 원장 한 쪽, 최신순. 커서는 `seq` 다.
   *
   * msw 의 경로는 끝까지 맞아야 하므로 위의 {@link mockPaths.mePoints} 가 이것을
   * 가리지 않는다. 그래도 핸들러 목록에서는 이쪽을 먼저 등록한다 — 옆의
   * `categoryTree` 가 같은 이유로 같은 자리에 서 있다.
   */
  mePointTransactions: `*${API_PATH_PREFIX}/me/points/transactions`,
  /** `POST` a request for one presigned upload (TASK-0011). */
  uploadPresign: `*${API_PATH_PREFIX}/uploads/presign`,
  /**
   * The bucket itself — **not our API**.
   *
   * A presigned upload goes straight from the browser to object storage, so a
   * front-end spec that only mocked our own origin would let a real cross-origin
   * PUT out of the process. It is listed here so that `onUnhandledRequest:
   * 'error'` covers it like everything else.
   */
  storageObject: `${MOCK_STORAGE_ORIGIN}/*`,
} as const

export type MockPath = (typeof mockPaths)[keyof typeof mockPaths]

/**
 * The verbs the helpers can build a handler for.
 *
 * Named here rather than in `failures.ts` because both the failure helpers and
 * the waking helpers need it, and neither should have to import the other.
 */
export const mockMethods = ['get', 'post', 'patch', 'put', 'delete'] as const

export type MockMethod = (typeof mockMethods)[number]
