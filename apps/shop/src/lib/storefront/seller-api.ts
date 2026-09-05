import type { StorefrontSellerResponse } from '@shopping/shared'

import { getPublicApiClient } from '@/lib/api'

/**
 * 브랜드관의 머리 (TASK-0044 4.2).
 *
 * `ACTIVE` only — anything else is a 404 from the API, which the page turns into
 * the route's own 404. No session, so a server render can call it.
 */
export function fetchStorefrontSeller(
  id: string,
  options: { readonly signal?: AbortSignal; readonly revalidate?: number } = {},
): Promise<StorefrontSellerResponse> {
  return getPublicApiClient().getStorefrontSeller(id, options)
}
