import type { Seller, SellerStatus } from '@shopping/shared'
import { Badge } from '@shopping/ui/components'
import { fill } from '@/lib/products/product-form'
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
  const { status, statusReason, followerCount } = seller
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

      {/*
       * 팔로워 수는 **영업 중일 때만** 보여준다 (TASK-0089 §3).
       *
       * 심사 중이거나 정지된 가게에서 이 수는 0이고, 0을 보여주는 것은 정보가 아니라
       * 잡음이다 — 그 화면에서 사람이 알고 싶은 것은 심사가 어떻게 됐는가다.
       *
       * 여기 있는 이유: 없으면 판매자가 자기 팔로워 수를 보려고 **자기 가게의 공개
       * 페이지를 열어야** 한다. 콘솔이 자기 가게에 대해 손님보다 모르는 상태가 된다.
       */}
      {status === 'ACTIVE' ? (
        <dl className="text-sm">
          <dt className="font-medium">{messages.followerLabel}</dt>
          <dd className="tabular-nums">
            {fill(messages.followerCount, { count: String(followerCount) })}
          </dd>
        </dl>
      ) : null}

      {statusReason === null ? null : (
        <dl className="text-sm">
          <dt className="font-medium">{messages.reasonLabel}</dt>
          <dd className="whitespace-pre-line">{statusReason}</dd>
        </dl>
      )}
    </section>
  )
}
