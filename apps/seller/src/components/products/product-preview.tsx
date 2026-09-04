'use client'

import type { AttributeValue } from '@shopping/shared'
import { DEFAULT_DENSITY } from '@shopping/ui'
import { Badge, Modal } from '@shopping/ui/components'
import type { FieldDef } from '@shopping/ui/form'
import { formatMoney } from '@shopping/ui/format'

import { attributeKeyOf } from '@/lib/products/attribute-values'
import type { OptionAxis } from '@/lib/products/combinations'
import type { VariantRow } from '@/lib/products/variant-rows'
import type { ProductPreviewMessages } from '@/messages'

/**
 * 미리보기 — the buyer's detail layout, rehearsed (TASK-0114 F8).
 *
 * **A rehearsal and not the screen.** The buyer's product detail is TASK-0043
 * and does not exist yet; this draws the same shape from the same values so a
 * seller can see whether their gallery, their option axes and their attribute
 * table read as a listing. The panel says so in its own words (R3), because a
 * preview that quietly differs from the real page is worse than none — and when
 * TASK-0043 lands, this is replaced by that component rather than kept in step
 * with it.
 *
 * **Density is fixed at the standard step.** The console has no density toggle
 * (TASK-0019) and changing density inside a preview is not what this screen is
 * for; the three-step check belongs to the buyer's own detail page. That is
 * what makes P6 and U4 해당 없음, and the attribute is written here rather than
 * assumed so the claim is visible in the DOM.
 *
 * It is a `Modal` because it is a rehearsal of a *different screen*: shown
 * inline it would read as another section of the form, and the seller would not
 * be able to tell which of the two layouts they were looking at.
 */

export interface ProductPreviewProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly name: string
  readonly description: string
  readonly images: readonly { readonly url: string; readonly alt?: string }[]
  readonly axes: readonly OptionAxis[]
  readonly rows: readonly VariantRow[]
  /** The generated form's values, so the attribute table shows what was typed. */
  readonly values: Readonly<Record<string, unknown>>
  readonly fields: readonly FieldDef[]
  readonly messages: ProductPreviewMessages
}

/**
 * The currency every amount in this catalogue is in (DECISIONS 1장 — 한국어 ·
 * KRW 우선). Named rather than appended as "원": the formatter decides the
 * symbol and its position from the currency, so a listing in another currency
 * would need a value here rather than a new string in the markup.
 */
const CURRENCY = 'KRW'

/** The lowest price among the rows a buyer could order. */
function lowestPrice(rows: readonly VariantRow[]): number | null {
  const prices = rows
    .filter((row) => row.isActive)
    .map((row) => Number(row.price))
    .filter((price) => Number.isInteger(price) && price >= 0)

  return prices.length === 0 ? null : Math.min(...prices)
}

/** True when every orderable row is out of stock. */
function isSoldOut(rows: readonly VariantRow[]): boolean {
  const orderable = rows.filter((row) => row.isActive)

  return orderable.length > 0 && orderable.every((row) => Number(row.stock) === 0)
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return (value as readonly AttributeValue[]).map(String).join(', ')
  if (typeof value === 'boolean') return value ? 'O' : 'X'

  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

export function ProductPreview({
  open,
  onOpenChange,
  name,
  description,
  images,
  axes,
  rows,
  values,
  fields,
  messages,
}: ProductPreviewProps) {
  const price = lowestPrice(rows)
  const answered = fields
    .map((field) => ({ field, text: displayValue(values[field.key]) }))
    .filter((entry) => entry.text !== '' && attributeKeyOf(entry.field.key) !== null)

  return (
    <Modal
      closeLabel={messages.closeLabel}
      onOpenChange={onOpenChange}
      open={open}
      size="lg"
      title={messages.title}
    >
      <div className="flex flex-col gap-4" data-density={DEFAULT_DENSITY}>
        <p className="border-border bg-surface-muted text-fg-muted rounded-md border px-3 py-2 text-xs">
          {messages.disclaimer}
        </p>

        {images.length === 0 ? (
          <p className="border-border text-fg-muted rounded-lg border border-dashed p-6 text-center text-sm">
            {messages.noImages}
          </p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto">
            {images.map((image, index) => (
              <li key={index}>
                {/*
                  A plain `<img>`. `next/image` optimises through a proxy that
                  needs a `remotePatterns` entry per storage host, and the URL
                  here is whatever the widget uploaded — a rehearsal of somebody
                  else's screen is not where that configuration should be
                  decided. TASK-0043 owns the buyer's real gallery.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={image.alt ?? ''}
                  className="border-border h-40 w-32 rounded-md border object-cover"
                  src={image.url}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-1">
          <h3 className="text-fg text-lg font-semibold">{name}</h3>
          <p className="text-fg text-xl font-semibold tabular-nums">
            {price === null ? messages.noPrice : formatMoney({ amount: price, currency: CURRENCY })}
          </p>
          {isSoldOut(rows) ? <Badge variant="neutral">{messages.soldOut}</Badge> : null}
        </div>

        {description === '' ? null : (
          <p className="text-fg-muted text-sm whitespace-pre-line">{description}</p>
        )}

        {axes.length === 0 ? null : (
          <section className="flex flex-col gap-2">
            <h4 className="text-fg text-sm font-medium">{messages.optionsLabel}</h4>
            {axes.map((axis, index) => (
              <div className="flex flex-wrap items-center gap-2" key={index}>
                <span className="text-fg-muted text-sm">{axis.name}</span>
                {axis.values.map((value, at) => (
                  <Badge key={at} variant="neutral">
                    {value}
                  </Badge>
                ))}
              </div>
            ))}
          </section>
        )}

        {answered.length === 0 ? null : (
          <section className="flex flex-col gap-2">
            <h4 className="text-fg text-sm font-medium">{messages.attributesLabel}</h4>
            <dl className="border-border grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border p-3 text-sm">
              {answered.map((entry) => (
                <div className="contents" key={entry.field.key}>
                  <dt className="text-fg-muted">{entry.field.label}</dt>
                  <dd className="text-fg">{entry.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </Modal>
  )
}
