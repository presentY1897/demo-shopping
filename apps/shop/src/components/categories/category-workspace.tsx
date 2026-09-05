'use client'

/**
 * 카테고리 화면의 목록 — 검색 화면과 **같은 컴포넌트** (TASK-0042 F3).
 *
 * The whole of this file is: hold the category down, and hand the rest to
 * {@link ResultBrowser}. That is the design 4장 states — 「검색 API 에
 * `categoryId` 를 고정한 것」 — written as code rather than described.
 *
 * The category is pinned into the controller instead of being written into the
 * query string, because the address already says it once, in the path. Two
 * copies of the same fact in one URL is two things that can disagree.
 */

import { useSearch } from '@/lib/search/use-search'
import type { SearchMessages } from '@/messages'

import { ResultBrowser } from '@/components/search/result-browser'

export function CategoryWorkspace({
  categoryId,
  messages,
}: {
  readonly categoryId: number
  readonly messages: SearchMessages
}) {
  const controller = useSearch({ categoryId })

  return <ResultBrowser controller={controller} messages={messages} />
}
