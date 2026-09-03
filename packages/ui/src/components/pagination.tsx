/**
 * Previous / next over a cursor.
 *
 * There is no "jump to page 3" here, and that is the design rather than a
 * shortcut (TASK-0016 R1). A cursor names a row, not an offset, so the only
 * pages reachable from one are the one after it and the ones already visited.
 * The trade is deliberate: an offset can jump, but it duplicates and drops rows
 * whenever the list changes underneath the reader, which for a product or order
 * list is continuously.
 *
 * Server-renderable — two buttons and a `<nav>`. The state lives in
 * `useCursorPagination`.
 */

import type { ReactNode } from 'react'

import { Button } from './button'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'
import { cx } from '../lib/cx'

export interface PaginationProps {
  /** Names the `<nav>`. A page can hold more than one; this is what tells them apart. */
  readonly label: string
  readonly previousLabel: string
  readonly nextLabel: string
  readonly hasPrevious: boolean
  readonly hasNext: boolean
  readonly onPrevious: () => void
  readonly onNext: () => void
  /**
   * A page is in flight.
   *
   * Blocks a second press (QUALITY-GATES U3) through `Button`'s `loading`, which
   * uses `aria-disabled` rather than the native attribute — a natively disabled
   * button drops out of the tab order, and a keyboard user who has just pressed
   * 다음 would have their focus thrown to the top of the document.
   */
  readonly busy?: boolean
  /** 1–20 / 전체 214건 — composed by the app, which owns the copy and the numbers. */
  readonly status?: ReactNode
  readonly className?: string
}

export function Pagination({
  label,
  previousLabel,
  nextLabel,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  busy = false,
  status,
  className,
}: PaginationProps) {
  return (
    <nav
      aria-label={label}
      className={cx('flex w-full items-center justify-between gap-3', className)}
    >
      <Button
        disabled={!hasPrevious}
        loading={busy}
        onClick={onPrevious}
        size="sm"
        variant="outline"
      >
        {busy ? null : <ChevronLeftIcon className="size-4 shrink-0" />}
        {previousLabel}
      </Button>

      {status === undefined ? null : (
        <p className="text-fg-muted text-sm" role="status">
          {status}
        </p>
      )}

      <Button disabled={!hasNext} loading={busy} onClick={onNext} size="sm" variant="outline">
        {nextLabel}
        {busy ? null : <ChevronRightIcon className="size-4 shrink-0" />}
      </Button>
    </nav>
  )
}
