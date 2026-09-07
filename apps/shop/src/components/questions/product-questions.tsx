'use client'

import type { ProductQuestion } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import { Button, ErrorState, Skeleton, Tag } from '@shopping/ui/components'
import { useDensity } from '@shopping/ui/density'
import { formatDate } from '@shopping/ui/format'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useId, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { signInHref } from '@/lib/auth/next-path'
import { questionExposure } from '@/lib/questions/qna-exposure'
import { useProductQuestions } from '@/lib/questions/use-product-questions'
import type { ProductQuestionsMessages, RefusalMessages, ReportMessages } from '@/messages'

import { ReportDialog } from '../reports/report-dialog'

import { QuestionForm } from './question-form'

const LOCALE = 'ko-KR'
const TIME_ZONE = 'Asia/Seoul'

/**
 * 상품 상세의 문의 (TASK-0088 F1 · F2 · F6).
 *
 * ## 밀도가 정하는 것은 노출량이다
 *
 * | | 미니멀 | 표준 | 맥시멀 |
 * | --- | --- | --- | --- |
 * | 목록 | 접힘 | 접힘 | 처음부터 |
 *
 * **맥시멀에서만 목록이 보인다**(F6). 4장이 그렇게 정한 이유는 미니멀 상품 페이지에
 * 문의 목록이 붙으면 정보 밀도가 올라가 밀도 구분 자체가 흐려지기 때문이고, 표는
 * `lib/questions/qna-exposure.ts` 하나에 있다.
 *
 * 접힌 단계는 **아무것도 묻지 않는다.** 보이지도 않을 목록을 위해 요청을 하나 더
 * 보내면, 콜드 스타트가 90초인 이 배포에서 그것은 화면이 늦게 뜨는 이유가 된다
 * (TASK-0101). 펼치면 그때 부른다.
 *
 * ## 문의를 쓰는 자리는 세 단계 모두에 있다
 *
 * 접히는 것은 남이 쓴 것을 읽는 일이고, 자기가 묻는 일은 밀도와 무관하다 — 미니멀을
 * 고른 사람도 물어볼 것이 있다. 다만 폼을 여는 것은 목록을 부르는 일이기도 해서,
 * 접힌 단계에서 문의를 쓰면 그 자리에서 목록도 함께 펴진다 — 방금 쓴 것이 어디에도
 * 보이지 않으면 사람은 저장되지 않았다고 읽는다.
 *
 * ## 남의 비공개 문의는 목록에 **없다**
 *
 * 서버가 줄 자체를 보내지 않으므로(`questions.ts`), 화면은 「비공개 문의입니다」
 * 자리를 만들지 않는다 — 만들려면 몇 개가 감춰졌는지 세어야 하고, 그 수 자체가
 * 알아서는 안 될 것이다. 대신 그런 규칙이 있다는 사실을 한 줄로 말한다.
 */
export function ProductQuestions({
  copy,
  productId,
  refusals,
  report,
}: {
  readonly copy: ProductQuestionsMessages
  readonly productId: string
  readonly refusals: RefusalMessages
  readonly report: ReportMessages
}) {
  const { density } = useDensity()
  const exposure = questionExposure(density)
  const [expanded, setExpanded] = useState(false)
  const [asking, setAsking] = useState(false)
  const [written, setWritten] = useState(false)
  const [extra, setExtra] = useState(0)

  const open = exposure.open || expanded
  const questions = useProductQuestions(productId, open)
  const { state } = useAuth()
  const pathname = usePathname()
  const headingId = useId()

  const shown = questions.questions.slice(0, exposure.count + extra)

  /**
   * **더 보기는 두 가지 일을 한다.** 이미 받아 두었지만 밀도가 접어 둔 줄을 펴고,
   * 다 폈으면 다음 장을 받아 온다. 사람에게는 같은 한 가지이므로 버튼도 하나다.
   */
  function showMore(): void {
    setExtra((current) => current + exposure.count)
    questions.loadMore()
  }

  /** 폼을 여는 것은 목록을 펴는 일이기도 하다. 위 머리말의 이유. */
  function startAsking(): void {
    setExpanded(true)
    setAsking(true)
    setWritten(false)
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 className="text-fg text-base font-semibold" id={headingId}>
        {copy.heading}
      </h2>

      <div className="flex flex-wrap items-center gap-2">
        {state.status === 'signedIn' ? (
          <Button
            onClick={
              asking
                ? () => {
                    setAsking(false)
                  }
                : startAsking
            }
            size="sm"
            type="button"
            variant="outline"
          >
            {asking ? copy.cancelAskLabel : copy.askLabel}
          </Button>
        ) : (
          <Link
            className="text-primary min-h-touch inline-flex items-center text-sm underline"
            href={signInHref('/login', pathname)}
          >
            {copy.signInLabel}
          </Link>
        )}

        {open ? null : (
          <Button
            onClick={() => {
              setExpanded(true)
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {copy.expandLabel}
          </Button>
        )}
      </div>

      {asking ? (
        <QuestionForm
          busy={questions.asking}
          copy={copy.form}
          onSubmit={async (content, isPublic) => {
            const ok = await questions.ask(content, isPublic)

            if (ok) {
              setAsking(false)
              setWritten(true)
            }

            return ok
          }}
        />
      ) : null}

      {written ? (
        <p className="text-fg-muted text-sm" role="status">
          {copy.form.submittedNotice}
        </p>
      ) : null}

      {questions.askFailure === null ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-fg text-sm font-medium">{copy.form.failureTitle}</p>
          <p className="text-danger text-sm" role="status">
            {failureMessage(questions.askFailure, refusals)}
          </p>
        </div>
      )}

      {open ? (
        <>
          <p className="text-fg-subtle text-xs">{copy.privacyNotice}</p>

          {questions.state.status === 'loading' ? (
            <div aria-busy="true" aria-label={copy.loadingLabel} role="status">
              <Skeleton className="h-20 w-full" />
            </div>
          ) : null}

          {questions.state.status === 'error' ? (
            <ErrorState
              onRetry={questions.reload}
              retryLabel={copy.retryLabel}
              title={copy.errorTitle}
            />
          ) : null}

          {questions.state.status === 'ready' ? (
            shown.length === 0 ? (
              <div className="border-border flex flex-col gap-1 rounded-md border border-dashed p-4">
                <p className="text-fg text-sm font-medium">{copy.emptyTitle}</p>
                <p className="text-fg-muted text-sm">{copy.emptyBody}</p>
              </div>
            ) : (
              <ul aria-label={copy.listLabel} className="flex flex-col">
                {shown.map((question) => (
                  <QuestionRow
                    copy={copy}
                    key={question.id}
                    question={question}
                    refusals={refusals}
                    report={report}
                  />
                ))}
              </ul>
            )
          ) : null}

          {questions.state.status === 'ready' &&
          (questions.hasMore || shown.length < questions.questions.length) ? (
            <div>
              <Button
                loading={questions.loadingMore}
                onClick={showMore}
                size="sm"
                type="button"
                variant="outline"
              >
                {questions.loadingMore ? copy.moreLoading : copy.moreLabel}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

/**
 * 문의 한 줄과 그 답변.
 *
 * 답변이 문의 **아래**인 것은 답변이 문의에 대한 말이기 때문이다. 위에 두면 읽는
 * 순서가 뒤집힌다 (리뷰의 판매자 답변과 같은 판단).
 *
 * **신고 버튼이 둘일 수 있다.** 문의와 답변은 다른 대상이고(`REPORT_TARGET_TYPES`),
 * 관리자가 가리는 것도 그중 하나뿐이다 — 하나로 합치면 답변이 문제인 신고가 문의를
 * 가린다.
 *
 * 자기 문의에는 신고 버튼을 두지 않는다. 서버가 `REPORT_OWN_CONTENT` 로 거절하므로
 * (`mine`), 보여 주면 그것은 누를 수 있는 것처럼 보이는 막다른 길이다.
 */
function QuestionRow({
  copy,
  question,
  refusals,
  report,
}: {
  readonly copy: ProductQuestionsMessages
  readonly question: ProductQuestion
  readonly refusals: RefusalMessages
  readonly report: ReportMessages
}) {
  return (
    <li className="border-border flex flex-col gap-2 border-b py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <Tag variant={question.answer === null ? 'neutral' : 'primary'}>
          {question.answer === null ? copy.pendingBadge : copy.answeredBadge}
        </Tag>
        {question.isPublic ? null : <Tag>{copy.privateBadge}</Tag>}
        {question.mine ? <Tag>{copy.mineBadge}</Tag> : null}
        <span className="text-fg-subtle text-xs">{question.authorName}</span>
        <span className="text-fg-subtle text-xs">
          {formatDate(question.createdAt, { locale: LOCALE, style: 'date', timeZone: TIME_ZONE })}
        </span>
      </div>

      <p className="text-fg text-sm whitespace-pre-line">{question.content}</p>

      {question.answer === null ? null : (
        <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3">
          <p className="text-fg text-xs font-semibold">
            {copy.answerLabel.replace('{brand}', question.answer.brandName)}
          </p>
          <p className="text-fg-muted text-sm whitespace-pre-line">{question.answer.content}</p>
          <div>
            <ReportDialog
              copy={report}
              refusals={refusals}
              targetId={question.id}
              targetType="ANSWER"
            />
          </div>
        </div>
      )}

      {question.mine ? null : (
        <div>
          <ReportDialog
            copy={report}
            refusals={refusals}
            targetId={question.id}
            targetType="QUESTION"
          />
        </div>
      )}
    </li>
  )
}
