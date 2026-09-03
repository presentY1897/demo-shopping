/**
 * The same columns, drawn as a stack of cards.
 *
 * DECISIONS 1장 콘솔 모바일 gives the seller order list a real mobile layout
 * rather than a sideways scroll, because a seller checking and dispatching
 * orders from a phone is an actual pattern. This is that layout — and it takes
 * the **same `TableColumn[]`** the `Table` takes, so the two views cannot drift
 * into showing different fields.
 *
 * It renders cards and nothing else. Choosing between this and `Table` is the
 * screen's job, and DECISIONS is explicit that the choice is a single mount
 * decided by a viewport hook, not two trees hidden from each other with media
 * queries — that doubles the DOM and the accessibility tree.
 *
 * Server-renderable.
 */

import { useId, type ReactNode } from 'react'

import { Card } from './card'
import { cx } from '../lib/cx'
import type { TableColumn } from './table'

export interface TableToCardsProps<Row> {
  readonly columns: readonly TableColumn<Row>[]
  readonly rows: readonly Row[]
  readonly rowKey: (row: Row, index: number) => string
  /** Names the list, exactly as it names the table. */
  readonly caption: ReactNode
  readonly captionHidden?: boolean
  /**
   * Column shown as the card's headline. Defaults to the first, which is the
   * same column `Table` promotes to `<th scope="row">` — the one that says which
   * row this is.
   */
  readonly titleKey?: string
  readonly actions?: (row: Row) => ReactNode
  readonly className?: string
}

export function TableToCards<Row>({
  columns,
  rows,
  rowKey,
  caption,
  captionHidden = false,
  titleKey,
  actions,
  className,
}: TableToCardsProps<Row>) {
  const captionId = useId()

  const title = columns.find((column) => column.key === (titleKey ?? columns[0]?.key))
  const rest = columns.filter((column) => column.key !== title?.key)

  return (
    <div className={cx('flex w-full flex-col gap-2', className)}>
      <p className={captionHidden ? 'sr-only' : 'text-fg-muted text-sm'} id={captionId}>
        {caption}
      </p>

      <ul aria-labelledby={captionId} className="flex flex-col gap-3" role="list">
        {rows.map((row, index) => (
          <Card actions={actions?.(row)} as="li" key={rowKey(row, index)} variant="outline">
            {title === undefined ? null : (
              <p className="text-fg text-base font-medium">{title.cell(row)}</p>
            )}

            {/*
              A description list, not a two-column table: each pair is a label
              and its value, which is what `dl` means, and it is what lets a
              screen reader read "주문번호, 20260903-0001" instead of a bare
              string. The wrapping `div` is legal inside `dl` and keeps a pair
              on one line.

              The grid switch is a container query on the card, so a card in a
              wide single-column list shows two pairs per row while the same
              card in a narrow one stacks them.
            */}
            <dl className="flex flex-col gap-1 @sm/card:grid @sm/card:grid-cols-2 @sm/card:gap-x-4">
              {rest.map((column) => (
                <div className="flex items-baseline justify-between gap-3" key={column.key}>
                  <dt className="text-fg-subtle shrink-0 text-xs">{column.header}</dt>
                  <dd
                    className={cx(
                      'text-fg text-end text-sm',
                      column.numeric === true && 'tabular-nums',
                    )}
                  >
                    {column.cell(row)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </ul>
    </div>
  )
}
