/**
 * The hook D-055 needs: which band the window is in, so a component can mount
 * one form of itself instead of rendering both and hiding one.
 *
 * jsdom has no layout, so `matchMedia` is stubbed per test — which is also the
 * only way to check the `change` subscription, since no window here can be
 * resized.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DENSITY_VIEWPORT_MIN_WIDTH } from '../density/density'
import { useViewportBand } from './use-viewport-band'

type Listener = () => void

/** A `matchMedia` that answers for one window width and can be resized. */
function stubMatchMedia(width: number) {
  const listeners = new Map<string, Set<Listener>>()
  let current = width

  const stub = vi.fn((query: string) => {
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
  })

  vi.stubGlobal('matchMedia', stub)

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

function Band() {
  return <output>{useViewportBand()}</output>
}

function band(): string {
  return screen.getByRole('status').textContent ?? ''
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useViewportBand', () => {
  it('reads the band from the window width', () => {
    stubMatchMedia(DENSITY_VIEWPORT_MIN_WIDTH.xl)
    render(<Band />)

    expect(band()).toBe('xl')
  })

  it('reports the narrow band below the md breakpoint', () => {
    stubMatchMedia(DENSITY_VIEWPORT_MIN_WIDTH.md - 1)
    render(<Band />)

    expect(band()).toBe('base')
  })

  it('reports md between the two breakpoints', () => {
    stubMatchMedia(DENSITY_VIEWPORT_MIN_WIDTH.md)
    render(<Band />)

    expect(band()).toBe('md')
  })

  it('follows the window across a breakpoint', () => {
    const media = stubMatchMedia(DENSITY_VIEWPORT_MIN_WIDTH.md - 1)
    render(<Band />)

    media.resizeTo(DENSITY_VIEWPORT_MIN_WIDTH.xl)

    expect(band()).toBe('xl')
  })

  it('unsubscribes when the component goes away', () => {
    const media = stubMatchMedia(DENSITY_VIEWPORT_MIN_WIDTH.xl)
    render(<Band />)

    expect(media.listenerCount()).toBeGreaterThan(0)

    cleanup()

    expect(media.listenerCount()).toBe(0)
  })

  it('renders the mobile-first band on the server, where there is no window', () => {
    // The point of the server snapshot: `apps/shop` is mobile first, so the
    // narrow layout is the guess that is safe to hydrate from.
    expect(renderToString(<Band />)).toContain('base')
  })
})
