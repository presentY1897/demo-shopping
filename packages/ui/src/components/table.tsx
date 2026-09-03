'use client'

/**
 * The data table: sortable headers, an optional stuck header row, and — the part
 * that actually decides whether a console is usable on a phone — a horizontal
 * scroll that keeps the first column in place.
 *
 * **Why the first column is pinned.** DECISIONS 1장 콘솔 모바일 settles it: only
 * three seller screens get a purpose-built mobile layout, and every other table
 * is allowed to scroll sideways. A sideways-scrolling table whose row header
 * scrolls away is unreadable — the reader is looking at "3", "발송대기",
 * "12,000" with no idea which order that is. So the identifying column is a
 * `<th scope="row">` and it is `position: sticky` at the inline start.
 *
 * **Why the scroll lives on a wrapper.** The overflow has to be somewhere. Left
 * on the page, a 900px table at 360px makes the *document* scroll sideways, and
 * every screen on the site inherits a horizontal scrollbar (TASK-0016 F4b: 페이지
 * 자체는 스크롤 안 됨). The wrapper is `overflow-x: auto` and `w-full`, so the
 * overflow is contained where it belongs.
 *
 * That wrapper is a keyboard-reachable, named region: WCAG 2.1.1 means a scroll
 * container that can only be panned by dragging is unusable without a mouse, and
 * `tabIndex={0}` is what lets the arrow keys move it. It borrows the caption for
 * its name so no app has to supply a second string.
 *
 * **`border-separate` is not cosmetic.** With `border-collapse: collapse` the
 * table owns the borders, not the cells, and a sticky cell then scrolls out from
 * under its own border — the classic "sticky column with no right edge". Separate
 * borders with zero spacing look identical and stay attached.
 *
 * `test/table-layout.spec.tsx` compiles the class names this file renders and
 * asserts the declarations (`overflow-x: auto`, `position: sticky`,
 * `inset-inline-start: 0`) rather than the class names themselves.
 */

import { useId, useMemo, useState, type ReactNode } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'
import { ChevronDownIcon } from './icons'

export const TABLE_SORT_DIRECTIONS = ['ascending', 'descending'] as const
export type TableSortDirection = (typeof TABLE_SORT_DIRECTIONS)[number]

export const TABLE_ALIGNMENTS = ['start', 'end'] as const
export type TableAlignment = (typeof TABLE_ALIGNMENTS)[number]

export interface TableSort {
  readonly key: string
  readonly direction: TableSortDirection
}

export interface TableColumn<Row> {
  /** Identifies the column in `sort` and as the React key. */
  readonly key: string
  readonly header: ReactNode
  readonly cell: (row: Row) => ReactNode
  /** Renders the header as a sort button and reports `aria-sort`. */
  readonly sortable?: boolean
  /**
   * Client-side ordering for this column, ascending.
   *
   * Present, the table sorts the rows it was given. Absent on a `sortable`
   * column, the table only reports the change through `onSortChange` — which is
   * the server-sorted case, and the one every list backed by a cursor is in,
   * because ordering is part of what the cursor encodes.
   */
  readonly compare?: (a: Row, b: Row) => number
  readonly align?: TableAlignment
  /** Lines up digits so a column of amounts can be compared by eye. */
  readonly numeric?: boolean
}

export interface TableProps<Row> {
  readonly columns: readonly TableColumn<Row>[]
  readonly rows: readonly Row[]
  readonly rowKey: (row: Row, index: number) => string
  /**
   * What the table is a table of. Required — it names the table *and* the scroll
   * region, and an unnamed one of either is an accessibility defect. Korean
   * comes from the app.
   */
  readonly caption: ReactNode
  /** Keeps the caption for assistive technology but takes it off the screen. */
  readonly captionHidden?: boolean
  /** Controlled sort. Omit to let the table hold its own. */
  readonly sort?: TableSort | null
  readonly defaultSort?: TableSort | null
  readonly onSortChange?: (sort: TableSort) => void
  /**
   * Sticks the header row while the body scrolls.
   *
   * Only observable when the region is height-constrained — pass a `max-h-*`
   * through `className`. Sticky positioning resolves against the nearest scroll
   * container, and a container that never scrolls vertically has nothing to
   * stick against.
   */
  readonly stickyHeader?: boolean
  /** Keeps the row-header column in place while the table scrolls sideways. */
  readonly pinFirstColumn?: boolean
  /** Applied to the scroll region, not the `<table>`. */
  readonly className?: string
}

/** The next sort state for a click on `key`. First click on a column is ascending. */
export function nextSort(current: TableSort | null, key: string): TableSort {
  if (current?.key !== key) return { direction: 'ascending', key }
  return { direction: current.direction === 'ascending' ? 'descending' : 'ascending', key }
}

/**
 * Orders rows for the active sort, when the column knows how.
 *
 * Returns the original array — not a copy — when there is nothing to do, so a
 * server-sorted table does not allocate a new array on every render.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly TableColumn<Row>[],
  sort: TableSort | null,
): readonly Row[] {
  if (sort === null) return rows
  const compare = columns.find((column) => column.key === sort.key)?.compare
  if (compare === undefined) return rows

  const sign = sort.direction === 'ascending' ? 1 : -1
  return [...rows].sort((a, b) => sign * compare(a, b))
}

/**
 * `whitespace-nowrap` is what makes the horizontal scroll exist at all: left to
 * wrap, a wide table reflows into a tall one at 360px and the pinned column has
 * nothing to be pinned against. A console table is read across, not down.
 */
const CELL_STYLES = 'border-border border-b px-3 py-2 align-middle whitespace-nowrap'

function alignmentClass(column: { readonly align?: TableAlignment; readonly numeric?: boolean }) {
  return cx(column.align === 'end' ? 'text-end' : 'text-start', column.numeric && 'tabular-nums')
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  caption,
  captionHidden = false,
  sort,
  defaultSort = null,
  onSortChange,
  stickyHeader = false,
  pinFirstColumn = true,
  className,
}: TableProps<Row>) {
  const captionId = useId()
  const [ownSort, setOwnSort] = useState<TableSort | null>(defaultSort)

  // `undefined` means uncontrolled; `null` is a caller saying "no sort".
  const activeSort = sort === undefined ? ownSort : sort

  const ordered = useMemo(() => sortRows(rows, columns, activeSort), [rows, columns, activeSort])

  function handleSort(key: string): void {
    const next = nextSort(activeSort, key)
    if (sort === undefined) setOwnSort(next)
    onSortChange?.(next)
  }

  return (
    <div
      aria-labelledby={captionId}
      className={cx('w-full overflow-x-auto', FOCUS_RING, className)}
      role="region"
      // WCAG 2.1.1: a region that can only be panned by dragging cannot be
      // reached without a pointer. Focusable, the arrow keys scroll it.
      tabIndex={0}
    >
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <caption
          className={captionHidden ? 'sr-only' : 'text-fg-muted pb-2 text-start text-sm'}
          id={captionId}
        >
          {caption}
        </caption>

        <thead>
          <tr className="bg-surface-muted">
            {columns.map((column, index) => {
              const pinned = pinFirstColumn && index === 0
              const active = activeSort?.key === column.key ? activeSort : null

              return (
                <th
                  aria-sort={column.sortable === true ? (active?.direction ?? 'none') : undefined}
                  className={cx(
                    CELL_STYLES,
                    'text-fg bg-inherit font-medium',
                    alignmentClass(column),
                    (stickyHeader || pinned) && 'sticky',
                    stickyHeader && 'top-0',
                    pinned && 'start-0',
                    // The corner cell is stuck on both axes, so it has to sit
                    // above both the header row and the pinned column.
                    stickyHeader && pinned ? 'z-30' : stickyHeader ? 'z-20' : pinned ? 'z-10' : '',
                  )}
                  key={column.key}
                  scope="col"
                >
                  {column.sortable === true ? (
                    <button
                      className={cx(
                        'min-h-touch text-fg inline-flex items-center gap-1',
                        FOCUS_RING,
                        'hover:text-primary',
                      )}
                      onClick={() => {
                        handleSort(column.key)
                      }}
                      type="button"
                    >
                      {column.header}
                      <ChevronDownIcon
                        className={cx(
                          'size-4 shrink-0 transition-transform',
                          active === null && 'opacity-0',
                          active?.direction === 'ascending' && 'rotate-180',
                        )}
                      />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {ordered.map((row, rowIndex) => (
            <tr className="bg-surface hover:bg-surface-muted" key={rowKey(row, rowIndex)}>
              {columns.map((column, index) => {
                const pinned = pinFirstColumn && index === 0
                const content = column.cell(row)

                // The identifying column is a row header, not a data cell: it is
                // what a screen reader reads back when the reader moves across
                // the row, and it is the column worth pinning for the same reason.
                return index === 0 ? (
                  <th
                    className={cx(
                      CELL_STYLES,
                      'text-fg bg-inherit font-medium',
                      alignmentClass(column),
                      pinned && 'sticky start-0 z-10',
                    )}
                    key={column.key}
                    scope="row"
                  >
                    {content}
                  </th>
                ) : (
                  <td
                    className={cx(CELL_STYLES, 'text-fg-muted', alignmentClass(column))}
                    key={column.key}
                  >
                    {content}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
