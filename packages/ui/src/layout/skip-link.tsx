/**
 * "Skip to content" — the first thing in the tab order.
 *
 * A storefront header is a logo, six category links, a search field, a density
 * toggle and two icon buttons. Without this, reaching the page's own content
 * from the keyboard means passing all of them, on every page, forever
 * (QUALITY-GATES P4).
 *
 * It is visible only while focused. `sr-only` until then rather than
 * `display: none`, because a hidden element cannot be focused and a link nobody
 * can reach is not a skip link.
 *
 * Server-renderable.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'

export interface SkipLinkProps {
  readonly children: ReactNode
  /** Fragment of the element that receives focus. Must exist and be focusable. */
  readonly href: string
  readonly className?: string
}

export function SkipLink({ children, href, className }: SkipLinkProps) {
  return (
    <a
      className={cx(
        'sr-only',
        // Pulled back into the flow only on focus, and positioned over the page
        // so it does not push the header down when it appears.
        'focus-visible:not-sr-only focus-visible:bg-surface-raised focus-visible:text-fg focus-visible:border-border focus-visible:shadow-sm',
        'focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50',
        'focus-visible:min-h-touch focus-visible:inline-flex focus-visible:items-center focus-visible:rounded-md focus-visible:border focus-visible:px-4',
        FOCUS_RING,
        className,
      )}
      href={href}
    >
      {children}
    </a>
  )
}
