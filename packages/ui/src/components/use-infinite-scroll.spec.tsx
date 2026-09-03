/**
 * The sentinel hook, with a controllable `IntersectionObserver`.
 *
 * jsdom does not implement the API, which is itself one of the cases under test:
 * `supported` has to come back `false` so a list can render its "더 보기" button
 * instead of silently never loading page 2.
 *
 * The stub is not a polyfill — it is a hand crank. A real observer fires when
 * the browser decides to, and the behaviour worth testing is precisely *when the
 * hook does and does not react* to that.
 */

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useInfiniteScroll } from './use-infinite-scroll'

class FakeObserver {
  static instances: FakeObserver[] = []

  private readonly targets: Element[] = []

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.push(target)
  }

  unobserve(): void {
    this.targets.length = 0
  }

  disconnect(): void {
    this.targets.length = 0
  }

  get observing(): number {
    return this.targets.length
  }

  /** What the browser does when the sentinel scrolls in or out of view. */
  cross(isIntersecting: boolean): void {
    act(() => {
      this.callback(
        this.targets.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry),
        this as unknown as IntersectionObserver,
      )
    })
  }
}

function useFakeObserver(): typeof FakeObserver {
  FakeObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  return FakeObserver
}

function latest(): FakeObserver {
  const observer = FakeObserver.instances[FakeObserver.instances.length - 1]
  if (observer === undefined) throw new Error('No observer was created')
  return observer
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeObserver.instances = []
})

interface ListProps {
  readonly hasMore?: boolean
  readonly loading?: boolean
  readonly disabled?: boolean
  readonly onLoadMore: () => void
}

function List({ hasMore = true, loading = false, disabled = false, onLoadMore }: ListProps) {
  const { sentinelRef, supported } = useInfiniteScroll({ disabled, hasMore, loading, onLoadMore })

  return (
    <ul>
      <li>Product 01</li>
      <li aria-hidden="true" data-testid="sentinel" ref={sentinelRef} />
      <li>{supported ? 'observer' : 'fallback'}</li>
    </ul>
  )
}

describe('useInfiniteScroll without IntersectionObserver', () => {
  it('reports that it is unsupported instead of failing silently', () => {
    // jsdom has no observer, and neither does a server render.
    const onLoadMore = vi.fn()
    render(<List onLoadMore={onLoadMore} />)

    expect(screen.getByText('fallback')).toBeVisible()
    expect(onLoadMore).not.toHaveBeenCalled()
  })
})

describe('useInfiniteScroll', () => {
  it('loads the next page when the sentinel comes into view', () => {
    useFakeObserver()
    const onLoadMore = vi.fn()
    render(<List onLoadMore={onLoadMore} />)

    expect(screen.getByText('observer')).toBeVisible()
    expect(latest().observing).toBe(1)

    latest().cross(true)

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the sentinel leaves the viewport', () => {
    useFakeObserver()
    const onLoadMore = vi.fn()
    render(<List onLoadMore={onLoadMore} />)

    latest().cross(false)

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does not ask for a page that does not exist', () => {
    useFakeObserver()
    const onLoadMore = vi.fn()
    render(<List hasMore={false} onLoadMore={onLoadMore} />)

    latest().cross(true)

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('does not ask twice while a page is already in flight', () => {
    useFakeObserver()
    const onLoadMore = vi.fn()
    render(<List loading onLoadMore={onLoadMore} />)

    latest().cross(true)

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('honours being disabled', () => {
    useFakeObserver()
    const onLoadMore = vi.fn()
    render(<List disabled onLoadMore={onLoadMore} />)

    latest().cross(true)

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('re-arms when a page lands with the sentinel still on screen', () => {
    // The bug every hand-rolled infinite scroll has: an observer fires on a
    // *crossing*. A page shorter than the viewport never moves the sentinel, so
    // nothing fires again and the list stops with its end still visible.
    useFakeObserver()
    const onLoadMore = vi.fn()
    const { rerender } = render(<List loading onLoadMore={onLoadMore} />)

    latest().cross(true)
    expect(onLoadMore).not.toHaveBeenCalled()

    rerender(<List loading={false} onLoadMore={onLoadMore} />)

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not re-arm when the sentinel is off screen', () => {
    useFakeObserver()
    const onLoadMore = vi.fn()
    const { rerender } = render(<List loading onLoadMore={onLoadMore} />)

    latest().cross(false)
    rerender(<List loading={false} onLoadMore={onLoadMore} />)

    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('stops observing when the list unmounts', () => {
    useFakeObserver()
    const onLoadMore = vi.fn()
    const { unmount } = render(<List onLoadMore={onLoadMore} />)

    const observer = latest()
    expect(observer.observing).toBe(1)

    unmount()

    expect(observer.observing).toBe(0)
  })
})
