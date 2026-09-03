/**
 * A rule between sections, optionally with a label in the middle.
 *
 * Written directly rather than on `@radix-ui/react-separator`: the primitive is
 * a `<div role="separator">` with an `aria-orientation`, which is the whole of
 * it — and taking the dependency would make every `Divider` a client component
 * (Radix ships `'use client'`), so a static footer rule would pull React into a
 * bundle to draw a line. TASK-0015 R1 anticipates exactly this case.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

export const DIVIDER_ORIENTATIONS = ['horizontal', 'vertical'] as const
export type DividerOrientation = (typeof DIVIDER_ORIENTATIONS)[number]

export interface DividerProps {
  readonly orientation?: DividerOrientation
  /**
   * Purely visual. A decorative rule is hidden from assistive technology, which
   * is right for a line that only repeats what the heading structure already
   * says — and wrong for one that is the only signal a group has ended.
   */
  readonly decorative?: boolean
  /** Horizontal only: text set into the middle of the rule. */
  readonly label?: ReactNode
  readonly className?: string
}

export function Divider({
  orientation = 'horizontal',
  decorative = false,
  label,
  className,
}: DividerProps) {
  const semantics = decorative
    ? ({ role: 'none' } as const)
    : ({ role: 'separator', 'aria-orientation': orientation } as const)

  if (label !== undefined && orientation === 'horizontal') {
    return (
      <div className={cx('flex items-center gap-3', className)} {...semantics}>
        <span aria-hidden="true" className="bg-border h-px flex-1" />
        <span className="text-fg-subtle text-xs">{label}</span>
        <span aria-hidden="true" className="bg-border h-px flex-1" />
      </div>
    )
  }

  return (
    <div
      className={cx(
        'bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        className,
      )}
      {...semantics}
    />
  )
}
