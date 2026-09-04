import {
  productBulkStatusResponseSchema,
  sellerProductListItemSchema,
  sellerProductListResponseSchema,
  sellerVariantListResponseSchema,
  stockAdjustResponseSchema,
  stockLedgerEntrySchema,
  stockLedgerResponseSchema,
} from '@shopping/shared'

import { defineFixture } from '../define'
import {
  openingEntry,
  sellerProductListItem,
  sellerVariants,
  variantId,
} from '../handlers/seller-console-catalogue'

/**
 * One representative payload per seller-console endpoint (C2).
 *
 * The registry walks this directory and parses everything in it, so these exist
 * to make each of TASK-0115's six response shapes a checked payload rather than
 * a shape only the handler ever builds. The handler's own bodies go through
 * `defineFixture` too — this is the second half of the same guarantee, and the
 * half that fails when a schema changes and nobody has run the screen.
 *
 * The catalogue that backs the handler is a generator and lives beside it; see
 * `handlers/seller-console-catalogue.ts` for why it is not here.
 */

/** One row of `GET /seller/products`. */
export const sellerProductRow = sellerProductListItem(0)

/** A page of the list, as the console's first load receives it. */
export const sellerProductPage = defineFixture(sellerProductListResponseSchema, {
  items: [sellerProductListItem(0), sellerProductListItem(1), sellerProductListItem(2)],
  nextCursor: sellerProductListItem(2).id,
})

/** What a bulk status change answers with (F4). */
export const sellerProductBulkResult = defineFixture(productBulkStatusResponseSchema, {
  items: [defineFixture(sellerProductListItemSchema, { ...sellerProductRow, status: 'DRAFT' })],
})

/** The stock screen's rows. */
export const sellerVariantList = defineFixture(sellerVariantListResponseSchema, {
  variants: [...sellerVariants(0)],
})

/** One accepted adjustment (F2). */
export const stockAdjustment = defineFixture(stockAdjustResponseSchema, {
  variantId: variantId(0),
  delta: 5,
  balanceAfter: 17,
  seq: 2,
})

/** The history behind one combination (F7). */
export const stockLedgerPage = defineFixture(stockLedgerResponseSchema, {
  variant: {
    variantId: variantId(0),
    sku: 'SEED0000-1',
    stock: 17,
    ledgerBalance: 17,
    entryCount: 2,
  },
  entries: [
    defineFixture(stockLedgerEntrySchema, {
      seq: 2,
      type: 'ADJUST',
      quantity: 5,
      balanceAfter: 17,
      refType: null,
      refId: null,
      reason: '입고',
      actorId: null,
      createdAt: '2026-09-05T00:00:02.000Z',
    }),
    openingEntry(12),
  ],
  nextCursor: null,
})
