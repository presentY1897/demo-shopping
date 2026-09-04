import type { SellerProductListItem, SellerVariant, StockLedgerEntry } from '@shopping/shared'
import {
  LOW_STOCK_THRESHOLD,
  sellerProductListItemSchema,
  sellerVariantSchema,
  stockLedgerEntrySchema,
} from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * The seller console's catalogue, as the mock API holds it (TASK-0116).
 *
 * **This lives beside the handler, not in `src/fixtures/`.** That directory is
 * the C2 registry and `registry.spec.ts` requires every export in it to be a
 * branded `defineFixture` value — which is right: the registry's job is to prove
 * each *payload* parses. A hundred listings are not a payload, they are a
 * generator, and the representative payloads it produces are registered from
 * `fixtures/seller-console.ts` instead.
 *
 * **A hundred listings, and that number is a completion criterion.** F5 asks
 * that paging through 100 rows produces no duplicate and no gap, which is a
 * property of the *cursor*, not of the screen — and a fixture of twelve rows
 * cannot fail it. Everything here is derived from the index so a spec can name
 * a row rather than search for one.
 *
 * **The stock values are chosen, not random.** F10 pins the 품절 임박 badge to
 * `LOW_STOCK_THRESHOLD` rather than to a number typed into the screen, so the
 * catalogue contains a listing at exactly the threshold and one just above it,
 * and the spec asserts the badge flips between them. If the constant moves, the
 * fixture moves with it and the assertion still describes the rule.
 */

/** Deterministic uuids: the prefix says what it is, the tail says which one. */
function id(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`
}

export function productId(index: number): string {
  return id('1e5c0000', index)
}

export function variantId(index: number): string {
  return id('2a710000', index)
}

/** How many listings the console's store has. */
export const SELLER_PRODUCT_COUNT = 100

/** The six categories the fixtures file listings under. */
export const SELLER_CATEGORY_IDS = [11, 12, 13, 14, 15, 16] as const

/**
 * Stock for listing `index`.
 *
 * Three of them are placed by hand because three checks depend on them:
 *
 * | index | stock | why |
 * | --- | --- | --- |
 * | 0 | 0 | 품절 — the badge, and the "cannot go lower" adjustment (F9) |
 * | 1 | `LOW_STOCK_THRESHOLD` | 임박 배지가 **켜지는** 경계 (F10) |
 * | 2 | `LOW_STOCK_THRESHOLD + 1` | 임박 배지가 **꺼지는** 경계 (F10) |
 *
 * The rest spread from 12 to 300 so a total-stock column has something to show.
 */
function stockFor(index: number): number {
  if (index === 0) return 0
  if (index === 1) return LOW_STOCK_THRESHOLD
  if (index === 2) return LOW_STOCK_THRESHOLD + 1

  return 12 + ((index * 17) % 289)
}

function statusFor(index: number): SellerProductListItem['status'] {
  // Every fourth listing is a draft, so the status filter has both answers on
  // the first page rather than only after paging.
  return index % 4 === 3 ? 'DRAFT' : 'ACTIVE'
}

function nameFor(index: number): string {
  return `데일리 코튼 티셔츠 ${String(index + 1).padStart(3, '0')}`
}

/** One row of the list, exactly as `GET /seller/products` answers it. */
export function sellerProductListItem(index: number): SellerProductListItem {
  const totalStock = stockFor(index)

  return defineFixture(sellerProductListItemSchema, {
    id: productId(index),
    name: nameFor(index),
    status: statusFor(index),
    categoryId: SELLER_CATEGORY_IDS[index % SELLER_CATEGORY_IDS.length] ?? 11,
    totalStock,
    minPrice: 19_900 + (index % 20) * 3_000,
    // The server decides this, not the screen — `0 < totalStock <= threshold`.
    isLowStock: totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD,
    thumbnailUrl: null,
  })
}

/** The whole catalogue, in the order the API returns it (id ascending). */
export const sellerProductCatalogue: readonly SellerProductListItem[] = Array.from(
  { length: SELLER_PRODUCT_COUNT },
  (_unused, index) => sellerProductListItem(index),
)

/**
 * The combinations of one listing.
 *
 * Two axes on the first listing and one on the rest: the stock screen has to
 * render a compound `optionLabel` ("블랙 / M") without the fixture making every
 * screen carry six rows.
 */
export function sellerVariants(productIndex: number): readonly SellerVariant[] {
  const total = stockFor(productIndex)
  const labels =
    productIndex === 0 ? ['블랙 / M', '블랙 / L', '아이보리 / M'] : ['블랙', '아이보리']

  return labels.map((optionLabel, offset) => {
    // The listing's total is split across its combinations, so the stock screen
    // and the list column cannot disagree — which is exactly the drift R2 warns
    // about after an adjustment.
    const share = Math.floor(total / labels.length) + (offset < total % labels.length ? 1 : 0)

    return defineFixture(sellerVariantSchema, {
      id: variantId(productIndex * 10 + offset),
      sku: `SEED${String(productIndex).padStart(4, '0')}-${String(offset + 1)}`,
      optionLabel,
      stock: share,
      isLowStock: share > 0 && share <= LOW_STOCK_THRESHOLD,
      maxPurchaseQuantity: null,
      isActive: true,
    })
  })
}

/** The opening `INBOUND`, which every variant has because every variant was born. */
export function openingEntry(quantity: number): StockLedgerEntry {
  return defineFixture(stockLedgerEntrySchema, {
    seq: 1,
    type: 'INBOUND',
    quantity,
    balanceAfter: quantity,
    refType: null,
    refId: null,
    reason: '상품 등록 초기 재고',
    actorId: null,
    createdAt: '2026-09-01T00:00:00.000Z',
  })
}
