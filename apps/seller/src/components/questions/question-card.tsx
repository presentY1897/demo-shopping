'use client'

import type { SellerQuestion } from '@shopping/shared'
import { Badge, Button } from '@shopping/ui/components'
import { useId } from 'react'

import { day, dateTime } from '@/lib/orders/format'
import { isUnanswered } from '@/lib/questions/question-console'
import type { QuestionAnswerWrite } from '@/lib/questions/use-seller-questions'
import type { Messages } from '@/messages'

import { QuestionAnswerForm } from './question-answer-form'

/**
 * 문의 한 장과 그 아래의 답변 (TASK-0088 F5).
 *
 * ## 표가 아니라 카드다
 *
 * `review-card.tsx` 와 같은 판단이고, 같은 이유다: 문의의 본문은 **길이가 정해지지
 * 않은 글**이고 그 아래에 붙는 것은 **또 다른 긴 글을 쓰는 폼**이다. 표의 칸 안에
 * 그 둘을 넣으면 데스크톱에서 한 줄이 화면 높이를 넘고, 360px 에서는 열 이름과 값이
 * 번갈아 나오는 카드 안에 텍스트에어리어가 들어앉는다. **읽는 순서도 다르다** —
 * 표는 열을 가로질러 비교하려고 읽고, 이 화면은 한 건씩 읽고 답한다.
 *
 * ## 미답변이 위에 오는 것은 서버의 일이다
 *
 * 여기서 정렬하지 않는다 (F5). 서버가 「답변 여부, id」로 정렬해 보내고, 화면이 한 번
 * 더 정렬하면 그 순서는 **이 페이지 안에서만** 참이 된다.
 *
 * ## 비공개 문의가 리뷰에는 없던 것이다
 *
 * 판매자에게는 비공개 문의도 온다 (4.2) — 답할 사람이 읽지 못하면 비공개 문의라는
 * 것이 성립하지 않기 때문이다. 그래서 이 카드가 리뷰 카드와 다른 유일한 자리가
 * **그 표시**이고, 표시는 「못 본다」가 아니라 「남들은 못 본다」를 말한다: 답변도
 * 공개되지 않는다는 사실을 적지 않으면 판매자는 공개 글을 쓰듯 답한다.
 */
export interface QuestionCardProps {
  readonly question: SellerQuestion
  /** 이 줄의 답변 폼이 열려 있는가. 한 번에 하나만 열린다 — 목록이 정한다. */
  readonly editing: boolean
  /** 이 줄에 쓰기가 나가 있다. 그 줄의 버튼만 잠근다. */
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onCancelEdit: () => void
  readonly onRemove: () => void
  readonly save: (questionId: string, content: string) => Promise<QuestionAnswerWrite>
  readonly onSaved: () => void
  readonly messages: Messages
}

export function QuestionCard({
  question,
  editing,
  busy,
  onEdit,
  onCancelEdit,
  onRemove,
  save,
  onSaved,
  messages,
}: QuestionCardProps) {
  const copy = messages.questionList
  const card = copy.card
  const answer = copy.answer
  const headingId = useId()
  const unanswered = isUnanswered(question)

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
        {/*
          비공개 표시. `warning` 이 아니라 `neutral` 인 이유는 이것이 **할 일이
          아니기** 때문이다 — 비공개 문의도 똑같이 답하면 되고, 강조해야 하는 것은
          「답하지 않았다」쪽 하나다.
        */}
        {question.isPublic ? null : <Badge variant="neutral">{card.privateBadge}</Badge>}
        <h3 className="text-fg text-base font-medium" id={headingId}>
          {card.productLabel.replace('{name}', question.productName)}
        </h3>
      </div>

      <p className="text-fg text-sm whitespace-pre-wrap">{question.content}</p>

      <p className="text-fg-subtle flex flex-wrap gap-x-3 gap-y-1 text-xs">
        <span>{card.authorLabel.replace('{name}', question.authorName)}</span>
        <span>{card.askedAt.replace('{date}', day(question.createdAt))}</span>
      </p>

      {/*
        답을 쓰기 전에 읽어야 하는 문장이라 **폼보다 위에** 둔다. 답변 폼의 힌트
        옆에 놓으면 이미 답을 쓰기 시작한 뒤에 읽게 된다.
      */}
      {question.isPublic ? null : (
        <p className="border-border bg-surface-muted text-fg-muted rounded-md border p-3 text-xs">
          {card.privateNote}
        </p>
      )}

      {/*
        답변은 **문의 바로 아래**에 온다. 판매자가 보는 순서가 구매자가 보는 순서와
        같아야 「내가 쓴 말이 어떻게 읽히는지」를 여기서 알 수 있다.

        `<section aria-label>` 로 감싸지 않는다 — 그러면 줄마다 같은 이름의 랜드마크가
        하나씩 생기고, axe 의 `landmark-unique` 가 그것을 잡는다. 이 블록의 이름은
        아래 제목이 들고 있으면 충분하다.
      */}
      {question.answer === null ? null : (
        <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3">
          <h4 className="text-fg-muted text-xs font-medium">{answer.heading}</h4>
          <p className="text-fg text-sm whitespace-pre-wrap">{question.answer.content}</p>
          <p className="text-fg-subtle flex flex-wrap gap-x-2 text-xs">
            <span>{answer.authorLine.replace('{brand}', question.answer.brandName)}</span>
            <span>{answer.updatedAt.replace('{date}', dateTime(question.answer.updatedAt))}</span>
          </p>
        </div>
      )}

      {editing ? (
        <QuestionAnswerForm
          initialContent={question.answer === null ? '' : question.answer.content}
          messages={messages}
          onCancel={onCancelEdit}
          onSaved={onSaved}
          questionId={question.id}
          save={save}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {/*
            **하나의 버튼이 두 이름을 갖는다.** 가는 곳은 `PUT` 하나이고, 문구만
            「쓰기」와 「수정」으로 갈린다 — 문의당 답변이 하나라 그 둘이 서버에서
            같은 일이기 때문이다 (4.3).
          */}
          <Button disabled={busy} onClick={onEdit} size="sm" type="button" variant="outline">
            {unanswered ? answer.writeLabel : answer.editLabel}
          </Button>
          {question.answer === null ? null : (
            <Button disabled={busy} onClick={onRemove} size="sm" type="button" variant="ghost">
              {answer.deleteLabel}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
