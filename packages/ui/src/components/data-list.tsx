/**
 * The four states a list can be in, made impossible to forget.
 *
 * TASK-0016 4장: 네 상태를 컴포넌트가 강제한다. 사용하는 쪽에서 빈 상태 처리를
 * 빠뜨릴 수 없게 한다.
 *
 * That is why `loading`, `empty` and `error` are **required props with no
 * defaults**. A default would be a shipped English placeholder in a package that
 * has no copy, and — worse — it would make the forgotten empty state look
 * finished. Here, forgetting one does not compile.
 *
 * The component renders one branch and nothing else. It deliberately does not
 * fetch, retry, or decide *which* state it is in: that belongs to the screen,
 * which is the only thing that knows whether an empty response after a filter
 * change is `empty` or still `loading`.
 *
 * Server-renderable — this is a switch statement with an ARIA attribute.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

export const DATA_LIST_STATES = ['loading', 'empty', 'error', 'ready'] as const
export type DataListState = (typeof DATA_LIST_STATES)[number]

export interface DataListProps {
  readonly state: DataListState
  /** Usually a `Skeleton` shaped like the rows that are coming. */
  readonly loading: ReactNode
  /** An `EmptyState`. Required: this is the branch that gets skipped. */
  readonly empty: ReactNode
  /** An `ErrorState`. Required for the same reason. */
  readonly error: ReactNode
  /** The list itself, rendered only in `ready`. */
  readonly children: ReactNode
  readonly className?: string
}

export function DataList({ state, loading, empty, error, children, className }: DataListProps) {
  return (
    <div
      // `aria-busy` on the region rather than a live region around the whole
      // list: announcing every row of a refreshed list is not help, it is noise.
      // The polite announcement lives on `EmptyState` and `Skeleton.label`.
      aria-busy={state === 'loading' || undefined}
      className={cx('flex w-full flex-col gap-4', className)}
      data-state={state}
    >
      {state === 'loading' ? loading : null}
      {state === 'empty' ? empty : null}
      {state === 'error' ? error : null}
      {state === 'ready' ? children : null}
    </div>
  )
}
