import type { ProductDetailResponse } from '@shopping/shared'

import { getPublicApiClient } from '@/lib/api'

/**
 * 상점이 보는 상품 상세 (TASK-0043 4.1).
 *
 * **No session**, so this is callable during a server render — which the detail
 * page needs: `docs/design/pages.md` has the page indexed, and a crawler runs no
 * JavaScript.
 */
export function fetchProductDetail(
  id: string,
  options: { readonly signal?: AbortSignal; readonly revalidate?: number } = {},
): Promise<ProductDetailResponse> {
  return getPublicApiClient().getStorefrontProduct(id, options)
}
