'use client'

import type { SellerProductReview } from '@shopping/shared'
import { Badge, Button } from '@shopping/ui/components'
import { useId } from 'react'

import { day, dateTime } from '@/lib/orders/format'
import { isUnanswered, ratingStars } from '@/lib/reviews/review-console'
import type { ReviewReplyWrite } from '@/lib/reviews/use-seller-product-reviews'
import type { Messages } from '@/messages'

import { ReviewReplyForm } from './review-reply-form'

/**
 * 리뷰 한 장과 그 아래의 답변 (TASK-0085 F1 · F5).
 *
 * ## 표가 아니라 카드다
 *
 * 이 콘솔의 다른 목록은 전부 `Table`/`TableToCards` 짝이고 여기만 다르다. 이유는
 * 실려 있는 것의 모양이다: 리뷰의 본문은 **길이가 정해지지 않은 글**이고, 그 아래에
 * 붙는 것은 **또 다른 긴 글을 쓰는 폼**이다. 표의 칸 안에 그 둘을 넣으면 데스크톱에서
 * 한 줄이 화면 높이를 넘고, 360px 에서는 열 이름과 값이 번갈아 나오는 카드 안에
 * 텍스트에어리어가 들어앉는다.
 *
 * **읽는 순서도 다르다.** 표는 열을 가로질러 비교하려고 읽고, 이 화면은 한 건씩
 * 읽고 답한다 — 비교할 열이 없으므로 표가 주는 것이 없다.
 *
 * ## 미답변이 위에 오는 것은 서버의 일이다
 *
 * 여기서 정렬하지 않는다 (F5). 서버가 「답변 여부, id」로 정렬해 보내고, 화면이 한 번
 * 더 정렬하면 그 순서는 **이 페이지 안에서만** 참이 된다.
 */
export interface ReviewCardProps {
  readonly review: SellerProductReview
  /** 이 줄의 답변 폼이 열려 있는가. 한 번에 하나만 열린다 — 목록이 정한다. */
  readonly editing: boolean
  /** 이 줄에 쓰기가 나가 있다. 그 줄의 버튼만 잠근다 (U3). */
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onCancelEdit: () => void
  readonly onRemove: () => void
  readonly save: (reviewId: string, content: string) => Promise<ReviewReplyWrite>
  readonly onSaved: () => void
  readonly messages: Messages
}

export function ReviewCard({
  review,
  editing,
  busy,
  onEdit,
  onCancelEdit,
  onRemove,
  save,
  onSaved,
  messages,
}: ReviewCardProps) {
  const copy = messages.reviewList
  const card = copy.card
  const reply = copy.reply
  const headingId = useId()
  const unanswered = isUnanswered(review)

  return (
    <li
      aria-labelledby={headingId}
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {/*
          **상태를 색만으로 말하지 않는다.** 배지가 문장을 들고 있고 색은 그것을 거들
          뿐이다 (설계서 접근성 규칙). 답변 대기만 강조한다 — 둘 다 강조하면 아무것도
          강조되지 않고, 이 화면에서 눈이 찾아야 하는 것은 한쪽뿐이다.
        */}
        <Badge variant={unanswered ? 'warning' : 'neutral'}>
          {unanswered ? card.unansweredBadge : card.answeredBadge}
        </Badge>
        <h3 className="text-fg text-base font-medium" id={headingId}>
          {card.productLabel.replace('{name}', review.productName)}
        </h3>
      </div>

      <p className="flex flex-wrap items-baseline gap-x-2">
        {/*
          별 다섯 개는 보조 기술에게 숫자가 아니라 「검은 별 흰 별 흰 별…」이다.
          그래서 그림은 트리에서 빼고, 옆의 문장이 진짜 내용이다.
        */}
        <span aria-hidden="true" className="text-warning text-base">
          {ratingStars(review.rating)}
        </span>
        <span className="text-fg-muted text-sm">
          {card.ratingValue.replace('{rating}', String(review.rating))}
        </span>
      </p>

      <p className="text-fg text-sm whitespace-pre-wrap">{review.content}</p>

      <p className="text-fg-subtle flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span>{card.authorLabel.replace('{name}', review.authorName)}</span>
        <span>{card.writtenAt.replace('{date}', day(review.createdAt))}</span>
        {review.optionLabel === null ? null : (
          <span>{card.optionLabel.replace('{option}', review.optionLabel)}</span>
        )}
        {/*
          **사진은 장수만 말한다.** 계약은 이제 주소를 함께 보내 주지만(`images[].url`),
          이 화면이 그것을 그리지 않는 이유는 다른 데 있다 — 판매자가 여기서 하는 일은
          **답을 쓰는 것**이고, 사진은 그 판단에 거의 쓰이지 않으면서 목록의 높이를
          몇 배로 만든다. 사진을 봐야 하는 리뷰는 상품 상세에서 본다.
        */}
        {review.images.length === 0 ? null : (
          <span>{card.photoCount.replace('{count}', String(review.images.length))}</span>
        )}
      </p>

      {/*
        답변은 **리뷰 바로 아래**에 온다. 판매자가 보는 순서가 구매자가 보는 순서와
        같아야 「내가 쓴 말이 어떻게 읽히는지」를 여기서 알 수 있다 (F4 는 상품
        상세의 것이지만, 같은 배치를 콘솔에서도 지킨다).

        `<section aria-label>` 로 감싸지 않는다 — 그러면 줄마다 같은 이름의 랜드마크가
        하나씩 생기고, axe 의 `landmark-unique` 가 그것을 잡는다. 이 블록의 이름은
        아래 제목이 들고 있으면 충분하다.
      */}
      {review.reply === null ? null : (
        <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3">
          <h4 className="text-fg-muted text-xs font-medium">{reply.heading}</h4>
          <p className="text-fg text-sm whitespace-pre-wrap">{review.reply.content}</p>
          <p className="text-fg-subtle flex flex-wrap gap-x-2 text-xs">
            <span>{reply.authorLine.replace('{brand}', review.reply.brandName)}</span>
            <span>{reply.updatedAt.replace('{date}', dateTime(review.reply.updatedAt))}</span>
          </p>
        </div>
      )}

      {editing ? (
        <ReviewReplyForm
          initialContent={review.reply === null ? '' : review.reply.content}
          messages={messages}
          onCancel={onCancelEdit}
          onSaved={onSaved}
          reviewId={review.id}
          save={save}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {/*
            **하나의 버튼이 두 이름을 갖는다.** 가는 곳은 `PUT` 하나이고, 문구만
            「쓰기」와 「수정」으로 갈린다 — 리뷰당 답변이 하나라 그 둘이 서버에서
            같은 일이기 때문이다 (F3).
          */}
          <Button disabled={busy} onClick={onEdit} size="sm" type="button" variant="outline">
            {unanswered ? reply.writeLabel : reply.editLabel}
          </Button>
          {review.reply === null ? null : (
            <Button disabled={busy} onClick={onRemove} size="sm" type="button" variant="ghost">
              {reply.deleteLabel}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
