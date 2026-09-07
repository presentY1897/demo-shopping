'use client'

/**
 * 브랜드관의 상품 목록 (TASK-0044 F3).
 *
 * A brand page is a search with the store held down, exactly as a category page
 * is a search with the category held down — so it is `ResultBrowser`, the same
 * component both of those use, with `sellerId` pinned.
 *
 * Pinned rather than written into the query string for the same reason the
 * category is: the address already says the store, in the path.
 *
 * The pin is a **list of one** (TASK-0089 4.6). The filter grew a list so the
 * home page could hold down every followed store at once, and a brand page is
 * the same filter with one entry — not a second, single-store filter that would
 * have to be kept in step with this one.
 */

import { ResultBrowser } from '@/components/search/result-browser'
import { useSearch } from '@/lib/search/use-search'
import type { SearchMessages } from '@/messages'

export function BrandProducts({
  sellerId,
  messages,
}: {
  readonly sellerId: string
  readonly messages: SearchMessages
}) {
  const controller = useSearch({ sellerIds: [sellerId] })

  return <ResultBrowser controller={controller} messages={messages} />
}
