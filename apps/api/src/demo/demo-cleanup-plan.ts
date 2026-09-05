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
  'StockReservation',
  'RefreshToken',
  'UserPreference',
  'Address',
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
    table: 'StockReservation',
    kind: 'hard',
    scope: 'user',
    because:
      '잡아 둔 재고는 놓아 주어야 한다 — 계정이 사라지면 아무도 결제하지 않는다. `ProductVariant.reserved` 를 함께 되돌린다 (TASK-0048)',
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
  ProductOptionValue: 'ProductOption 에 매달려 있다',
  VariantOptionValue: 'ProductVariant 에 매달려 있다',
  Category: '공용이다. 데모 계정은 카테고리를 만들지 않는다',
  AttributeDefinition: '공용이다',
  AppMeta: '계정 소유가 아니다',
  SearchLog:
    '검색어 집계다. 계정을 적지 않으므로 소유자가 없다 — 그것이 이 표를 안전하게 만드는 이유다 (TASK-0039)',
  SearchOutbox:
    '큐다. 정리는 여기에 REMOVE 를 **넣는다** — 지우면 자기가 방금 한 일을 되돌린다 (TASK-0038)',
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
    RefreshToken: ['User'],
    UserPreference: ['User'],
    Address: ['User'],
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
