'use client'

/**
 * 설명 · 속성 표 · 배송 · 리뷰 · 추천 — 밀도가 정하는 것은 **양**이다 (TASK-0043 4장).
 *
 * R1 asks that the three steps not be three components. They are not: every
 * block below is written once and the density decides how much of it appears —
 * the attribute table folds, shows its first rows, or shows all of them; the
 * shipping line is one sentence, a summary, or the paragraph. Three separate
 * layouts would be three places to fix the next copy change.
 *
 * The review, inquiry and recommendation blocks are **placeholders with their
 * milestone named**. TASK-0023 4장 is explicit that an absent feature is shown
 * and explained rather than hidden — the point of the demo is that the shape of
 * the finished thing is visible.
 */

import type { AttributeValue } from '@shopping/shared'
import type { DensityLevel } from '@shopping/ui'
import { formatDate } from '@shopping/ui/format'
import { useSyncExternalStore } from 'react'

import type { ProductInfoMessages } from '@/messages'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Three days out, which is what the shipping paragraph promises. A real estimate
 * needs an address and a carrier, and M07 owns both.
 *
 * Cached: `getSnapshot` must return the same value while nothing has changed, and
 * a fresh `Date` on every call would make React re-render forever.
 */
let cachedArrival: string | null = null

function arrivalSnapshot(): string {
  cachedArrival ??= formatDate(new Date(Date.now() + 3 * DAY_MS), { style: 'date' })

  return cachedArrival
}

function serverSnapshot(): null {
  return null
}

/** The clock does not notify. */
function subscribeToNothing(): () => void {
  return () => undefined
}

/** How many attribute rows each step shows. `null` is all of them. */
const ATTRIBUTE_ROWS: Readonly<Record<DensityLevel, number | null>> = { 1: null, 2: 4, 3: null }

export interface ProductInfoProps {
  readonly density: DensityLevel
  readonly description: string | null
  readonly attributes: readonly {
    readonly key: string
    readonly label: string
    readonly value: AttributeValue
  }[]
  readonly ratingAvg: number
  readonly ratingCount: number
  readonly messages: ProductInfoMessages
}

/** A value as a person reads it. Language, not data — so it is decided here. */
function show(value: AttributeValue): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? '예' : '아니오'

  return String(value)
}

function AttributeTable({
  attributes,
  rows,
}: {
  readonly attributes: ProductInfoProps['attributes']
  readonly rows: number | null
}) {
  const shown = rows === null ? attributes : attributes.slice(0, rows)

  return (
    <dl className="divide-border divide-y text-sm">
      {shown.map((entry) => (
        <div className="flex gap-4 py-2" key={entry.key}>
          <dt className="text-fg-muted w-28 shrink-0">{entry.label}</dt>
          <dd className="text-fg min-w-0">{show(entry.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ProductInfo({
  density,
  description,
  attributes,
  ratingAvg,
  ratingCount,
  messages,
}: ProductInfoProps) {
  /**
   * The estimated arrival — a value only the **browser** has.
   *
   * It depends on today, and the server's today is not reliably the visitor's, so
   * a render that read the clock would produce markup the browser then disagrees
   * with. `useSyncExternalStore` is the shape for exactly that: the server
   * snapshot is `null`, the client's is the date, and React reconciles them
   * without a warning and without an effect that sets state on mount.
   */
  const arrival = useSyncExternalStore(subscribeToNothing, arrivalSnapshot, serverSnapshot)

  const shipping =
    density === 1
      ? messages.shippingMinimal
      : density === 2
        ? messages.shippingSummary
        : messages.shippingDetailed

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-fg text-base font-semibold">{messages.descriptionLabel}</h2>
        <p className="text-fg-muted text-sm whitespace-pre-line">
          {description ?? messages.noDescription}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-fg text-base font-semibold">{messages.attributesLabel}</h2>

        {attributes.length === 0 ? null : density === 1 ? (
          // Folded at the minimal step, and folded by `<details>` rather than by
          // state: the browser's own disclosure is keyboard-operable, announces
          // itself, and survives a page that has not hydrated yet.
          <details className="text-sm">
            <summary className="min-h-touch text-fg-muted flex cursor-pointer items-center">
              {messages.attributesToggle}
            </summary>
            <AttributeTable attributes={attributes} rows={null} />
          </details>
        ) : (
          <AttributeTable attributes={attributes} rows={ATTRIBUTE_ROWS[density]} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-fg text-base font-semibold">{messages.shippingLabel}</h2>
        <p className="text-fg-muted text-sm">{shipping}</p>
        {density === 3 && arrival !== null ? (
          <p className="text-fg-subtle text-sm">
            {messages.estimatedArrival.replace('{date}', arrival)}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-fg text-base font-semibold">{messages.reviewsLabel}</h2>

        {density === 1 ? (
          <p className="text-fg-muted text-sm">{messages.reviewsLink}</p>
        ) : (
          <>
            <p className="text-fg text-sm">
              {messages.reviewsSummary
                .replace('{score}', (ratingAvg / 100).toFixed(1))
                .replace('{count}', ratingCount.toLocaleString('ko-KR'))}
            </p>
            <p className="text-fg-subtle text-sm">{messages.reviewsComingSoon}</p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-fg text-base font-semibold">{messages.inquiriesLabel}</h2>
        <p className="text-fg-subtle text-sm">{messages.inquiriesComingSoon}</p>
      </section>

      {density === 3 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-fg text-base font-semibold">{messages.recommendationsLabel}</h2>
          <p className="text-fg-subtle text-sm">{messages.recommendationsComingSoon}</p>
        </section>
      ) : null}
    </div>
  )
}
