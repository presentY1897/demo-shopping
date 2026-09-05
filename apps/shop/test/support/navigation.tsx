/**
 * A `next/navigation` that is a real address bar.
 *
 * The search screen keeps every filter in the URL and nothing in React state, so
 * a mock whose `push` only records the call would leave the screen frozen on its
 * first query — the click would be observed and nothing would follow from it.
 * What F4 asks (필터 3개 적용 후 새로고침 · 뒤로가기) can only be checked against
 * navigation that *navigates*: `push` changes what `useSearchParams` answers,
 * every subscriber re-renders, and `back` pops the stack the pushes built.
 *
 * `useSyncExternalStore` rather than a module-level variable read during render:
 * changing a variable no component is subscribed to renders nothing, and the
 * test would be waiting for an update that cannot arrive.
 */

import { useSyncExternalStore } from 'react'
import { vi } from 'vitest'

const ORIGIN = 'http://localhost'

let history: string[] = ['/search']
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function current(): URL {
  return new URL(history[history.length - 1] ?? '/search', ORIGIN)
}

function snapshot(): string {
  return history[history.length - 1] ?? '/search'
}

export const navigation = {
  /** Puts the address bar at one URL and empties the history behind it. */
  start(href: string): void {
    history = [href]
    emit()
  },
  push: vi.fn((href: string) => {
    history = [...history, href]
    emit()
  }),
  replace: vi.fn((href: string) => {
    history = [...history.slice(0, -1), href]
    emit()
  }),
  back: vi.fn(() => {
    if (history.length > 1) history = history.slice(0, -1)
    emit()
  }),
  prefetch: vi.fn(),
  /** What the address bar currently reads, for an assertion. */
  get href(): string {
    return snapshot()
  },
  get params(): URLSearchParams {
    return current().searchParams
  },
  /** A reload: the same URL, re-entered, with nothing else carried over. */
  reload(): void {
    history = [snapshot()]
    emit()
  },
}

function useHref(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * The module factory. `vi.mock('next/navigation', () => nextNavigationMock())`.
 *
 * Complete rather than spread over the real module: `vi.mock` factories are
 * hoisted above every import, so an `importOriginal` here is evaluated before
 * the modules it depends on exist — which surfaces as
 * `Cannot access '__vi_import_10__' before initialization` from whichever
 * component happened to import `next/navigation` first, and reads like a bug in
 * that component.
 */
export function nextNavigationMock(): Record<string, unknown> {
  return {
    /**
     * Next's own `notFound()` throws a sentinel its router catches. A plain
     * throw is the same shape for a test: what a spec asserts is that the page
     * *refused*, and nothing here renders the 404 boundary.
     */
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
    useSearchParams: () => new URL(useHref(), ORIGIN).searchParams,
    usePathname: () => new URL(useHref(), ORIGIN).pathname,
    useRouter: () => ({
      push: navigation.push,
      replace: navigation.replace,
      back: navigation.back,
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: navigation.prefetch,
    }),
  }
}
