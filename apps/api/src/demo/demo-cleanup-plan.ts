/**
 * What an expired demo account leaves behind, and the order it comes apart in
 * (TASK-0025 4장).
 *
 * **The plan is data, not code, and that is the whole point.** R1 names the risk
 * as "삭제 범위 오류로 공용 데이터 손실" and asks that every statement carry an
 * owner condition. A plan written as statements can only be checked by reading
 * them; a plan written as a list can be checked by a test that walks it — which
 * is what `demo-cleanup-plan.spec.ts` does, and why the guard is a property of
 * the type rather than a habit.
 *
 * **Order is foreign keys, not preference.** Children before parents, and the
 * two that cannot be deleted at all come last as soft deletes.
 *
 * **Nothing here touches `StockLedger`.** It is append-only (TASK-0036), its
 * `variantId` holds `ProductVariant` with `RESTRICT`, and the history of a
 * withdrawn store's stock is a true record that should survive the store. That
 * constraint is also *why* products are soft-deleted rather than removed — see
 * the task's 4장.
 */

/** Every table an account can own rows in, today. */
export const ownedTables = [
  'Cart',
  'VirtualCard',
  'StockReservation',
  'RefreshToken',
  'UserPreference',
  'Address',
  'ReviewHelpful',
  'Review',
  'UserRole',
  'ProductVariant',
  'ProductOption',
  'Product',
  'Seller',
  'User',
] as const

export type OwnedTable = (typeof ownedTables)[number]

/**
 * How the rows are reached from the account.
 *
 * `user` — the row carries `userId`.
 * `seller` — the row carries `sellerId`, so it is reached through the store.
 * `product` — the row hangs off a product of that store.
 * `self` — the account row itself.
 */
export type CleanupScope = 'user' | 'seller' | 'product' | 'self'

export type CleanupKind = 'hard' | 'soft' | 'suspend'

export interface CleanupStep {
  readonly table: OwnedTable
  readonly kind: CleanupKind
  readonly scope: CleanupScope
  /** Why this one is not a plain delete. Absent for the hard deletes. */
  readonly because?: string
}

/**
 * The plan, in execution order.
 *
 * Read it top to bottom and it is the sentence "throw away what is only theirs,
 * hide what somebody else's history depends on, and keep the account row because
 * the ledger points at it".
 */
export const cleanupPlan: readonly CleanupStep[] = [
  {
    table: 'Cart',
    kind: 'hard',
    scope: 'user',
    because:
      '온전히 그 사람의 것이고 아무것도 참조하지 않는다. 남길 이력이 없다 — 주문은 별개의 표이고 자기 스냅샷을 갖는다 (TASK-0045)',
  },
  {
    table: 'VirtualCard',
    kind: 'hard',
    scope: 'user',
    because:
      '온전히 그 사람의 것이고 실제 결제망에 닿지 않는 가짜다. 원장은 Cascade 로 함께 간다 — 결제 이력은 `Payment` 가 들고 있고, 카드 원장은 그 카드의 잔액을 설명하는 기록이라 카드가 사라지면 설명할 대상이 없다 (TASK-0053)',
  },
  {
    table: 'StockReservation',
    kind: 'hard',
    scope: 'user',
    because:
      '잡아 둔 재고는 놓아 주어야 한다 — 계정이 사라지면 아무도 결제하지 않는다. `ProductVariant.reserved` 를 함께 되돌린다 (TASK-0048)',
  },
  {
    table: 'ReviewHelpful',
    kind: 'hard',
    scope: 'user',
    because:
      '**남의 리뷰에 누른 것도 그 사람의 것이다** (TASK-0084). 데모 방문자가 누른 「도움돼요」가 남으면 실계정 리뷰의 순서가 사라진 사람의 손에 남는다. 지우면서 그 리뷰들의 `helpfulCount` 를 다시 센다 — 누적하지 않고 세는 이유는 `Product.ratingAvg` 와 같다',
  },
  {
    table: 'Review',
    kind: 'hard',
    scope: 'user',
    because:
      '**남의 상품에 남긴 말이지만 그 사람의 것이다** (TASK-0083 R1). 데모 방문자가 남긴 별점이 실계정 상품의 평균에 영원히 섞이면, 그 상품의 평점은 아무도 검증할 수 없는 값이 된다. `ReviewImage` 는 Cascade 로 함께 가고, 상품의 `ratingAvg`·`ratingCount` 도 이때 다시 센다 (TASK-0084)',
  },
  { table: 'RefreshToken', kind: 'hard', scope: 'user' },
  { table: 'UserPreference', kind: 'hard', scope: 'user' },
  { table: 'Address', kind: 'hard', scope: 'user' },
  {
    table: 'ProductVariant',
    kind: 'soft',
    scope: 'seller',
    because: 'StockLedger 가 `RESTRICT` 로 잡는다 — 모든 Variant 는 개시 INBOUND 를 갖는다',
  },
  {
    table: 'ProductOption',
    kind: 'soft',
    scope: 'product',
    because: 'Variant 가 남아 있으므로 그 축도 남아야 한다',
  },
  {
    table: 'Product',
    kind: 'soft',
    scope: 'seller',
    because: 'Variant 가 `RESTRICT` 로 잡는다. 목록·상세는 `deletedAt IS NULL` 로 이미 거른다',
  },
  {
    table: 'Seller',
    kind: 'suspend',
    scope: 'user',
    because: 'Product.sellerId 가 `RESTRICT` 다. 행은 남기고 상태로 닫는다',
  },
  { table: 'UserRole', kind: 'hard', scope: 'user' },
  {
    table: 'User',
    kind: 'soft',
    scope: 'self',
    because: 'StockLedger.actorId 가 `RESTRICT` 다 — 조정을 한 번이라도 한 계정은 지워지지 않는다',
  },
]

/** Tables a step never touches, and the reason each one is left alone. */
export const untouchedTables: Readonly<Record<string, string>> = {
  StockLedger: 'append-only. 사라진 상품의 재고 이력이 남는 것이 옳다',
  ProductImage: 'Product 에 Cascade 로 매달려 있고, 상품이 소프트 삭제라 함께 숨는다',
  CartItem: 'Cart 에 Cascade 로 매달려 있다. 장바구니가 지워지면 함께 간다 (TASK-0045)',
  ReviewImage:
    'Review 에 Cascade 로 매달려 있다 (TASK-0083). **버킷의 객체는 이 계획이 지우지 않는다** — 버킷은 데이터베이스가 아니고, 고아 객체 청소는 상품 이미지와 같은 장치가 맡는다 (TASK-0033 F6)',
  ProductOptionValue: 'ProductOption 에 매달려 있다',
  VariantOptionValue: 'ProductVariant 에 매달려 있다',
  Category: '공용이다. 데모 계정은 카테고리를 만들지 않는다',
  AttributeDefinition: '공용이다',
  AppMeta: '계정 소유가 아니다',
  SearchLog:
    '검색어 집계다. 계정을 적지 않으므로 소유자가 없다 — 그것이 이 표를 안전하게 만드는 이유다 (TASK-0039)',
  SearchOutbox:
    '큐다. 정리는 여기에 REMOVE 를 **넣는다** — 지우면 자기가 방금 한 일을 되돌린다 (TASK-0038)',
  Order:
    '계정이 소유하지만 **지우지 않는다.** 판매자의 판매 이력과 정산이 이 주문을 가리키고, 산 사람이 데모였다는 것은 판 사람의 기록을 지울 이유가 아니다. 계정 행은 툼스톤으로 남으므로 `Order_userId_fkey`(RESTRICT)도 끊기지 않는다 (TASK-0049)',
  SellerOrder: 'Order 에 Cascade 로 매달려 있다. 주문이 남으므로 함께 남는다',
  OrderItem: 'SellerOrder 에 매달려 있다',
  OrderStatusHistory: 'SellerOrder 에 매달려 있다',
  Shipment:
    'SellerOrder 에 Cascade 로 매달려 있다. 주문이 남으므로 함께 남는다 — 「어디로 무엇을 보냈나」는 산 사람이 데모였다는 이유로 지울 수 있는 기록이 아니라 **판 사람의 배송 이력**이다 (TASK-0061)',
  ShipmentTrackingEvent: 'Shipment 에 Cascade 로 매달려 있다',
  Payment:
    '주문에 매달려 있고, 주문이 남으므로 함께 남는다. 결제 이력은 산 사람이 데모였다는 이유로 지울 수 있는 기록이 아니다 — 정산이 그것을 가리킨다 (TASK-0052)',
  PaymentEvent: 'Payment 에 Cascade 로 매달려 있다. 분쟁 조사의 근거이므로 결제가 남는 한 남는다',
  Refund: 'Payment 에 매달려 있다',
  VirtualCardTransaction: 'VirtualCard 에 Cascade 로 매달려 있다',
  ClaimRequest:
    'SellerOrder 에 Cascade 로 매달려 있다. 주문이 남으므로 함께 남는다 — 「이 주문이 왜 취소됐나」는 산 사람이 데모였다는 이유로 지울 수 있는 기록이 아니라 **판 사람의 클레임 이력**이고, 정산(M12)이 반품으로 확정 취소된 금액을 그것으로 센다. `requestedById` 가 `RESTRICT` 이므로 계정 행이 툼스톤으로 남는 지금 구조에서 끊기지도 않는다 (TASK-0065)',
  ClaimItem:
    'ClaimRequest 에 Cascade 로 매달려 있다. `orderItemId` 는 `RESTRICT` 인데, 주문 항목도 지우지 않으므로 끊기지 않는다',
  ClaimStatusHistory:
    'ClaimRequest 에 Cascade 로 매달려 있다. 「누가 이 반품을 거절했나」는 분쟁의 근거이므로 클레임이 남는 한 남는다 — PaymentEvent 와 같은 판단',
  ClaimRefund:
    'ClaimRequest 에 Cascade 로 매달려 있다. 클레임이 남으므로 함께 남는다 — 「이 클레임에 얼마를 왜 돌려줬나」는 `Refund` 만으로는 되짚을 수 없는 사실이고, 정산(M12)이 반품으로 확정 취소된 금액을 그것으로 센다. `paymentId` 가 `RESTRICT` 인데 결제도 지우지 않으므로 끊기지 않는다 (TASK-0068)',
  ReturnDetail:
    'ClaimRequest 에 Cascade 로 매달려 있다. 클레임이 남으므로 함께 남는다 — 귀책과 배송비 부담은 정산(M12)이 읽는 값이고, 산 사람이 데모였다는 것은 판 사람이 얼마를 물었는지를 지울 이유가 아니다 (TASK-0067)',
  ReturnPhoto:
    'ReturnDetail 에 Cascade 로 매달려 있다. **객체 자체는 이 계획이 지우지 않는다** — 버킷은 데이터베이스가 아니고, 고아 객체 청소는 상품 이미지와 같은 장치가 맡는다 (TASK-0033 F6)',
  ReturnShipment: 'ReturnDetail 에 Cascade 로 매달려 있다',
  ClaimAppeal:
    'ClaimRequest 에 Cascade 로 매달려 있다. 클레임이 남으므로 함께 남는다 — 「구매자가 이 거절에 이의를 냈고 관리자가 어떻게 답했나」는 분쟁의 근거이고, 산 사람이 데모였다는 이유로 지울 수 있는 기록이 아니다 (ClaimStatusHistory 와 같은 판단). `filedById` · `reviewedById` 가 `RESTRICT` 인데 계정 행이 툼스톤으로 남으므로 끊기지 않는다 (TASK-0071)',
  Coupon:
    '판매자·관리자가 만든 **정책**이고 지우지 않는다. 발급된 `UserCoupon` 이 `RESTRICT` 로 잡고, 정산(M12)이 「판매자 부담 쿠폰」을 이 행으로 읽는다. 데모 판매자가 낸 쿠폰이 살아남아도 그 가게는 정지되고 상품은 소프트 삭제되므로 적용될 대상이 없다. 데모 관리자가 낸 **플랫폼** 쿠폰은 그 논리가 통하지 않지만(가리키는 가게가 없다), `audience = DEMO` 라 실계정에는 발급되지 않으므로 남아 있어도 닿는 곳이 없다 — 그리고 `validUntil` 이 어차피 수명을 끊는다 (TASK-0072 · TASK-0073)',
  UserCoupon:
    '계정이 소유하지만 **지우지 않는다.** 쓴 쿠폰은 그 주문의 금액을 설명하는 기록이고(`pricing.md` 2장의 안분), 정산이 판매자 부담 쿠폰을 그것으로 센다 — 주문을 남기면서 그 주문의 할인만 지우면 남은 것은 설명되지 않는 금액이다. 안 쓴 장을 따로 지우려면 계획에 조건이 필요해지는데, 「표 · 방식 · 소유자」 세 칸으로 읽히는 것이 이 계획의 안전장치다. `userId` 가 `RESTRICT` 이고 계정 행은 툼스톤으로 남으므로 끊기지 않는다 (TASK-0072)',
  PointAccount:
    '계정이 소유하지만 **지우지 않는다.** 잔액이 있는 것은 원장을 두고, 그 원장이 이 계좌를 가리킨다 — 계좌를 지우면 「이 주문에 적립금이 왜 3,000원 붙었나」에 답할 것이 사라진다. 주문을 남기기로 한 판단(`Order`)과 같은 이유이고, `userId` 가 `RESTRICT` 이며 계정 행은 툼스톤으로 남으므로 끊기지 않는다 (TASK-0076)',
  PointTransaction:
    'PointAccount 에 매달려 있다. 사실상 append-only 이고(`PointTransaction_append_only`), 사라진 계정의 적립·사용 이력이 남는 것이 옳다 — `StockLedger` 와 같은 판단',
  PointPolicy: '계정 소유가 아니다. 플랫폼의 설정 한 행이다 (`AppMeta` 와 같다)',
  Settlement:
    '**판매자 몫이 남으므로 정산도 남는다.** 데모 판매자의 만료는 `SUSPENDED` 이지 삭제가 아니고(TASK-0025), 그 가게의 주문도 지우지 않는다 — 「이 가게에 얼마를 지급하기로 했나」는 산 사람이 데모였다는 이유로 지울 수 있는 기록이 아니라 **플랫폼 자신의 장부**다. `sellerId` 가 `RESTRICT` 이므로 스토어 행이 남는 지금 구조에서 끊기지도 않는다 (TASK-0080)',
  SettlementItem:
    'Settlement 에 Cascade 로 매달려 있다. `sellerOrderId` 는 `RESTRICT` 인데 주문 몫도 지우지 않으므로 끊기지 않는다',
  CommissionRate:
    '계정 소유가 아니다. 플랫폼이 정한 **수수료 정책**이고, 데모 관리자는 애초에 이 표를 쓸 수 없다(`commission.write` 가 없다). `createdById` 가 `RESTRICT` 인데 계정 행이 툼스톤으로 남으므로 끊기지 않는다 — 게다가 여기 남은 행을 만든 것은 실계정 최고 관리자뿐이다 (TASK-0079)',
}

/**
 * The step that removes rows before the ones that point at them.
 *
 * Answers `null` when the order is sound, or the pair that is wrong. Used by the
 * spec rather than at runtime: the plan is a constant, so this is a check of the
 * constant and not of a request.
 */
export function orderFault(
  plan: readonly CleanupStep[] = cleanupPlan,
): { readonly before: OwnedTable; readonly after: OwnedTable } | null {
  /** `table` must come before every table listed against it. */
  const dependsOn: Partial<Record<OwnedTable, readonly OwnedTable[]>> = {
    ProductVariant: ['Product'],
    ProductOption: ['Product'],
    Product: ['Seller'],
    Seller: ['User'],
    Cart: ['User'],
    StockReservation: ['User', 'ProductVariant'],
    VirtualCard: ['User'],
    RefreshToken: ['User'],
    UserPreference: ['User'],
    Address: ['User'],
    Review: ['User'],
    ReviewHelpful: ['User', 'Review'],
    UserRole: ['User'],
  }
  const position = new Map(plan.map((step, index) => [step.table, index]))

  for (const [table, parents] of Object.entries(dependsOn) as [
    OwnedTable,
    readonly OwnedTable[],
  ][]) {
    const own = position.get(table)

    if (own === undefined) continue

    for (const parent of parents) {
      const at = position.get(parent)

      if (at !== undefined && at < own) return { before: parent, after: table }
    }
  }

  return null
}
