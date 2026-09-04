import type {
  SellerDecisionRequest,
  SellerResponse,
  SellerReviewListQuery,
  SellerReviewListResponse,
} from '@shopping/shared'
import { sellerResponseSchema, sellerReviewListResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

import type { SellerDecision } from './decisions'

/**
 * The five review endpoints, in one place (TASK-0108 4장).
 *
 * **`ApiClient` has no seller methods.** Every other endpoint this console calls
 * has one — `getCategoryTree`, `getAttributes` — because a method per endpoint
 * names the response schema once and leaves nothing for an app to redefine
 * (gate C1). TASK-0108 built the server half and never needed a client, so it
 * added none; its own integration spec reaches the same routes through the
 * generic `client.request({ path, schema })`
 * (`apps/api/test/api/sellers.integration.spec.ts`).
 *
 * This module is that seam used the same way, gathered so the property the
 * methods would have had still holds: **the paths and the schemas appear once**,
 * and every response type is `@shopping/shared`'s. Nothing here declares what a
 * seller looks like. When the methods exist, this file becomes four one-line
 * delegations — and `packages/shared` is not this task's to change
 * (TASK-0110 4장 「이음매」).
 */

/** `?status=PENDING&cursor=…&limit=20`, or empty when nothing is set. */
function reviewListSearch(query: SellerReviewListQuery): string {
  const params = new URLSearchParams()

  if (query.status !== undefined) params.set('status', query.status)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** One page of the review queue, newest first. */
export function fetchSellerReviews(
  query: SellerReviewListQuery,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerReviewListResponse> {
  return getApiClient().request({
    path: `/admin/sellers${reviewListSearch(query)}`,
    schema: sellerReviewListResponseSchema,
    ...options,
  })
}

/** One application, for the detail screen. */
export function fetchSellerReview(
  id: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerResponse> {
  return getApiClient().request({
    path: `/admin/sellers/${id}`,
    schema: sellerResponseSchema,
    ...options,
  })
}

/**
 * 승인 · 반려 · 정지 · 해제, which differ only in the last path segment.
 *
 * One function rather than four: the request body, the response and every
 * failure are identical, and four copies would be four places to forget
 * `version` — the field that makes two operators clicking at once resolve to one
 * winner (TASK-0108 F13).
 */
export function decideSellerReview(
  id: string,
  decision: SellerDecision,
  body: SellerDecisionRequest,
): Promise<SellerResponse> {
  return getApiClient().request({
    path: `/admin/sellers/${id}/${decision}`,
    method: 'POST',
    body,
    schema: sellerResponseSchema,
  })
}
