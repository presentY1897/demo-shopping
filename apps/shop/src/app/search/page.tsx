import { DEFAULT_DENSITY } from '@shopping/ui'
import { ProductListSkeleton } from '@shopping/ui/catalog'
import { PageContainer } from '@shopping/ui/layout'
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
 * static rendering, and this page's shell has nothing dynamic in it.
 *
 * **대기 화면은 결과가 올 자리만큼 자리를 잡는다** (TASK-0097 F2). 예전에는 한 줄
 * 짜리 글이었고, 그래서 첫 페인트에 바닥글이 화면 안(317px)에 보였다가 결과가
 * 도착하면서 4,300px 아래로 내려갔다 — 이 화면의 레이아웃 이동 0.366 이 그 한
 * 번이었다. 자리를 잡아 두면 바닥글은 처음부터 화면 밖이고, 그 뒤의 움직임은
 * 보이지 않는다.
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

/**
 * 결과가 올 자리.
 *
 * 밀도는 **기본값으로 그린다** — 이 대기 화면은 서버가 그리고, 이 방문자가 고른
 * 단계는 브라우저만 안다. 다른 단계를 쓰는 사람에게는 열 수가 한 번 바뀌지만 그것은
 * 하이드레이션 한 틱 동안이고, 바닥글은 그 사이 내내 화면 밖에 있다.
 */
function SearchFallback({ messages }: { readonly messages: ReturnType<typeof messagesFor> }) {
  return (
    <PageContainer className="flex flex-col gap-4 py-6">
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">{messages.search.title}</h1>
        <div
          aria-hidden="true"
          className="bg-surface-muted h-control-lg animate-pulse rounded-md"
        />
      </div>

      <ProductListSkeleton density={DEFAULT_DENSITY} label={messages.search.list.loading} />
    </PageContainer>
  )
}

export default function SearchPage() {
  const messages = messagesFor()

  return (
    <Suspense fallback={<SearchFallback messages={messages} />}>
      <SearchWorkspace boxMessages={messages.layout.search} messages={messages.search} />
    </Suspense>
  )
}
