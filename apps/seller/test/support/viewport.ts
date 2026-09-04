/**
 * A `matchMedia` that answers for one window width.
 *
 * jsdom has no layout and no `matchMedia` at all, so the console shell — which
 * mounts a sidebar column or a sheet depending on the width (D-055) — would
 * always take the narrow fallback. Stubbing it is what lets a test say "this is
 * a 1440px browser" and check the form an operator actually gets.
 */

import { vi } from 'vitest'

/** The three verification viewports of `docs/design/pages.md`. */
export const VIEWPORTS = { desktop: 1440, mobile: 360, tablet: 768 } as const

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
