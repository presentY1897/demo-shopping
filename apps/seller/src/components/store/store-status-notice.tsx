import type { Seller, SellerStatus } from '@shopping/shared'
import { Badge } from '@shopping/ui/components'
import type { BadgeVariant } from '@shopping/ui/components'

import type { StoreStatusMessages } from '@/messages'

/**
 * The banner over the form — one per status, saying what the store may do and
 * why (TASK-0109 4장 상태별 얼굴).
 *
 * **It is a `<section>` with a heading, not an alert.** `role="alert"` interrupts
 * whatever a screen reader is reading, which is right for the answer to a button
 * somebody just pressed and wrong for the state of a page they opened: a
 * rejected seller arriving at `/apply` would have the reason shouted over the
 * heading. The banner is the first thing after the page heading instead, and
 * `statusReason` sits inside it where the reading order puts it.
 *
 * **The reason is the whole point of the rejected and suspended faces.** A
 * refusal with no sentence is a dead end — TASK-0108 stores `statusReason`
 * precisely so that the person it happened to can answer it — so the reason is
 * rendered whenever the API sent one, under a label rather than as bare prose.
 */

const VARIANTS: Readonly<Record<SellerStatus, BadgeVariant>> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
}

/** Tinted like the badge. `text-fg` on a tinted surface is the verified pair. */
const SURFACES: Readonly<Record<SellerStatus, string>> = {
  PENDING: 'border-warning bg-warning-surface',
  ACTIVE: 'border-success bg-success-surface',
  REJECTED: 'border-danger bg-danger-surface',
  SUSPENDED: 'border-danger bg-danger-surface',
}

export function StoreStatusNotice({
  seller,
  messages,
  headingId,
}: {
  readonly seller: Seller
  readonly messages: StoreStatusMessages
  /** So the section is named by its own heading rather than by a duplicate label. */
  readonly headingId: string
}) {
  const { status, statusReason } = seller
  const { title, body } = messages.notice[status]

  return (
    <section
      aria-labelledby={headingId}
      className={`text-fg flex flex-col gap-2 rounded-lg border px-4 py-4 ${SURFACES[status]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={VARIANTS[status]}>{messages.label[status]}</Badge>
        <h2 className="text-base font-medium" id={headingId}>
          {title}
        </h2>
      </div>

      <p className="text-sm">{body}</p>

      {statusReason === null ? null : (
        <dl className="text-sm">
          <dt className="font-medium">{messages.reasonLabel}</dt>
          <dd className="whitespace-pre-line">{statusReason}</dd>
        </dl>
      )}
    </section>
  )
}
