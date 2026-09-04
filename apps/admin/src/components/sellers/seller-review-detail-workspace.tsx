'use client'

import type { Seller } from '@shopping/shared'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  linkClassName,
  Skeleton,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import NextLink from 'next/link'
import { useCallback, useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import { failureMessage, quotableRequestId } from '@/lib/api-failure'
import { useAuthorization } from '@/lib/auth/authorization'
import type { ErrorMessages } from '@/lib/errors'
import type { SellerDecision } from '@/lib/sellers/decisions'
import { statusVariant } from '@/lib/sellers/decisions'
import { reviewDate, reviewDateTime } from '@/lib/sellers/format'
import { useDecisionDenial } from '@/lib/sellers/use-decision-denial'
import { useSellerReviewDetail } from '@/lib/sellers/use-seller-review-detail'
import type { ErrorNoticeMessages, SellerReviewMessages } from '@/messages'

import { SellerDecisionActions } from './seller-decision-actions'
import type { SellerDecisionOutcome } from './seller-decision-dialog'
import { SellerDecisionDialog } from './seller-decision-dialog'

/**
 * `/sellers/[id]` — one application in full, and the same decisions the queue
 * offers.
 *
 * **What this screen adds over a row is the parts a table cannot hold**: the
 * whole introduction, the logo, the applicant's account, and the last status
 * change with its reason unabbreviated. It does not add authority — the queue
 * decides too, because a review console that made an operator open forty detail
 * pages to clear forty applications would be a worse console (TASK-0110 4장).
 *
 * **A 404 is not an error state.** An application that has been removed, or an
 * id somebody typed wrong, has a next action — go back to the list — and no
 * retry that could help. `ErrorState`'s retry button there would be a button
 * that reliably does nothing.
 */

interface SellerReviewDetailWorkspaceProps {
  readonly sellerId: string
  readonly messages: SellerReviewMessages
  readonly errors: ErrorMessages
  readonly notice: ErrorNoticeMessages
}

export function SellerReviewDetailWorkspace({
  sellerId,
  messages,
  errors,
  notice,
}: SellerReviewDetailWorkspaceProps) {
  const { ready, can, reason } = useAuthorization()

  if (!ready) return <Skeleton label={messages.detail.loadingLabel} lines={6} />

  if (!can('seller.approve')) {
    return <EmptyState description={reason('seller.approve')} title={messages.forbiddenTitle} />
  }

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <SellerReviewDetail errors={errors} messages={messages} notice={notice} sellerId={sellerId} />
    </ToastProvider>
  )
}

function SellerReviewDetail({
  sellerId,
  messages,
  errors,
  notice,
}: SellerReviewDetailWorkspaceProps) {
  const detail = useSellerReviewDetail(sellerId)
  const denialFor = useDecisionDenial(messages)
  const { toast } = useToast()

  const [pending, setPending] = useState<SellerDecision | null>(null)
  const [reported, setReported] = useState<ApiFailure | null>(null)

  const describe = useCallback(
    (failure: ApiFailure): string =>
      failureMessage(failure, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { state } = detail
  const seller = state.status === 'ready' ? state.seller : null
  const failure = state.status === 'error' ? state.failure : null
  const missing = failure?.kind === 'http' && failure.status === 404

  async function decide(
    decision: SellerDecision,
    reasonText: string | undefined,
  ): Promise<SellerDecisionOutcome> {
    const result = await detail.decide(decision, reasonText)

    if (result.ok) {
      setPending(null)
      toast({ title: messages.toast.decided[decision], variant: 'success' })

      return { kind: 'done' }
    }

    if (result.conflict) {
      setPending(null)
      toast({ title: messages.toast.conflict, variant: 'danger' })

      return { kind: 'handled' }
    }

    if (quotableRequestId(result.failure) !== null) {
      setPending(null)
      setReported(result.failure)

      return { kind: 'handled' }
    }

    return { failure: result.failure, kind: 'refused' }
  }

  return (
    <div className="flex flex-col gap-4">
      <NextLink className={linkClassName('subtle')} href="/sellers">
        {messages.detail.backLabel}
      </NextLink>

      {reported === null ? null : (
        <ErrorNotice
          action={
            <Button
              onClick={() => {
                setReported(null)
              }}
              size="sm"
              variant="ghost"
            >
              {notice.dismissLabel}
            </Button>
          }
          copiedLabel={notice.copiedLabel}
          copyLabel={notice.copyLabel}
          description={describe(reported)}
          requestIdHint={notice.requestIdHint}
          requestIdLabel={notice.requestIdLabel}
          title={notice.title}
          {...requestIdProp(reported)}
        />
      )}

      <DataList
        // A detail screen is one row or none; the "empty" branch of `DataList`
        // is the removed application, which is why it carries the 404 copy.
        empty={
          <EmptyState
            description={messages.detail.notFoundDescription}
            title={messages.detail.notFoundTitle}
          />
        }
        error={
          <ErrorState
            description={failure === null ? undefined : describe(failure)}
            onRetry={detail.reload}
            retryLabel={messages.retryLabel}
            title={messages.detail.errorTitle}
          />
        }
        loading={<Skeleton label={messages.detail.loadingLabel} lines={6} />}
        state={state.status === 'error' ? (missing ? 'empty' : 'error') : state.status}
      >
        {seller === null ? null : (
          <SellerFacts
            denialFor={denialFor}
            messages={messages}
            onDecide={setPending}
            seller={seller}
          />
        )}
      </DataList>

      {pending === null || seller === null ? null : (
        <SellerDecisionDialog
          decision={pending}
          errors={errors}
          messages={messages}
          onCancel={() => {
            setPending(null)
          }}
          onConfirm={(reasonText) => decide(pending, reasonText)}
          seller={seller}
        />
      )}
    </div>
  )
}

function SellerFacts({
  seller,
  messages,
  denialFor,
  onDecide,
}: {
  readonly seller: Seller
  readonly messages: SellerReviewMessages
  readonly denialFor: (decision: SellerDecision) => string | undefined
  readonly onDecide: (decision: SellerDecision) => void
}) {
  const copy = messages.detail

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="seller-application" className="flex flex-col gap-3">
        <h2 className="text-base font-medium" id="seller-application">
          {copy.applicationTitle}
        </h2>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-fg-muted">{copy.brandNameLabel}</dt>
          <dd className="font-medium">{seller.brandName}</dd>

          <dt className="text-fg-muted">{copy.slugLabel}</dt>
          <dd>
            <code className="text-xs">{seller.slug}</code>
          </dd>

          <dt className="text-fg-muted">{copy.ownerLabel}</dt>
          <dd>
            <code className="text-xs">{seller.userId}</code>
          </dd>

          <dt className="text-fg-muted">{copy.appliedAtLabel}</dt>
          <dd>{reviewDate(seller.createdAt)}</dd>

          <dt className="text-fg-muted">{copy.introductionLabel}</dt>
          <dd className="whitespace-pre-wrap">{seller.introduction ?? messages.emptyValue}</dd>

          <dt className="text-fg-muted">{copy.logoLabel}</dt>
          <dd>
            {seller.logoUrl === null ? (
              messages.emptyValue
            ) : (
              // A plain `<img>`: `next/image` would need the storage host in
              // `images.remotePatterns`, and a review console showing one logo
              // is not where that configuration should be decided.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={copy.logoAlt}
                className="border-border h-16 w-16 rounded border object-contain"
                src={seller.logoUrl}
              />
            )}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="seller-status" className="flex flex-col gap-3">
        <h2 className="text-base font-medium" id="seller-status">
          {copy.statusTitle}
        </h2>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-fg-muted">{copy.statusLabel}</dt>
          <dd>
            <Badge variant={statusVariant(seller.status)}>
              {messages.statusLabels[seller.status]}
            </Badge>
          </dd>

          <dt className="text-fg-muted">{copy.changedAtLabel}</dt>
          <dd>{reviewDateTime(seller.statusChangedAt, messages.emptyValue)}</dd>

          <dt className="text-fg-muted">{copy.reasonLabel}</dt>
          <dd className="whitespace-pre-wrap">{seller.statusReason ?? messages.emptyValue}</dd>
        </dl>

        <SellerDecisionActions
          align="start"
          denialFor={denialFor}
          emptyLabel={copy.noActions}
          messages={messages}
          onSelect={onDecide}
          seller={seller}
          size="md"
        />
      </section>
    </div>
  )
}

/** `{ requestId }` when there is one worth quoting, `{}` otherwise. */
function requestIdProp(failure: ApiFailure): { requestId?: string } {
  const id = quotableRequestId(failure)

  return id === null ? {} : { requestId: id }
}
