/**
 * The generic half of the viewport hooks.
 *
 * jsdom has no layout, so `matchMedia` is stubbed per test — which is also the
 * only way to check the `change` subscription, since no window here can be
 * resized. What matters beyond "it reads the width" is the server snapshot: the
 * console picks its own, and getting that wrong is a layout that flashes.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMinWidth } from './use-min-width'

type Listener = () => void

const BREAKPOINT = 1024

/** A `matchMedia` that answers for one window width and can be resized. */
function stubMatchMedia(width: number) {
  const listeners = new Map<string, Set<Listener>>()
  let current = width

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const minWidth = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)

      return {
        addEventListener: (_: string, listener: Listener) => {
          const set = listeners.get(query) ?? new Set<Listener>()
          set.add(listener)
          listeners.set(query, set)
        },
        matches: current >= minWidth,
        media: query,
        removeEventListener: (_: string, listener: Listener) => {
          listeners.get(query)?.delete(listener)
        },
      }
    }),
  )

  return {
    listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
    resizeTo(next: number) {
      current = next
      act(() => {
        for (const set of listeners.values()) for (const listener of set) listener()
      })
    },
  }
}

function Wide({ serverSnapshot }: { readonly serverSnapshot?: boolean }) {
  return <output>{String(useMinWidth(BREAKPOINT, serverSnapshot))}</output>
}

function answer(): string {
  return screen.getByRole('status').textContent ?? ''
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useMinWidth', () => {
  it('is true at the breakpoint itself', () => {
    stubMatchMedia(BREAKPOINT)
    render(<Wide />)

    expect(answer()).toBe('true')
  })

  it('is false one pixel below it', () => {
    stubMatchMedia(BREAKPOINT - 1)
    render(<Wide />)

    expect(answer()).toBe('false')
  })

  it('follows the window across the breakpoint', () => {
    const media = stubMatchMedia(BREAKPOINT - 1)
    render(<Wide />)

    media.resizeTo(BREAKPOINT)

    expect(answer()).toBe('true')
  })

  it('unsubscribes when the component goes away', () => {
    const media = stubMatchMedia(BREAKPOINT)
    render(<Wide />)

    expect(media.listenerCount()).toBeGreaterThan(0)

    cleanup()

    expect(media.listenerCount()).toBe(0)
  })

  it('answers the caller-chosen snapshot on the server, where there is no window', () => {
    expect(renderToString(<Wide />)).toContain('false')
    expect(renderToString(<Wide serverSnapshot />)).toContain('true')
  })
})
