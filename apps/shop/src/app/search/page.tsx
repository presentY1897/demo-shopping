import { Suspense } from 'react'

import { SearchWorkspace } from '@/components/search/search-workspace'
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
