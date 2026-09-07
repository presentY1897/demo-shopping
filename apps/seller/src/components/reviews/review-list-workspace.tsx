'use client'

import type { ApiFailure, SellerProductReview } from '@shopping/shared'
import {
  DataList,
  EmptyState,
  ErrorState,
  Link,
  Pagination,
  Skeleton,
} from '@shopping/ui/components'
import { ConfirmDialog, useConfirm } from '@shopping/ui/form'
import { useCallback, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { count } from '@/lib/orders/format'
import { useSellerProductReviews } from '@/lib/reviews/use-seller-product-reviews'
import type { Messages } from '@/messages'
import { messagesFor } from '@/messages'

import { ReviewCard } from './review-card'
import { ReviewFilters } from './review-filters'
import { replyFailureMessage } from './review-reply-form'

/**
 * `/reviews` — 「무엇에 답해야 하는가」 (TASK-0085).
 *
 * 위에서 아래로 그 물음의 순서다: **답해야 할 건수**가 먼저 오고(F7), 그것을 좁히는
 * 필터가 그다음이며, 답할 것들이 그 아래에 온다. 반대로 놓으면 판매자가 이 화면에
 * 온 이유가 스크롤 아래에 있게 된다.
 *
 * **서버 렌더에서 아무것도 기다리지 않는다.** 제목과 설명은 이 경계 바깥에서 만들어져
 * 나가고, 그것이 이 목록에 네 상태가 있는 이유다 (P5 · U1).
 *
 * **「판매자 리뷰」가 아니라 「상품 리뷰」다.** `sellers.ts` 의 `SELLER_REVIEW_LIST_*`
 * 는 입점 심사 대기열이고 이 화면과 아무 관계가 없다.
 */
export interface ReviewListWorkspaceProps {
  readonly title: string
  readonly messages?: Messages
}

/** 입점 신청. 스토어가 없는 계정이 여기서 할 수 있는 유일한 다음 걸음이다. */
const APPLY_HREF = '/apply'

export function ReviewListWorkspace({ title, messages = messagesFor() }: ReviewListWorkspaceProps) {
  const { state } = useAuth()
  const copy = messages.reviewList
  const sellerId = state.status === 'signedIn' ? state.user.sellerId : null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-fg text-2xl font-bold">{title}</h1>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </header>

      {/*
        세션을 아직 모른다. 「스토어가 없다」와 **같은 화면을 보여 주면 안 되는** 상태다 —
        묻지도 않고 입점 신청을 권하는 셈이 된다.
      */}
      {state.status === 'checking' ? <Skeleton label={copy.loadingLabel} shape="text" /> : null}

      {/*
        스토어가 없는 계정. 목록을 **부르지도 않는다** — `sellerId` 없이 부르면 요청이
        거절되고, 아직 신청하지 않았을 뿐인 사람이 「불러오지 못했습니다」를 보게 된다.
      */}
      {state.status !== 'checking' && sellerId === null ? (
        <EmptyState
          action={<Link href={APPLY_HREF}>{copy.noStore.applyLabel}</Link>}
          description={copy.noStore.body}
          title={copy.noStore.title}
        />
      ) : null}

      {sellerId === null ? null : <ReviewConsole messages={messages} sellerId={sellerId} />}
    </div>
  )
}

/** 마지막 쓰기가 남긴 한 줄. 성공은 알림이고 실패는 경고다. */
type Notice =
  | { readonly kind: 'none' }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'failed'; readonly text: string }

/**
 * 뱃지 · 필터 · 목록, 그리고 그 셋이 함께 쓰는 저장소.
 *
 * `sellerId` 가 있는 것이 확실해진 뒤에 마운트된다. 훅 안에서 세션을 읽으면 「스토어가
 * 없을 때는 부르지 않는다」를 훅이 알아야 하고, 그러면 부르지 않는 이유가 훅과 화면
 * 두 곳에 적히게 된다.
 */
function ReviewConsole({
  sellerId,
  messages,
}: {
  readonly sellerId: string
  readonly messages: Messages
}) {
  const copy = messages.reviewList
  const reviews = useSellerProductReviews(sellerId)
  const gate = useConfirm()

  /** 지금 답변 폼이 열려 있는 줄. **한 번에 하나다** — 열 개의 텍스트에어리어를 동시에 두면 어느 것이 무엇의 답인지 잃는다. */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 지우기를 물어본 대상. 대화상자가 무엇을 지우는지 이름으로 말하기 위해 붙잡는다. */
  const [removalTarget, setRemovalTarget] = useState<SellerProductReview | null>(null)
  const [notice, setNotice] = useState<Notice>({ kind: 'none' })

  const { state, pagination } = reviews
  const items = state.status === 'ready' ? state.items : []

  const describe = useCallback(
    (failure: ApiFailure) => replyFailureMessage(failure, messages),
    [messages],
  )

  const onSaved = useCallback(() => {
    setEditingId(null)
    setNotice({ kind: 'done', text: copy.reply.savedNotice })
  }, [copy.reply.savedNotice])

  /**
   * 지우기 — **묻고 나서** 지운다.
   *
   * 확인을 세우는 이유는 되돌릴 수 없기 때문이다. 답변에는 이력이 없고(4장), 지운
   * 답변을 되살리는 길은 다시 쓰는 것뿐이다. 발행 중단처럼 같은 버튼이 되돌리는
   * 걸음에는 묻지 않는다 — 아무 데나 확인을 붙이면 진짜 물어야 할 자리에서 읽히지
   * 않는다 (`coupon-list-workspace.tsx` 가 그 반대쪽을 적어 두었다).
   */
  const requestRemoval = useCallback(
    async (review: SellerProductReview) => {
      setRemovalTarget(review)

      if (!(await gate.request())) return

      const result = await reviews.removeReply(review.id)

      setNotice(
        result.ok
          ? { kind: 'done', text: copy.reply.deletedNotice }
          : { kind: 'failed', text: describe(result.failure) },
      )
    },
    [copy.reply.deletedNotice, describe, gate, reviews],
  )

  return (
    <>
      {/*
        미답변 건수 (F7). 목록 위에 있는 이유는 **줄을 하나씩 읽기 전에** 할 일이
        몇 개인지 보이게 하기 위해서다. 그 수는 필터와 무관하고, 그 사실을 `note` 가
        적는다 — 적지 않으면 「미답변만」을 켠 판매자에게 뱃지와 목록의 차이가 버그로
        읽힌다.
      */}
      <section
        aria-label={copy.unanswered.regionLabel}
        className="border-border flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border p-3"
      >
        <h2 className="text-fg-muted text-sm">{copy.unanswered.regionLabel}</h2>
        {state.status === 'ready' ? (
          <p className="text-fg text-xl font-bold">
            {state.unansweredCount === 0
              ? copy.unanswered.none
              : copy.unanswered.value.replace('{count}', count(state.unansweredCount))}
          </p>
        ) : null}
        <p className="text-fg-subtle w-full text-xs">{copy.unanswered.note}</p>
      </section>

      <ReviewFilters
        disabled={state.status === 'loading'}
        messages={messages}
        onChange={reviews.setFilters}
        value={reviews.filters}
      />

      {/*
        마지막 쓰기의 결말. 성공은 `status`, 실패는 `alert` — 실패는 사람이 다음에 할
        일을 정해야 하는 소식이라 끼어들어도 되고, 성공은 그렇지 않다.
      */}
      {notice.kind === 'done' ? (
        <p
          className="border-success bg-success-surface text-fg rounded-md border px-4 py-3 text-sm"
          role="status"
        >
          {notice.text}
        </p>
      ) : null}

      {notice.kind === 'failed' ? (
        <p
          className="border-danger bg-danger-surface text-fg rounded-md border px-4 py-3 text-sm"
          role="alert"
        >
          {`${copy.reply.failureTitle} ${notice.text}`}
        </p>
      ) : null}

      <DataList
        empty={
          reviews.isFiltered ? (
            <EmptyState
              description={copy.filteredEmpty.description}
              title={copy.filteredEmpty.title}
            />
          ) : (
            <EmptyState description={copy.empty.description} title={copy.empty.title} />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={reviews.reload}
            retryLabel={copy.retry}
            title={copy.errorTitle}
          />
        }
        loading={<Skeleton label={copy.loadingLabel} shape="text" />}
        state={state.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <ul aria-label={copy.card.listLabel} className="flex flex-col gap-3">
          {items.map((review) => (
            <ReviewCard
              busy={reviews.pendingId === review.id}
              editing={editingId === review.id}
              key={review.id}
              messages={messages}
              onCancelEdit={() => {
                setEditingId(null)
              }}
              onEdit={() => {
                setEditingId(review.id)
              }}
              onRemove={() => {
                void requestRemoval(review)
              }}
              onSaved={onSaved}
              review={review}
              save={reviews.saveReply}
            />
          ))}
        </ul>

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={copy.pagination.label}
          nextLabel={copy.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={copy.pagination.previous}
          status={copy.pagination.page.replace('{page}', String(pagination.pageIndex + 1))}
        />
      </DataList>

      <ConfirmDialog
        cancelLabel={copy.reply.confirm.cancel}
        closeLabel={copy.reply.confirm.closeLabel}
        confirmLabel={copy.reply.confirm.confirm}
        description={copy.reply.confirm.description}
        destructive
        onConfirm={gate.confirm}
        onOpenChange={gate.onOpenChange}
        open={gate.open}
        title={copy.reply.confirm.title}
      >
        {removalTarget === null ? null : (
          <p className="text-fg-muted text-sm">
            {copy.card.productLabel.replace('{name}', removalTarget.productName)}
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
