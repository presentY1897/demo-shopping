/**
 * A `matchMedia` that answers for one window width.
 *
 * jsdom has no layout and no `matchMedia` at all, so the header — which mounts
 * one of three forms depending on the viewport band (D-055) — would always take
 * the mobile-first fallback. Stubbing it is what lets a test say "this is a
 * 1440px browser" and check the form that a desktop visitor actually gets.
 *
 * `@shopping/ui`'s own setup polyfills a permanently non-matching `matchMedia`
 * for `react-remove-scroll`; this app does not, so the stub covers both needs.
 */

import { vi } from 'vitest'

/** The three verification viewports of `docs/design/pages.md`. */
export const VIEWPORTS = { mobile: 360, tablet: 768, desktop: 1440 } as const

export function stubViewport(width: number): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const minWidth = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)

      return {
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: width >= minWidth,
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }
    }),
  )
}
