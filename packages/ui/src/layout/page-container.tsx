/**
 * The page's width and its edge gutter, in one place.
 *
 * Every band of a page — the header's contents, the main column, the footer —
 * has to line up on the same left and right edge, and the gutter itself is a
 * density token (`--space-gutter`, 14px to 48px depending on step and viewport).
 * Written inline it would be the same three utilities repeated in every band and
 * every page, which is how the third one ends up different from the other two.
 *
 * Server-renderable: no hook, no browser API.
 */

import type { ElementType, ReactNode } from 'react'

import { cx } from '../lib/cx'

export const PAGE_CONTAINER_WIDTHS = ['narrow', 'wide'] as const
export type PageContainerWidth = (typeof PAGE_CONTAINER_WIDTHS)[number]

/**
 * `narrow` is for reading — a form, an article, a notice. `wide` is the
 * storefront default and stops short of the 1440px verification viewport so a
 * product grid has a margin to sit in rather than running to the glass.
 */
const WIDTH_STYLES: Readonly<Record<PageContainerWidth, string>> = {
  narrow: 'max-w-3xl',
  wide: 'max-w-7xl',
}

export interface PageContainerProps {
  readonly children: ReactNode
  readonly width?: PageContainerWidth
  /** `div` by default; a band passes its own landmark element. */
  readonly as?: ElementType
  readonly className?: string
}

export function PageContainer({
  children,
  width = 'wide',
  as: Tag = 'div',
  className,
}: PageContainerProps) {
  return (
    <Tag className={cx('px-gutter mx-auto w-full', WIDTH_STYLES[width], className)}>{children}</Tag>
  )
}
