import type { SearchQuery, SearchResponse } from '@shopping/shared'
import { searchResponseSchema } from '@shopping/shared'

import { getPublicApiClient } from '@/lib/api'
import { writeSearchParams } from '@/lib/search/search-params'

/**
 * 홈과 브랜드관의 목록 — 검색 API 를 그대로 부른다 (TASK-0044 4.1).
 *
 * **No new endpoint.** 신상품 is `sort=newest`, 인기 is `sort=sales`, a brand page is
 * `sellerIds=<one>` and 「팔로우한 브랜드의 신상품」 is `sellerIds=<many>&sort=newest`
 * — all of them are the search this repository already has, and TASK-0039
 * measured that path. A second endpoint would mean the same query under two
 * names, and 「신상품」 defined in two places (TASK-0089 4.5).
 *
 * Public, so a server render can call it: the home page and the brand page are
 * both indexed, and a crawler runs no JavaScript.
 */
export function fetchSection(
  query: SearchQuery,
  options: { readonly signal?: AbortSignal; readonly revalidate?: number } = {},
): Promise<SearchResponse> {
  const search = writeSearchParams(query)
  const params = new URLSearchParams(search)

  // `writeSearchParams` writes what a person may share — the stores included,
  // since 「이 가게들의 신상품」 is a link worth sharing. `limit` is this call's
  // own business and is the only thing added here.
  if (query.limit !== undefined) params.set('limit', String(query.limit))

  return getPublicApiClient().request({
    path: `/search?${params.toString()}`,
    schema: searchResponseSchema,
    ...options,
  })
}
