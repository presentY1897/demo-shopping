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
   * `POST` 주문 생성 (TASK-0049).
   *
   * 열린 주문서를 가리키거나(`checkoutId`) 장바구니 줄을 가리킨다(`itemIds`) — 둘 중
   * 하나다 (TASK-0050 4.3).
   */
  orders: `*${API_PATH_PREFIX}/orders`,
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
