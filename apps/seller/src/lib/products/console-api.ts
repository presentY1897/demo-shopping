import type {
  ProductBulkStatusRequest,
  ProductBulkStatusResponse,
  ProductResponse,
  SellerProductListQuery,
  SellerProductListResponse,
  SellerVariantListResponse,
  StockAdjustRequest,
  StockAdjustResponse,
  StockLedgerQuery,
  StockLedgerResponse,
} from '@shopping/shared'
import {
  productBulkStatusResponseSchema,
  productResponseSchema,
  sellerProductListResponseSchema,
  sellerVariantListResponseSchema,
  stockAdjustResponseSchema,
  stockLedgerResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * The six console endpoints TASK-0115 built, in one place.
 *
 * **`ApiClient` has no methods for these.** It has one per endpoint for
 * everything the editor calls — `getProduct`, `updateProduct` — because a method
 * names the response schema once and leaves nothing for an app to redefine
 * (gate C1). TASK-0115 built the server half and added no client, so this module
 * is the generic `client.request({ path, schema })` seam used the same way, and
 * the property the methods would have had still holds: **the paths and the
 * schemas appear once**. Nothing here declares what a listing looks like.
 * `apps/admin/src/lib/sellers/api.ts` is the same file for the same reason.
 *
 * `packages/shared` is not this task's to change (2장 제외), so when the methods
 * arrive this file becomes six one-line delegations.
 */

/** `?status=ACTIVE&stock=low&…`, or empty when nothing is set. */
export function sellerProductSearch(query: SellerProductListQuery): string {
  const params = new URLSearchParams()

  if (query.status !== undefined) params.set('status', query.status)
  if (query.categoryId !== undefined) params.set('categoryId', String(query.categoryId))
  if (query.stock !== undefined) params.set('stock', query.stock)
  if (query.q !== undefined) params.set('q', query.q)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** One page of this store's listings. */
export function fetchSellerProducts(
  query: SellerProductListQuery,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerProductListResponse> {
  return getApiClient().request({
    path: `/seller/products${sellerProductSearch(query)}`,
    schema: sellerProductListResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/** One request, many listings — the whole point of the bulk control (F4). */
export function changeProductStatuses(
  body: ProductBulkStatusRequest,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProductBulkStatusResponse> {
  return getApiClient().request({
    path: '/seller/products/status',
    method: 'POST',
    body,
    schema: productBulkStatusResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/** The combinations of one listing, with the stock the console shows. */
export function fetchSellerVariants(
  productId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerVariantListResponse> {
  return getApiClient().request({
    path: `/seller/products/${productId}/variants`,
    schema: sellerVariantListResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/** Copies a listing. The answer is always a `DRAFT` (F6). */
export function duplicateProduct(
  productId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ProductResponse> {
  return getApiClient().request({
    path: `/seller/products/${productId}/duplicate`,
    method: 'POST',
    schema: productResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/**
 * Moves stock by a delta.
 *
 * There is no "set stock to" call, here or on the server. The screen cannot
 * know what the stock is at the instant the request lands — something may have
 * sold in between — so an absolute value would silently overwrite that sale
 * (4장 「조정량 UI」).
 */
export function adjustVariantStock(
  variantId: string,
  body: StockAdjustRequest,
  options: { readonly signal?: AbortSignal } = {},
): Promise<StockAdjustResponse> {
  return getApiClient().request({
    path: `/variants/${variantId}/stock-adjustments`,
    method: 'POST',
    body,
    schema: stockAdjustResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}

/** What explains the number (F7). */
export function fetchVariantLedger(
  variantId: string,
  query: StockLedgerQuery = {},
  options: { readonly signal?: AbortSignal } = {},
): Promise<StockLedgerResponse> {
  const params = new URLSearchParams()

  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', String(query.cursor))

  const search = params.toString()

  return getApiClient().request({
    path: `/variants/${variantId}/ledger${search === '' ? '' : `?${search}`}`,
    schema: stockLedgerResponseSchema,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}
