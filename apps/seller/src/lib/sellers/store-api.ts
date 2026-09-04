import type {
  BrandNameAvailabilityResponse,
  SellerApplicationRequest,
  SellerResponse,
  SellerStoreUpdateRequest,
} from '@shopping/shared'
import { brandNameAvailabilityResponseSchema, sellerResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * The four calls this console makes about its own store (TASK-0108
 * `SellerController`).
 *
 * **`request` rather than named client methods.** `ApiClient` has
 * `getCategoryTree`, `createProduct` and the rest, and no seller equivalents;
 * adding them would mean editing `packages/shared`, which TASK-0109 does not
 * own. Nothing is lost by going through the generic entry point — it parses the
 * response with the schema it is handed, so a payload that drifted from
 * `sellerSchema` still arrives as `malformed_response` rather than reaching a
 * screen — and the schemas are the contract's own (gate C1). Named methods
 * belong to whoever owns the contract; TASK-0109 9장 reports it.
 *
 * The paths are written once here rather than at each call site, because
 * `/sellers/me` answering both `GET` and `PATCH` is exactly the pair a typo
 * would split.
 */

const OWN_STORE = '/sellers/me'
const APPLICATIONS = '/sellers/applications'
const BRAND_NAME_AVAILABILITY = '/sellers/brand-name-availability'

/**
 * The caller's store, whatever state it is in.
 *
 * **A 404 is an answer, not a failure**: `SellerService.ownStore` throws
 * `NotFoundException` when the account has never applied, which is one of the
 * five faces this console draws. The caller tells them apart; this function
 * only refuses to hide it.
 */
export function fetchOwnStore(signal?: AbortSignal): Promise<SellerResponse> {
  return getApiClient().request({
    path: OWN_STORE,
    schema: sellerResponseSchema,
    ...(signal === undefined ? {} : { signal }),
  })
}

/** Applies, and applies again after a rejection. The whole form both times. */
export function submitApplication(body: SellerApplicationRequest): Promise<SellerResponse> {
  return getApiClient().request({
    path: APPLICATIONS,
    schema: sellerResponseSchema,
    method: 'POST',
    body,
  })
}

/** Brand name, introduction and logo. Never the slug (TASK-0108 R4). */
export function saveOwnStore(body: SellerStoreUpdateRequest): Promise<SellerResponse> {
  return getApiClient().request({
    path: OWN_STORE,
    schema: sellerResponseSchema,
    method: 'PATCH',
    body,
  })
}

/**
 * Whether a brand name is free **at the moment of asking**.
 *
 * A convenience for the form and never the decision — the answer is a read and
 * `Seller_brandName_key` is what actually refuses a duplicate. The form treats
 * a `false` as a reason to stop, and a `true` as no promise at all.
 */
export function checkBrandName(
  value: string,
  signal?: AbortSignal,
): Promise<BrandNameAvailabilityResponse> {
  return getApiClient().request({
    path: `${BRAND_NAME_AVAILABILITY}?value=${encodeURIComponent(value)}`,
    schema: brandNameAvailabilityResponseSchema,
    ...(signal === undefined ? {} : { signal }),
  })
}
