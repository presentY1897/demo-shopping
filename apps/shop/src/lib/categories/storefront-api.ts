import type { CategoryTreeResponse } from '@shopping/shared'

import { getPublicApiClient } from '@/lib/api'

/**
 * The storefront's category tree (TASK-0042 4.2).
 *
 * **No session**, so this is callable during a server render — which the
 * category page needs, because `docs/design/pages.md` has the page indexed and
 * SSR and a crawler runs no JavaScript.
 */
export function fetchStorefrontCategories(
  options: { readonly signal?: AbortSignal; readonly revalidate?: number } = {},
): Promise<CategoryTreeResponse> {
  return getPublicApiClient().getStorefrontCategoryTree(options)
}
