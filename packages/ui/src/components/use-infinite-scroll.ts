'use client'

/**
 * "Load the next page when the end of the list comes into view."
 *
 * A hook rather than a component because the sentinel belongs *inside* the
 * caller's list markup — a wrapper element between a `<ul>` and its `<li>`s is
 * invalid HTML and breaks the list semantics a screen reader counts.
 *
 * **There is no `rootMargin`.** Prefetch distance is expressed by *where the
 * caller puts the sentinel* — before the last row rather than after it — which
 * is a decision the list can make with the rows in hand. The alternative would
 * be a `rootMargin: '200px'` prop, and a pixel string passed from an app is
 * exactly the hardcoded length `test/component-tokens.spec.ts` exists to reject.
 *
 * **`supported` is not decoration.** `IntersectionObserver` is absent during
 * server rendering and in a jsdom test, and a list that silently never loads its
 * second page is very hard to notice. Callers render a "더 보기" button while it
 * is `false`, which doubles as the keyboard path (QUALITY-GATES U5): infinite
 * scroll on its own cannot be operated without scrolling.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

export interface UseInfiniteScrollOptions {
  /** Whether the server said there is another page. */
  readonly hasMore: boolean
  /** A page is already in flight; do not ask for another. */
  readonly loading: boolean
  readonly onLoadMore: () => void
  /** Suspends the observer without unmounting the list — a filter panel is open, say. */
  readonly disabled?: boolean
}

export interface InfiniteScroll {
  /** Attach to the sentinel: `<li ref={sentinelRef} aria-hidden="true" />`. */
  readonly sentinelRef: (node: HTMLElement | null) => void
  /** `false` on the server, in jsdom, and in a browser without the API. */
  readonly supported: boolean
}

/**
 * `IntersectionObserver` is a static fact about the environment, not state, so
 * it is read through `useSyncExternalStore` with a subscription that never
 * fires. That is the one hook that can answer "false on the server, true in the
 * browser" without a hydration mismatch and without a `setState` in an effect.
 */
const neverChanges = () => () => undefined
const observerIsAvailable = () => typeof IntersectionObserver !== 'undefined'
const notOnTheServer = () => false

export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  disabled = false,
}: UseInfiniteScrollOptions): InfiniteScroll {
  // State, not a ref: the observer has to be re-created when the sentinel node
  // changes, and a ref assignment does not re-run an effect.
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null)
  const supported = useSyncExternalStore(neverChanges, observerIsAvailable, notOnTheServer)

  const intersecting = useRef(false)
  const loadMore = useRef(onLoadMore)
  const armed = useRef(false)

  const active = hasMore && !loading && !disabled

  useEffect(() => {
    loadMore.current = onLoadMore
  }, [onLoadMore])

  useEffect(() => {
    armed.current = active
  }, [active])

  useEffect(() => {
    if (sentinel === null || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry === undefined) return
      intersecting.current = entry.isIntersecting
      if (entry.isIntersecting && armed.current) loadMore.current()
    })

    observer.observe(sentinel)
    return () => {
      observer.disconnect()
    }
  }, [sentinel])

  /**
   * Re-arms after a page lands.
   *
   * An observer fires on a *crossing*, not on a state. When the page that just
   * arrived is shorter than the viewport the sentinel never left it, so no
   * crossing happens and the list stops one page short with the end of it still
   * on screen. This is the check for that case, and it is the bug every
   * hand-rolled infinite scroll has.
   */
  useEffect(() => {
    if (active && intersecting.current) loadMore.current()
  }, [active])

  return { sentinelRef: setSentinel, supported }
}
