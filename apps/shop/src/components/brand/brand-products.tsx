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
  const controller = useSearch({ sellerId })

  return <ResultBrowser controller={controller} messages={messages} />
}
