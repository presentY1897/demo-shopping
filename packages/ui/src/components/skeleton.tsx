/**
 * The loading placeholder.
 *
 * Server-renderable: a pulsing box needs no browser API. It is deliberately the
 * *shape of the content that is coming* rather than a spinner — a list that
 * collapses to a 24px circle and then springs back to twelve rows is a layout
 * shift, and CLS is a metric this project has a gate on (QUALITY-GATES P1).
 *
 * Hidden from assistive technology (`aria-hidden`), because a screen reader user
 * gains nothing from three grey rectangles. The announcement belongs on the
 * `label` prop, which renders a live region instead. `packages/ui` has no
 * Korean, so the text arrives from the app.
 */

import { cx } from '../lib/cx'

export const SKELETON_SHAPES = ['text', 'block', 'circle'] as const
export type SkeletonShape = (typeof SKELETON_SHAPES)[number]

const SHAPE_STYLES: Readonly<Record<SkeletonShape, string>> = {
  text: 'h-4 rounded-sm',
  block: 'h-24 rounded-md',
  circle: 'size-10 rounded-full',
}

export interface SkeletonProps {
  readonly shape?: SkeletonShape
  /** Rows to draw. Only meaningful for `text`; the others are one box. */
  readonly lines?: number
  /**
   * Announced to a screen reader while the placeholder is up — "주문을 불러오는
   * 중" and the like. Optional because a page that already announces its own
   * busy state would otherwise say it twice.
   */
  readonly label?: string
  readonly className?: string
}

export function Skeleton({ shape = 'text', lines = 1, label, className }: SkeletonProps) {
  const count = shape === 'text' ? Math.max(1, lines) : 1

  return (
    <>
      {label === undefined ? null : (
        <span className="sr-only" role="status">
          {label}
        </span>
      )}
      <span aria-hidden="true" className="flex w-full flex-col gap-2" data-shape={shape}>
        {Array.from({ length: count }, (_, index) => (
          <span
            className={cx(
              'bg-surface-muted block animate-pulse',
              SHAPE_STYLES[shape],
              // The last line of a paragraph is short. Without this a text
              // skeleton reads as a block of solid grey rather than as copy.
              shape === 'text' && index === count - 1 && count > 1 ? 'w-2/3' : 'w-full',
              className,
            )}
            key={index}
          />
        ))}
      </span>
    </>
  )
}
