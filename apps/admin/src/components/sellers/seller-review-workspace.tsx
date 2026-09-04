'use client'

import type { Seller, SellerStatus } from '@shopping/shared'
import { grantedScopes, sellerStatuses } from '@shopping/shared'
import {
  Button,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  Pagination,
  Select,
  Skeleton,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import { useCallback, useId, useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import { failureMessage, quotableRequestId } from '@/lib/api-failure'
import { useAuth } from '@/lib/auth/auth-context'
import { useAuthorization } from '@/lib/auth/authorization'
import type { ErrorMessages } from '@/lib/errors'
import type { SellerDecision } from '@/lib/sellers/decisions'
import { useDecisionDenial } from '@/lib/sellers/use-decision-denial'
import { useSellerReviewQueue } from '@/lib/sellers/use-seller-review'
import type { ErrorNoticeMessages, SellerReviewMessages } from '@/messages'

import type { SellerDecisionOutcome } from './seller-decision-dialog'
import { SellerDecisionDialog } from './seller-decision-dialog'
import { SellerReviewTable } from './seller-review-table'

/**
 * `/sellers` — the review queue, its filter, its pages and its four decisions.
 *
 * **The permission gate is in front of the fetch, not around the result.** An
 * account without `seller.approve` would be answered 403 by the API, and a
 * screen that showed that as "불러오지 못했어요 · 다시 시도" would be telling
 * somebody to retry something that can never succeed. The sentence comes from
 * TASK-0023's hook, so it is the one the API's `details` would carry.
 *
 * **The demo notice is about the subject, not the row.** A `DEMO_ADMIN` holds
 * `seller.approve` narrowed to `demo`, and whether *this* application belongs to
 * a demo account is not in the response — `sellerSchema` carries no
 * `ownerIsDemo` (TASK-0110 4장 · R4). Guessing per row would either disable the
 * demo administrator's own applications or promise them real ones, so the screen
 * says the true thing it can say and leaves the rest to the server's 403.
 */

/** The "every status" choice. Radix `Select` has no value for "no value". */
const ALL = 'ALL'

interface SellerReviewWorkspaceProps {
  readonly messages: SellerReviewMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** Copy for a failure nobody on this screen can fix (TASK-0117 4.4). */
  readonly notice: ErrorNoticeMessages
}

export function SellerReviewWorkspace({ messages, errors, notice }: SellerReviewWorkspaceProps) {
  const { ready, can, reason } = useAuthorization()

  // Still asking. Rendering the refusal here would flash "볼 수 없어요" at every
  // operator on every reload, because every permission answers `false` while the
  // boot renewal is in flight (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.loadingLabel} lines={6} />

  if (!can('seller.approve')) {
    return <EmptyState description={reason('seller.approve')} title={messages.forbiddenTitle} />
  }

  // The provider is here rather than in a wrapper component so that the screen
  // is one client boundary: `useToast` has to be called *under* it, which the
  // queue below is, and a component that provided a context and consumed it in
  // the same render would be a hook-order accident waiting to happen.
  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <SellerReviewQueue errors={errors} messages={messages} notice={notice} />
    </ToastProvider>
  )
}

function SellerReviewQueue({ messages, errors, notice }: SellerReviewWorkspaceProps) {
  const queue = useSellerReviewQueue()
  const denialFor = useDecisionDenial(messages)
  const { toast } = useToast()
  const { subject } = useAuth()
  const filterId = useId()

  /** The decision waiting on its dialog, or `null` when none is open. */
  const [pending, setPending] = useState<{
    readonly seller: Seller
    readonly decision: SellerDecision
  } | null>(null)

  /** A failure with a reference number, held until the operator dismisses it. */
  const [reported, setReported] = useState<ApiFailure | null>(null)

  const describe = useCallback(
    (failure: ApiFailure): string =>
      failureMessage(failure, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { state, pagination } = queue
  const sellers = state.status === 'ready' ? state.sellers : []
  const loadFailure = state.status === 'error' ? state.failure : null

  /**
   * True when every grant this account holds for `seller.approve` is the demo
   * one — which is exactly `DEMO_ADMIN`. A question about the account, and
   * therefore answerable; the per-row version is not (see the class comment).
   */
  const approveScopes = subject === null ? [] : grantedScopes(subject, 'seller.approve')
  const demoScoped = approveScopes.length > 0 && approveScopes.every((scope) => scope === 'demo')

  const statusOptions = [
    { value: ALL, label: messages.filterAll },
    ...sellerStatuses.map((status) => ({ value: status, label: messages.statusLabels[status] })),
  ]

  async function decide(
    target: { readonly seller: Seller; readonly decision: SellerDecision },
    reasonText: string | undefined,
  ): Promise<SellerDecisionOutcome> {
    const result = await queue.decide(target.seller, target.decision, reasonText)

    if (result.ok) {
      setPending(null)
      toast({ title: messages.toast.decided[target.decision], variant: 'success' })

      return { kind: 'done' }
    }

    // Somebody decided first. The queue has already been re-read, so the row
    // under the operator has just changed — saying so is what keeps that from
    // looking like their own click did it.
    if (result.conflict) {
      setPending(null)
      toast({ title: messages.toast.conflict, variant: 'danger' })

      return { kind: 'handled' }
    }

    // Nobody on this screen can act on a 5xx, and the one thing the reader is
    // asked to do with the reference is copy it somewhere else — which a toast
    // that disappears makes impossible (TASK-0117 4.4).
    if (quotableRequestId(result.failure) !== null) {
      setPending(null)
      setReported(result.failure)

      return { kind: 'handled' }
    }

    return { failure: result.failure, kind: 'refused' }
  }

  return (
    <div className="flex flex-col gap-4">
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

      {demoScoped ? (
        <p className="border-border bg-surface-muted text-fg-muted rounded-md border p-3 text-sm">
          {messages.demoScopeNotice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-fg-muted text-sm" htmlFor={filterId}>
          {messages.filterLabel}
        </label>
        <Select
          id={filterId}
          onValueChange={(next) => {
            queue.select(next === ALL ? null : (next as SellerStatus))
          }}
          options={statusOptions}
          size="sm"
          value={queue.status ?? ALL}
        />
      </div>

      <DataList
        empty={
          queue.status === null ? (
            <EmptyState description={messages.emptyDescription} title={messages.emptyTitle} />
          ) : (
            <EmptyState
              description={messages.filteredEmptyDescription}
              title={messages.filteredEmptyTitle}
            />
          )
        }
        error={
          <ErrorState
            description={loadFailure === null ? undefined : describe(loadFailure)}
            onRetry={queue.reload}
            retryLabel={messages.retryLabel}
            title={messages.errorTitle}
          />
        }
        loading={<Skeleton label={messages.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (sellers.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <SellerReviewTable
          denialFor={denialFor}
          messages={messages}
          onDecide={(seller, decision) => {
            setPending({ decision, seller })
          }}
          sellers={sellers}
        />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.pagination.label}
          nextLabel={messages.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, sellers.length)}
        />
      </DataList>

      {pending === null ? null : (
        <SellerDecisionDialog
          decision={pending.decision}
          errors={errors}
          messages={messages}
          onCancel={() => {
            setPending(null)
          }}
          onConfirm={(reasonText) => decide(pending, reasonText)}
          seller={pending.seller}
        />
      )}
    </div>
  )
}

/**
 * `2 페이지 · 20건`.
 *
 * Concatenated from catalog pieces rather than filled into a template: a
 * placeholder is one more thing that can be rendered as `{page}` at somebody,
 * and the numbers here need no grammar around them.
 */
function pageStatus(messages: SellerReviewMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}

/** `{ requestId }` when there is one worth quoting, `{}` otherwise. */
function requestIdProp(failure: ApiFailure): { requestId?: string } {
  const id = quotableRequestId(failure)

  return id === null ? {} : { requestId: id }
}
