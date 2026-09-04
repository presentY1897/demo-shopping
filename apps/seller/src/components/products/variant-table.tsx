'use client'

import { Button, Input, Switch } from '@shopping/ui/components'
import { memo, useId, useState } from 'react'

import { fill } from '@/lib/products/product-form'
import type { BulkField, VariantBulk, VariantRow } from '@/lib/products/variant-rows'
import type { ProductVariantMessages } from '@/messages'

/**
 * The combination table: one row per variant, plus the bulk row that fills them
 * (TASK-0114 4장, F3 · F4 · F10).
 *
 * **Not `@shopping/ui`'s `Table`, and that is the whole reason this file
 * exists.** That component renders every cell through `column.cell(row)` in the
 * parent's own render, so one keystroke in one price box would re-render two
 * hundred rows and a thousand inputs. Here each row is a `memo` component whose
 * props are its own row object and a stable callback, so typing in 블랙/M
 * re-renders 블랙/M and nothing else (F10).
 *
 * **What is kept from `Table` is the part that is about accessibility, not
 * about data.** The scroll lives on a focusable, named wrapper (WCAG 2.1.1 — a
 * region that can only be panned by dragging is unreachable without a mouse),
 * the combination is a `<th scope="row">` so a screen reader reads it back on
 * every cell, and it is `sticky` at the inline start so a table scrolled
 * sideways still says which variant a number belongs to. `border-separate` is
 * not cosmetic: with collapsed borders the table owns them and a sticky cell
 * scrolls out from under its own edge.
 *
 * **Every cell has an accessible name.** A grid of unlabelled number boxes is
 * the shape a screen reader cannot navigate, so each input is named
 * `{combination} 의 {column}` from the catalog.
 */

export interface VariantTableProps {
  readonly rows: readonly VariantRow[]
  readonly onRowChange: (key: string, patch: Partial<VariantRow>) => void
  readonly onBulkApply: (field: BulkField, value: string) => void
  readonly bulk: VariantBulk
  readonly onBulkChange: (bulk: VariantBulk) => void
  readonly messages: ProductVariantMessages
  /** Shown above the table: this is where table-shaped refusals land (4장). */
  readonly notice: string | null
}

const CELL = 'border-border border-b px-3 py-2 align-middle whitespace-nowrap'

/**
 * The focus indicator on the scroll region.
 *
 * Restated rather than imported: `packages/ui` keeps `FOCUS_RING` behind its
 * `lib/` folder, which its `exports` map does not reach, and widening that map
 * for one string would be a change to the package's public surface made from an
 * app. The class list is the one `styles.ts` defines.
 */
const FOCUS_RING =
  'focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2'

/** The bulk fields, in the order the row lays them out. */
const BULK_FIELDS: readonly BulkField[] = ['price', 'listPrice', 'stock', 'maxPurchaseQuantity']

export function VariantTable({
  rows,
  onRowChange,
  onBulkApply,
  bulk,
  onBulkChange,
  messages,
  notice,
}: VariantTableProps) {
  const headingId = useId()
  const captionId = useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div>
        <h2 className="text-fg text-base font-medium" id={headingId}>
          {messages.title}
        </h2>
        <p className="text-fg-muted mt-1 text-sm">{messages.description}</p>
      </div>

      {notice === null ? null : (
        <div
          className="border-danger bg-danger-surface text-fg rounded-md border p-3 text-sm"
          role="alert"
        >
          <p className="font-medium">{messages.noticeTitle}</p>
          <p>{notice}</p>
        </div>
      )}

      <BulkRow bulk={bulk} messages={messages} onApply={onBulkApply} onChange={onBulkChange} />

      {rows.length === 0 ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-6 text-center text-sm">
          {messages.emptyBody}
        </p>
      ) : (
        <div
          aria-labelledby={captionId}
          className={`w-full overflow-x-auto ${FOCUS_RING}`}
          role="region"
          tabIndex={0}
        >
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <caption className="text-fg-muted pb-2 text-start text-sm" id={captionId}>
              {messages.caption}
            </caption>
            <thead>
              <tr className="bg-surface-muted">
                <th
                  className={`${CELL} text-fg bg-inherit sticky start-0 z-10 font-medium`}
                  scope="col"
                >
                  {messages.combinationHeader}
                </th>
                <th className={`${CELL} text-fg font-medium`} scope="col">
                  {messages.skuHeader}
                </th>
                <th className={`${CELL} text-fg font-medium`} scope="col">
                  {messages.priceHeader}
                </th>
                <th className={`${CELL} text-fg font-medium`} scope="col">
                  {messages.listPriceHeader}
                </th>
                <th className={`${CELL} text-fg font-medium`} scope="col">
                  {messages.stockHeader}
                </th>
                <th className={`${CELL} text-fg font-medium`} scope="col">
                  {messages.purchaseLimitHeader}
                </th>
                <th className={`${CELL} text-fg font-medium`} scope="col">
                  {messages.activeHeader}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <VariantTableRow
                  key={row.key}
                  messages={messages}
                  onChange={onRowChange}
                  row={row}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/**
 * One row, and the reason the whole file is hand written.
 *
 * `memo` compares the row object and the callback. The parent replaces exactly
 * one row object per keystroke (`patchRow` maps and returns the same reference
 * for every other row) and `onChange` is a `useCallback` with no dependencies,
 * so the other 199 rows are skipped entirely.
 */
const VariantTableRow = memo(function VariantTableRow({
  row,
  onChange,
  messages,
}: {
  readonly row: VariantRow
  readonly onChange: (key: string, patch: Partial<VariantRow>) => void
  readonly messages: ProductVariantMessages
}) {
  const combination = row.values.length === 0 ? messages.combinationHeader : row.values.join(' / ')
  const label = (column: string): string => fill(messages.cellLabel, { combination, column })

  return (
    <tr className="bg-surface" data-testid="variant-row">
      <th className={`${CELL} text-fg bg-inherit sticky start-0 z-10 font-medium`} scope="row">
        {combination}
      </th>
      <td className={CELL}>
        <Input
          aria-label={label(messages.skuHeader)}
          autoComplete="off"
          className="w-40"
          onChange={(event) => {
            onChange(row.key, { sku: event.target.value })
          }}
          placeholder={messages.skuPlaceholder}
          value={row.sku}
        />
      </td>
      <td className={CELL}>
        <NumberCell
          label={label(messages.priceHeader)}
          onChange={(price) => {
            onChange(row.key, { price })
          }}
          value={row.price}
        />
      </td>
      <td className={CELL}>
        <NumberCell
          label={label(messages.listPriceHeader)}
          onChange={(listPrice) => {
            onChange(row.key, { listPrice })
          }}
          value={row.listPrice}
        />
      </td>
      <td className={CELL}>
        <NumberCell
          label={label(messages.stockHeader)}
          onChange={(stock) => {
            onChange(row.key, { stock })
          }}
          value={row.stock}
        />
      </td>
      <td className={CELL}>
        <NumberCell
          label={label(messages.purchaseLimitHeader)}
          onChange={(maxPurchaseQuantity) => {
            onChange(row.key, { maxPurchaseQuantity })
          }}
          value={row.maxPurchaseQuantity}
        />
      </td>
      <td className={CELL}>
        <Switch
          aria-label={label(messages.activeHeader)}
          checked={row.isActive}
          onCheckedChange={(isActive) => {
            onChange(row.key, { isActive })
          }}
        />
      </td>
    </tr>
  )
})

/**
 * A numeric cell.
 *
 * `inputMode` as well as `type`: the numeric keypad is what a phone reads, and
 * `type="number"` alone gives a keyboard with a comma on some Android builds —
 * the same note `DynamicForm` carries about its own number control.
 */
function NumberCell({
  label,
  value,
  onChange,
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <Input
      aria-label={label}
      className="w-28 tabular-nums"
      inputMode="numeric"
      onChange={(event) => {
        onChange(event.target.value)
      }}
      type="number"
      value={value}
    />
  )
}

/**
 * 일괄 입력 — offered **before** the table rather than after it (4장).
 *
 * A hundred rows is not a thing anybody fills in one cell at a time, so the
 * first control a seller meets should be the one that fills all of them. Its
 * own component with its own state boundary, so typing a bulk price does not
 * re-render the rows it has not been applied to yet.
 */
function BulkRow({
  bulk,
  onChange,
  onApply,
  messages,
}: {
  readonly bulk: VariantBulk
  readonly onChange: (bulk: VariantBulk) => void
  readonly onApply: (field: BulkField, value: string) => void
  readonly messages: ProductVariantMessages
}) {
  const legendId = useId()
  const [applied, setApplied] = useState(false)

  const headerFor: Readonly<Record<BulkField, string>> = {
    price: messages.priceHeader,
    listPrice: messages.listPriceHeader,
    stock: messages.stockHeader,
    maxPurchaseQuantity: messages.purchaseLimitHeader,
  }

  return (
    <fieldset
      aria-describedby={legendId}
      className="border-border flex flex-wrap items-end gap-3 rounded-lg border p-4"
    >
      <legend className="text-fg-muted px-1 text-sm">{messages.bulkTitle}</legend>
      <p className="text-fg-muted w-full text-sm" id={legendId}>
        {messages.bulkDescription}
      </p>

      {BULK_FIELDS.map((field) => (
        <label className="flex flex-col gap-1 text-sm" key={field}>
          <span className="text-fg-muted">{headerFor[field]}</span>
          <Input
            className="w-28 tabular-nums"
            inputMode="numeric"
            onChange={(event) => {
              onChange({ ...bulk, [field]: event.target.value })
            }}
            type="number"
            value={bulk[field]}
          />
        </label>
      ))}

      <Button
        onClick={() => {
          for (const field of BULK_FIELDS) onApply(field, bulk[field])
          setApplied(true)
        }}
        type="button"
        variant="outline"
      >
        {messages.bulkApplyLabel}
      </Button>

      {/*
        Announced rather than merely done: pressing 모든 행에 적용 changes rows
        that may be scrolled out of view, and a screen reader would otherwise be
        told nothing at all.
      */}
      <p className="sr-only" role="status">
        {applied ? messages.bulkAppliedNotice : ''}
      </p>
    </fieldset>
  )
}
