'use client'

/**
 * 검색 화면 (TASK-0041).
 *
 * What is left here after TASK-0042 is what is *particular to searching*: the
 * box, the heading that quotes the term, and the state before anything has been
 * asked for. Everything below the heading — filters, sort, chips, results — is
 * {@link ResultBrowser}, shared with the category screen so that F3 「검색
 * 페이지와 동일한 필터 동작」 is one component rather than two that agree today.
 *
 * The screen holds no filter state: `useSearch` reads the query from the address
 * bar on every render and every control hands it a new one.
 */

import { PageContainer } from '@shopping/ui/layout'

import { useSearch } from '@/lib/search/use-search'
import type { SearchMessages, SearchSlotMessages } from '@/messages'

import { ResultBrowser } from './result-browser'
import { SearchBox } from './search-box'

export interface SearchWorkspaceProps {
  readonly messages: SearchMessages
  /** The header's own copy, reused so the page's box says the same words. */
  readonly boxMessages: SearchSlotMessages
}

export function SearchWorkspace({ messages, boxMessages }: SearchWorkspaceProps) {
  const controller = useSearch()
  const { query, setQuery } = controller

  const term = query.q ?? ''
  const searched = term !== '' || query.categoryId !== undefined

  return (
    <PageContainer className="flex flex-col gap-4 py-6">
      {/*
        A `div`, not a `header`. A `<header>` that is not inside an `article` or a
        `section` is a `banner` landmark, and this app already has one — the site
        header in `app/layout.tsx`. Two banners is what axe fails the page on, and
        the failure is right: a screen reader's landmark list would offer 「배너」
        twice and neither would be the one with the navigation in it.
      */}
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">
          {term === '' ? messages.title : messages.titleFor.replace('{term}', term)}
        </h1>

        <SearchBox
          className="w-full"
          defaultValue={term}
          messages={boxMessages}
          onSearch={(next) => {
            // The filters survive a re-search from this screen: they are on
            // screen as chips, and dropping what somebody can still see would
            // read as the page losing track rather than as a fresh start.
            setQuery({ ...query, q: next === '' ? undefined : next })
          }}
        />
      </div>

      {searched ? (
        <ResultBrowser controller={controller} messages={messages} />
      ) : (
        <section className="flex flex-col gap-1 py-10 text-center">
          <h2 className="text-lg font-semibold">{messages.promptTitle}</h2>
          <p className="text-fg-muted text-sm">{messages.promptBody}</p>
        </section>
      )}
    </PageContainer>
  )
}
