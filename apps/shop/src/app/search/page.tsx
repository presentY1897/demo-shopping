import type { Metadata } from 'next'
import { Suspense } from 'react'

import { SearchWorkspace } from '@/components/search/search-workspace'
import { hiddenMetadata } from '@/lib/seo/page-metadata'
import { messagesFor } from '@/messages'

/**
 * 검색 결과 화면 (TASK-0041).
 *
 * The screen reads the query string with `useSearchParams`, which Next requires
 * to sit under a `Suspense` boundary — without one the whole route opts out of
 * static rendering, and this page's shell has nothing dynamic in it. The
 * fallback is the same skeleton the workspace shows while its first search is in
 * flight, so the boundary is invisible.
 *
 * Copy is resolved here, on the server, and handed down. The workspace is a
 * client component and importing the catalog from inside it would ship every
 * screen's Korean to the browser.
 */
/**
 * 검색 결과는 색인하지 않는다 (TASK-0102 4장).
 *
 * The query string is unbounded — every word anybody ever searches for is a
 * different address for a page whose content is somebody else's catalogue. What
 * is worth indexing is the categories and the products, and both are in the
 * sitemap.
 *
 * `follow` stays on: the product links here are worth crawling even though the
 * page around them is not.
 */
export const metadata: Metadata = hiddenMetadata({
  title: messagesFor().search.title,
  description: messagesFor().search.promptBody,
})

export default function SearchPage() {
  const messages = messagesFor()

  return (
    <Suspense
      fallback={
        <p className="p-6 text-sm" role="status">
          {messages.search.list.loading}
        </p>
      }
    >
      <SearchWorkspace boxMessages={messages.layout.search} messages={messages.search} />
    </Suspense>
  )
}
