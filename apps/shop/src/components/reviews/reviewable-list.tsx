'use client'

import type { ApiFailure, Review, ReviewableItem } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import { Button, DataList, EmptyState, Tag } from '@shopping/ui/components'
import { formatDate } from '@shopping/ui/format'
import { useState } from 'react'

import { writableWindow } from '@/lib/reviews/writable-window'
import type { ReviewDraft, ReviewOutcome } from '@/lib/reviews/use-reviewable-items'
import { useReviewableItems } from '@/lib/reviews/use-reviewable-items'
import type { MyPageMessages, ReviewWriteMessages, ReviewWindowMessages } from '@/messages'

import { AccountLoadFailure, AccountLoading } from '../mypage/account-notices'

import { ReviewForm } from './review-form'

const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * `/mypage/reviews` — 「리뷰 쓸 수 있는 주문」과 그 자리에서의 작성 (TASK-0083 F6 · F7).
 *
 * ## 목록이 곧 「쓸 수 있다」의 정의다
 *
 * 서버가 쓸 수 있는 것만 담아 보낸다(`GET /me/reviewable-items`). 화면이 주문 상태로
 * 다시 판단하지 않는 이유는 그 규칙이 세 앱에 흩어지기 때문이고, 기한처럼 배포 설정에
 * 달린 값은 화면이 **틀린 날짜를 자신 있게** 적게 된다. 남은 기간도 서버가 준
 * `writableUntil` 을 옮긴 것뿐이다.
 *
 * ## 폼은 줄 안에서 열린다
 *
 * 라우트를 하나 더 두면 「어느 주문의 리뷰인가」를 주소로 날라야 하고, 그 주소는
 * `orderItemId` 를 그대로 노출한다. 다이얼로그면 사진 업로드가 그 안에서 돌고, 360px
 * 맥시멀에서 스크롤 안의 스크롤이 된다(반품 신청서가 같은 이유로 라우트가 되었다).
 * 줄 안의 disclosure 는 셋 중 어느 대가도 치르지 않는다.
 *
 * ## 쓴 뒤에도 줄은 남는다
 *
 * 목록을 다시 읽으면 방금 쓴 리뷰가 화면에서 사라지고, 사람은 자기가 무엇을 썼는지
 * 확인할 자리를 잃는다. 그래서 줄은 남고 **그 자리가 「방금 쓴 리뷰」가 된다** —
 * 계약에 「내가 쓴 리뷰」 목록이 없으므로(`reviews.ts`), 고치고 지우는 일이 일어날 수
 * 있는 유일한 자리이기도 하다. 화면은 그 경계를 문장으로 말한다.
 */
export function ReviewableList({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.reviews
  const reviewable = useReviewableItems()

  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg-subtle text-sm">{copy.written.sessionOnlyNotice}</p>

      <DataList
        empty={<EmptyState description={copy.emptyBody} title={copy.emptyTitle} />}
        error={
          reviewable.state.status === 'error' ? (
            <AccountLoadFailure
              failure={reviewable.state.failure}
              messages={{ ...messages, loadErrorTitle: copy.loadErrorTitle }}
              onRetry={reviewable.reload}
            />
          ) : null
        }
        loading={<AccountLoading label={copy.loadingLabel} rows={3} />}
        state={listState(reviewable.state.status, reviewable.items.length)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-fg-muted text-sm">
            {copy.countLabel.replace('{count}', String(reviewable.items.length))}
          </p>

          <ul aria-label={copy.listLabel} className="flex flex-col gap-3">
            {reviewable.items.map((item) => (
              <ReviewableRow
                busy={reviewable.pending === item.orderItemId}
                copy={copy}
                failure={reviewable.failures[item.orderItemId] ?? null}
                item={item}
                key={item.orderItemId}
                messages={messages}
                onDelete={(reviewId) => reviewable.remove(item.orderItemId, reviewId)}
                onEdit={(reviewId, draft) => reviewable.edit(item.orderItemId, reviewId, draft)}
                onWrite={(draft) => reviewable.write(item.orderItemId, draft)}
                outcome={reviewable.outcomes[item.orderItemId] ?? null}
              />
            ))}
          </ul>

          {reviewable.hasMore ? (
            <div>
              <Button
                loading={reviewable.loadingMore}
                onClick={reviewable.loadMore}
                size="sm"
                type="button"
                variant="outline"
              >
                {reviewable.loadingMore ? copy.moreLoading : copy.moreLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </DataList>
    </div>
  )
}

/**
 * 한 줄 — 무엇을 샀는지, 언제까지 쓸 수 있는지, 그리고 폼.
 *
 * **기한이 지난 줄도 그린다.** 목록을 받은 뒤에도 시간이 흐르고, 열어 둔 화면이
 * 자정을 넘길 수 있다. 그때 「쓰기」를 그대로 두면 서버가 `REVIEW_WINDOW_CLOSED` 로
 * 거절하는 일을 화면이 권하는 셈이 된다.
 */
function ReviewableRow({
  busy,
  copy,
  failure,
  item,
  messages,
  onDelete,
  onEdit,
  onWrite,
  outcome,
}: {
  readonly busy: boolean
  readonly copy: ReviewWriteMessages
  readonly failure: ApiFailure | null
  readonly item: ReviewableItem
  readonly messages: MyPageMessages
  readonly onDelete: (reviewId: string) => Promise<boolean>
  readonly onEdit: (reviewId: string, draft: ReviewDraft) => Promise<boolean>
  readonly onWrite: (draft: ReviewDraft) => Promise<boolean>
  readonly outcome: ReviewOutcome | null
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const written = outcome?.kind === 'written' ? outcome.review : null
  const deleted = outcome?.kind === 'deleted'
  const window = writableWindow(item.writableUntil, new Date())

  return (
    <li className="border-border flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-fg text-sm font-medium">{item.productName}</p>
        {item.optionLabel === null ? null : (
          <p className="text-fg-muted text-xs">{item.optionLabel}</p>
        )}
        <p className="text-fg-subtle text-xs">
          {copy.deliveredAt.replace(
            '{date}',
            formatDate(item.deliveredAt, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE }),
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            기한이 지난 줄은 강조하지 않는다 — `Tag` 에는 위험을 뜻하는 변형이 없고,
            남은 기간은 경고가 아니라 사실이다. 다른 것은 **문장**이며, 그 아래의
            「쓰기」가 눌리지 않는다는 사실이 그것을 확인해 준다.
          */}
          <Tag variant={window.kind === 'expired' ? 'neutral' : 'primary'}>
            {windowSentence(window, copy.window)}
          </Tag>
          <span className="text-fg-subtle text-xs">
            {copy.window.until.replace(
              '{date}',
              formatDate(item.writableUntil, {
                locale: LOCALE,
                style: 'date',
                timeZone: TIME_ZONE,
              }),
            )}
          </span>
        </div>
      </div>

      {failure === null ? null : (
        <p className="text-danger text-sm" role="status">
          {failureMessage(failure, messages)}
        </p>
      )}

      {deleted ? <p className="text-fg-muted text-sm">{copy.written.deletedNotice}</p> : null}

      {written !== null && !editing ? (
        <WrittenReview
          busy={busy}
          confirming={confirming}
          copy={copy}
          onConfirmDelete={() => {
            void onDelete(written.id)
            setConfirming(false)
          }}
          onDismissDelete={() => {
            setConfirming(false)
          }}
          onEdit={() => {
            setEditing(true)
          }}
          onRequestDelete={() => {
            setConfirming(true)
          }}
          review={written}
        />
      ) : null}

      {written === null && !deleted && !open ? (
        <div>
          <Button
            aria-disabled={window.kind === 'expired'}
            onClick={() => {
              // `aria-disabled` 는 클릭을 막지 않는다 — 막는 것은 여기다. 서버가
              // 거절할 요청을 보내 봐야 사람이 얻는 것은 오류 문장뿐이다.
              if (window.kind !== 'expired') setOpen(true)
            }}
            size="sm"
            type="button"
          >
            {copy.writeLabel}
          </Button>
        </div>
      ) : null}

      {(open && written === null && !deleted) || editing ? (
        <ReviewForm
          busy={busy}
          cancelLabel={copy.cancelLabel}
          copy={copy.form}
          initial={
            written === null
              ? null
              : {
                  content: written.content,
                  // 계약이 읽기에는 `{ key, url }` 을, 쓰기에는 **열쇠만** 싣는다.
                  // 고치는 폼이 시작할 자리는 「지금 붙어 있는 열쇠 전부」다.
                  imageKeys: written.images.map((image) => image.key),
                  rating: written.rating,
                }
          }
          onCancel={() => {
            setOpen(false)
            setEditing(false)
          }}
          onSubmit={(draft) => {
            const send = written === null ? onWrite(draft) : onEdit(written.id, draft)

            void send.then((ok) => {
              if (ok) {
                setOpen(false)
                setEditing(false)
              }
            })
          }}
          submitLabel={written === null ? copy.form.submit : copy.form.saveLabel}
          submittingLabel={written === null ? copy.form.submitting : copy.form.saving}
        />
      ) : null}
    </li>
  )
}

/** 방금 쓴 리뷰 — 무엇을 썼는지와, 고치거나 지우는 두 버튼. */
function WrittenReview({
  busy,
  confirming,
  copy,
  onConfirmDelete,
  onDismissDelete,
  onEdit,
  onRequestDelete,
  review,
}: {
  readonly busy: boolean
  readonly confirming: boolean
  readonly copy: ReviewWriteMessages
  readonly onConfirmDelete: () => void
  readonly onDismissDelete: () => void
  readonly onEdit: () => void
  readonly onRequestDelete: () => void
  readonly review: Review
}) {
  return (
    <div className="border-border bg-surface-muted flex flex-col gap-2 rounded-md border p-3">
      <p className="text-fg text-sm font-semibold">{copy.written.title}</p>
      <p className="text-fg-muted text-xs">{copy.written.body}</p>
      <p className="text-fg text-sm">
        {copy.form.ratingOption.replace('{score}', String(review.rating))}
      </p>
      <p className="text-fg text-sm whitespace-pre-line">{review.content}</p>

      {confirming ? (
        <div className="flex flex-col gap-2">
          {/*
            지우는 것은 되돌릴 수 없다 — 같은 주문 항목에 다시 쓸 수 없다
            (`Review.orderItemId` 가 unique 다). 그래서 한 번 더 묻는다.
          */}
          <p className="text-fg text-sm">{copy.written.deleteConfirm}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={busy}
              onClick={onConfirmDelete}
              size="sm"
              type="button"
              variant="danger"
            >
              {busy ? copy.written.deleting : copy.written.deleteConfirmOk}
            </Button>
            <Button onClick={onDismissDelete} size="sm" type="button" variant="ghost">
              {copy.written.deleteConfirmCancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onEdit} size="sm" type="button" variant="outline">
            {copy.written.editLabel}
          </Button>
          <Button onClick={onRequestDelete} size="sm" type="button" variant="ghost">
            {copy.written.deleteLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

/** 남은 기간을 문장으로. 셋을 나누는 이유는 `writable-window.ts` 에 적혀 있다. */
function windowSentence(
  window: ReturnType<typeof writableWindow>,
  copy: ReviewWindowMessages,
): string {
  if (window.kind === 'expired') return copy.expired
  if (window.kind === 'lastDay') return copy.lastDay

  return copy.daysLeft.replace('{days}', String(window.days))
}

/**
 * `DataList` 가 읽는 네 상태.
 *
 * 「받았는데 비었다」와 「아직 안 왔다」를 가르는 것이 요점이다 — 둘을 뭉치면 리뷰를
 * 쓸 것이 없는 사람에게 영원한 스켈레톤이 보인다.
 */
function listState(
  status: 'loading' | 'error' | 'ready',
  count: number,
): 'loading' | 'error' | 'ready' | 'empty' {
  if (status !== 'ready') return status

  return count === 0 ? 'empty' : 'ready'
}
