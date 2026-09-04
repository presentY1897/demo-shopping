import type { SellerProductListItem, SellerVariant, StockLedgerEntry } from '@shopping/shared'
import {
  LOW_STOCK_THRESHOLD,
  PRODUCT_LIST_DEFAULT_LIMIT,
  productBulkStatusRequestSchema,
  productBulkStatusResponseSchema,
  sellerProductListItemSchema,
  sellerProductListQueryParamsSchema,
  sellerProductListResponseSchema,
  sellerVariantListResponseSchema,
  stockAdjustRequestSchema,
  stockAdjustResponseSchema,
  stockLedgerEntrySchema,
  productResponseSchema,
  stockLedgerResponseSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { productWithOptions as duplicableProduct } from '../fixtures/products'
import {
  openingEntry,
  productId,
  sellerProductCatalogue,
  sellerVariants,
  variantId,
} from './seller-console-catalogue'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'

/**
 * The seller console's list, bulk change, variants, duplication and stock
 * adjustment (TASK-0115's endpoints, as TASK-0116's screens see them).
 *
 * **Stateful, because every question this screen asks is about state.** Does
 * paging 100 rows repeat one (F5)? Does adjusting `+5` leave 17 (F2)? Does a
 * bulk change of five ids come back as five changed rows (F4)? Does an
 * adjustment that would go below zero get refused *and leave the list alone*
 * (F9)? A frozen fixture answers none of them, and a screen tested against one
 * would pass while doing the wrong thing.
 *
 * What is reproduced is only what a screen can observe over HTTP:
 *
 * | invariant | how the real API enforces it |
 * | --- | --- |
 * | keyset paging by id | `WHERE id > cursor ORDER BY id LIMIT n + 1` |
 * | stock never goes below zero | `nextBalance` answers `null`, the service 400s |
 * | 임박 배지는 서버가 정한다 | `isLowStock` is computed server-side, not in the row |
 * | 조정은 원장을 지난다 | `StockService.apply` writes the entry that explains it |
 *
 * **Every body goes through `defineFixture`**, so a payload that drifted from
 * the shared schema fails here rather than in the screen it would mislead (C2).
 */

/** A row of the mutable catalogue: the list item plus what hangs off it. */
interface ProductRow {
  item: SellerProductListItem
  variants: SellerVariant[]
  ledger: Map<string, StockLedgerEntry[]>
}

let rows: ProductRow[] = []

/** Rebuilds the store from the fixtures. Called by `setupTestServer`'s reset. */
export function resetSellerConsoleStore(): void {
  rows = sellerProductCatalogue.map((item, index) => {
    const variants = [...sellerVariants(index)]
    const ledger = new Map<string, StockLedgerEntry[]>(
      variants.map((variant) => [variant.id, [openingEntry(variant.stock)]]),
    )

    return { item, variants, ledger }
  })
}

resetSellerConsoleStore()

/** What the store currently holds — for a spec to assert against. */
export function sellerConsoleSnapshot(): readonly SellerProductListItem[] {
  return rows.map((row) => row.item)
}

/** Forces the next adjustment to fail, whatever it is (U6). */
let nextAdjustFailure: MockApiError | null = null

export function failNextStockAdjustment(error?: MockApiError): void {
  nextAdjustFailure = error ?? new MockApiError(500, '재고를 조정하지 못했습니다.')
}

function rowOf(id: string): ProductRow {
  const row = rows.find((candidate) => candidate.item.id === id)

  if (row === undefined) throw new MockApiError(404, '상품을 찾을 수 없습니다.')

  return row
}

function variantRow(id: string): { row: ProductRow; variant: SellerVariant } {
  for (const row of rows) {
    const variant = row.variants.find((candidate) => candidate.id === id)

    if (variant !== undefined) return { row, variant }
  }

  throw new MockApiError(404, '옵션 조합을 찾을 수 없습니다.')
}

/** The listing's total, recomputed from its combinations after every change. */
function retotal(row: ProductRow): void {
  const totalStock = row.variants.reduce((sum, variant) => sum + variant.stock, 0)

  row.item = defineFixture(sellerProductListItemSchema, {
    ...row.item,
    totalStock,
    isLowStock: totalStock > 0 && totalStock <= LOW_STOCK_THRESHOLD,
  })
}

export const sellerConsoleHandlers: readonly RequestHandler[] = [
  /** `GET /seller/products` — one page, filtered. */
  http.get(mockPaths.sellerProducts, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = sellerProductListQueryParamsSchema.parse(
        Object.fromEntries(url.searchParams.entries()),
      )
      const limit = query.limit ?? PRODUCT_LIST_DEFAULT_LIMIT
      const matches = rows
        .map((row) => row.item)
        .filter((item) => query.status === undefined || item.status === query.status)
        .filter((item) => query.categoryId === undefined || item.categoryId === query.categoryId)
        .filter((item) => query.stock === undefined || matchesStock(item, query.stock))
        .filter((item) => query.q === undefined || item.name.includes(query.q))

      // Keyset, not offset: the cursor is the last id of the previous page and
      // the API answers what comes *after* it. An offset would renumber every
      // later row the moment one is filtered out, which is the duplicate F5
      // exists to catch.
      const after =
        query.cursor === undefined ? 0 : matches.findIndex((item) => item.id === query.cursor) + 1
      const page = matches.slice(after, after + limit)
      const nextCursor = after + limit < matches.length ? (page[page.length - 1]?.id ?? null) : null

      return HttpResponse.json(
        defineFixture(sellerProductListResponseSchema, { items: page, nextCursor }),
      )
    }),
  ),

  /** `POST /seller/products/status` — one request, many listings (F4). */
  http.post(mockPaths.sellerProductStatus, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, productBulkStatusRequestSchema)
      const changed = body.productIds.map((id) => {
        const row = rowOf(id)

        row.item = defineFixture(sellerProductListItemSchema, {
          ...row.item,
          status: body.status,
        })

        return row.item
      })

      return HttpResponse.json(defineFixture(productBulkStatusResponseSchema, { items: changed }))
    }),
  ),

  /** `GET /seller/products/:id/variants` — the stock screen's rows. */
  http.get(mockPaths.sellerProductVariants, ({ params }) =>
    answering(() => {
      const row = rowOf(String(params.id))

      return HttpResponse.json(
        defineFixture(sellerVariantListResponseSchema, { variants: row.variants }),
      )
    }),
  ),

  /** `GET /variants/:id/ledger` — what explains the number (F7). */
  http.get(mockPaths.variantLedger, ({ params }) =>
    answering(() => {
      const { variant, row } = variantRow(String(params.id))
      const entries = [...(row.ledger.get(variant.id) ?? [])].sort((a, b) => b.seq - a.seq)

      return HttpResponse.json(
        defineFixture(stockLedgerResponseSchema, {
          variant: {
            variantId: variant.id,
            sku: variant.sku,
            stock: variant.stock,
            ledgerBalance: variant.stock,
            entryCount: entries.length,
          },
          entries,
          nextCursor: null,
        }),
      )
    }),
  ),

  /** `POST /variants/:id/stock-adjustments` — the only way stock moves (F2 · F9). */
  http.post(mockPaths.variantStockAdjust, ({ request, params }) =>
    answering(async () => {
      const body = await readBody(request, stockAdjustRequestSchema)
      const { variant, row } = variantRow(String(params.id))

      if (nextAdjustFailure !== null) {
        const failure = nextAdjustFailure
        nextAdjustFailure = null
        throw failure
      }

      const balanceAfter = variant.stock + body.delta

      // The real service asks `nextBalance` and refuses when it answers `null`.
      // The screen cannot make this judgement — only the server knows the stock
      // at the moment the request lands, which is the whole argument for a delta
      // rather than an absolute value.
      if (balanceAfter < 0) {
        throw new MockApiError(400, '재고가 부족해 조정할 수 없습니다.', {
          field: 'delta',
          code: 'INVALID',
        })
      }

      const entries = row.ledger.get(variant.id) ?? []
      const seq = entries.length + 1
      const entry = defineFixture(stockLedgerEntrySchema, {
        seq,
        type: body.type,
        quantity: body.delta,
        balanceAfter,
        refType: null,
        refId: null,
        reason: body.reason ?? null,
        actorId: null,
        createdAt: new Date(Date.UTC(2026, 8, 5, 0, 0, seq)).toISOString(),
      })

      entries.push(entry)
      row.ledger.set(variant.id, entries)
      row.variants = row.variants.map((candidate) =>
        candidate.id === variant.id
          ? {
              ...candidate,
              stock: balanceAfter,
              isLowStock: balanceAfter > 0 && balanceAfter <= LOW_STOCK_THRESHOLD,
            }
          : candidate,
      )
      retotal(row)

      return HttpResponse.json(
        defineFixture(stockAdjustResponseSchema, {
          variantId: variant.id,
          delta: body.delta,
          balanceAfter,
          seq,
        }),
        { status: 201 },
      )
    }),
  ),

  /** `POST /seller/products/:id/duplicate` — a copy, always a draft (F6). */
  http.post(mockPaths.sellerProductDuplicate, ({ params }) =>
    answering(() => {
      const source = rowOf(String(params.id))
      const index = rows.length
      const copy: ProductRow = {
        item: defineFixture(sellerProductListItemSchema, {
          ...source.item,
          id: productId(index),
          name: `${source.item.name} (복사본)`,
          // The copy is never on sale, whatever the original was. That is the
          // API's rule, and the screen has to say so before the click — a copy
          // that quietly went live would publish an unedited listing.
          status: 'DRAFT',
        }),
        variants: source.variants.map((variant, offset) => ({
          ...variant,
          id: variantId(index * 10 + offset),
          sku: `${variant.sku}-C`,
        })),
        ledger: new Map(),
      }

      for (const variant of copy.variants) {
        copy.ledger.set(variant.id, [openingEntry(variant.stock)])
      }

      rows.push(copy)

      return HttpResponse.json(
        defineFixture(productResponseSchema, {
          product: {
            ...duplicableProduct.product,
            id: copy.item.id,
            name: copy.item.name,
            status: 'DRAFT',
            categoryId: copy.item.categoryId,
            minPrice: copy.item.minPrice,
          },
        }),
      )
    }),
  ),
]

/** `out` and `low` mean what the server means by them, not what a screen guesses. */
function matchesStock(item: SellerProductListItem, filter: 'out' | 'low'): boolean {
  return filter === 'out' ? item.totalStock === 0 : item.isLowStock
}
