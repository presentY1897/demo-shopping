import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/**
 * 계정 화면은 색인하지 않는다 (TASK-0102 4장).
 *
 * On the layout rather than on each page, so a screen added under `/mypage`
 * later inherits it — the failure this prevents is somebody's address book
 * appearing in a search result because a new route forgot one line.
 *
 * `robots.txt` disallows the path as well. Both, because either alone leaves a
 * gap: a crawler that ignores the disallow still meets this tag, and this tag on
 * a page nobody fetches does nothing.
 *
 * `follow: false` here, unlike the search screen: there is nothing behind a
 * sign-in worth crawling on to.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function MyPageLayout({ children }: { readonly children: ReactNode }) {
  return children
}
