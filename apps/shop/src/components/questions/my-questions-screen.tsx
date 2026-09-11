'use client'

import { ProductIdentity } from '@shopping/ui/components'

import { Button, EmptyState, Tag } from '@shopping/ui/components'
import { formatDate } from '@shopping/ui/format'
import Link from 'next/link'

import { AccountLoadFailure, AccountLoading } from '@/components/mypage/account-notices'
import { useMyQuestions } from '@/lib/questions/use-my-questions'
import type { MyPageMessages } from '@/messages'

const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * `/mypage/questions` — 내가 남긴 문의 (TASK-0088 F7).
 *
 * **비공개로 남긴 것도 여기 있다.** 상품 상세에서는 남에게 보이지 않지만, 자기가 쓴
 * 것을 다시 볼 자리가 없으면 비공개 문의는 남기는 순간 사라지는 글이 된다.
 *
 * 답변이 있는 줄에는 그 답변이 함께 온다(`myQuestionSchema.answer`). 그래서 이
 * 화면은 문의 하나마다 요청을 더 보내지 않는다.
 *
 * **여기에 신고 버튼은 없다.** 전부 자기 글이라 서버가 `REPORT_OWN_CONTENT` 로
 * 거절한다 — 답변은 판매자의 글이지만, 자기 문의에 달린 답변을 신고하는 자리는 그
 * 답변이 보이는 상품 상세다.
 */
export function MyQuestionsScreen({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.questions
  const mine = useMyQuestions()

  if (mine.state.status === 'loading') return <AccountLoading label={copy.loadingLabel} />

  if (mine.state.status === 'error') {
    return (
      <AccountLoadFailure failure={mine.state.failure} messages={messages} onRetry={mine.reload} />
    )
  }

  if (mine.questions.length === 0) {
    return <EmptyState description={copy.emptyBody} title={copy.emptyTitle} />
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={copy.listLabel} className="flex flex-col">
        {mine.questions.map((question) => (
          <li
            className="border-border flex flex-col gap-2 border-b py-4 last:border-b-0"
            key={question.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Tag variant={question.answer === null ? 'neutral' : 'primary'}>
                {question.answer === null ? copy.pendingBadge : copy.answeredBadge}
              </Tag>
              {question.isPublic ? null : <Tag>{copy.privateBadge}</Tag>}
              <span className="text-fg-subtle text-xs">
                {formatDate(question.createdAt, {
                  locale: LOCALE,
                  style: 'date',
                  timeZone: TIME_ZONE,
                })}
              </span>
            </div>

            <Link
              className="text-fg-muted text-xs underline-offset-2 hover:underline"
              href={`/products/${question.productId}`}
            >
              <ProductIdentity src={question.thumbnailUrl}>
                {copy.openProduct.replace('{name}', question.productName)}
              </ProductIdentity>
            </Link>

            <p className="text-fg text-sm whitespace-pre-line">{question.content}</p>

            {question.answer === null ? null : (
              <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3">
                <p className="text-fg text-xs font-semibold">
                  {copy.answerLabel.replace('{brand}', question.answer.brandName)}
                </p>
                <p className="text-fg-muted text-sm whitespace-pre-line">
                  {question.answer.content}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>

      {mine.hasMore ? (
        <div>
          <Button
            loading={mine.loadingMore}
            onClick={mine.loadMore}
            size="sm"
            type="button"
            variant="outline"
          >
            {mine.loadingMore ? copy.moreLoading : copy.moreLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
