/**
 * 문의 관리 화면의 순수 판단 (TASK-0088 F3 · F5).
 *
 * `vitest.config.mjs` 가 `lib/questions/question-console.ts` 를 **분기 100%** 로 잡고
 * 있고, 이 파일이 그 문턱을 채우는 유일한 곳이다. 이유는 저 모듈의 머리말이 적고
 * 있다: 여기 있는 판단들은 틀려도 조용하다 — 질의에서 `sellerId` 가 빠지면 목록이
 * 비는 것이 아니라 거절되고, 「미답변만」이 실리지 않으면 답한 문의가 섞인 목록이
 * 그려질 뿐이다.
 */

import type { ApiFailure, SellerQuestion } from '@shopping/shared'
import { ANSWER_CONTENT_MAX } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  answerRefusalOf,
  EMPTY_QUESTION_FILTERS,
  isNarrowed,
  isUnanswered,
  questionAnswerFormSchema,
  questionSearch,
  sellerQuestionQuery,
} from '@/lib/questions/question-console'

const SELLER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0001'

function paramsOf(search: string): URLSearchParams {
  return new URL(`http://api.test.invalid/x${search}`).searchParams
}

function httpFailure(status: number, code: string): ApiFailure {
  return { code, details: [], kind: 'http', message: 'nope', requestId: null, status }
}

const question = {
  answer: null,
  authorName: '홍*동',
  content: '세탁은 어떻게 하나요?',
  createdAt: '2026-09-04T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f8001',
  isPublic: false,
  mine: false,
  productId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f7001',
  productName: '리네아 오버사이즈 코트',
  updatedAt: '2026-09-04T02:00:00.000Z',
} satisfies SellerQuestion

describe('미답변 판정', () => {
  it('is about the answer, not about whether the question is public (F5)', () => {
    // 비공개 문의도 답해야 하는 문의다. 두 축을 섞으면 비공개 문의가 「할 일」에서
    // 조용히 빠진다 (4.2).
    expect(isUnanswered(question)).toBe(true)
    expect(
      isUnanswered({
        ...question,
        answer: {
          brandName: '루미에르',
          content: '드라이클리닝을 권해드립니다.',
          createdAt: '2026-09-05T02:00:00.000Z',
          questionId: question.id,
          updatedAt: '2026-09-05T02:00:00.000Z',
        },
      }),
    ).toBe(false)
  })
})

describe('필터', () => {
  it('starts wide open', () => {
    expect(isNarrowed(EMPTY_QUESTION_FILTERS)).toBe(false)
  })

  it('counts the one axis it has as narrowed', () => {
    // 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가르는 판단이다.
    expect(isNarrowed({ unansweredOnly: true })).toBe(true)
  })
})

describe('질의 조립', () => {
  it('leaves an unset axis out of the query entirely', () => {
    // `undefined` 를 실어 보내면 `unansweredOnly=undefined` 가 되고, `z.stringbool()`
    // 이 그것을 읽지 못해 400 으로 답한다.
    expect(sellerQuestionQuery(EMPTY_QUESTION_FILTERS, null)).toEqual({})
  })

  it('carries the axis and the cursor when they are set', () => {
    expect(sellerQuestionQuery({ unansweredOnly: true }, 'cursor-page-2')).toEqual({
      cursor: 'cursor-page-2',
      unansweredOnly: true,
    })
  })
})

describe('질의 문자열', () => {
  it('always names the seller', () => {
    // 없으면 요청이 거절되고, 화면은 「문의가 없어요」가 아니라 「불러오지
    // 못했습니다」로 끝난다 — 두 문장은 판매자에게 전혀 다른 뜻이다.
    expect(paramsOf(questionSearch(SELLER_ID, EMPTY_QUESTION_FILTERS, null)).get('sellerId')).toBe(
      SELLER_ID,
    )
  })

  it('sends nothing but the seller on the first unfiltered page', () => {
    expect([...paramsOf(questionSearch(SELLER_ID, EMPTY_QUESTION_FILTERS, null)).keys()]).toEqual([
      'sellerId',
    ])
  })

  it('serialises the filter and hands the cursor back unchanged', () => {
    const params = paramsOf(questionSearch(SELLER_ID, { unansweredOnly: true }, 'cursor-page-2'))

    expect(params.get('unansweredOnly')).toBe('true')
    // 커서는 불투명하다. 해석하지 않고 서버가 준 것을 그대로 되돌려준다.
    expect(params.get('cursor')).toBe('cursor-page-2')
  })
})

describe('답변 폼 스키마', () => {
  const messages = { required: '답변 내용을 입력해주세요.', tooLong: '답변은 {max}자까지예요.' }
  const schema = questionAnswerFormSchema(messages)

  it('refuses an answer that is only whitespace', () => {
    const parsed = schema.safeParse({ content: '   ' })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(messages.required)
  })

  it('takes the ceiling from the contract rather than from the sentence', () => {
    const parsed = schema.safeParse({ content: 'ㄱ'.repeat(ANSWER_CONTENT_MAX + 1) })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(`답변은 ${String(ANSWER_CONTENT_MAX)}자까지예요.`)
  })

  it('trims what it accepts', () => {
    expect(schema.parse({ content: '  답변합니다.  ' })).toEqual({ content: '답변합니다.' })
  })
})

describe('거절 가르기 (F3)', () => {
  it('tells "not my store" from "already gone"', () => {
    // 셋을 한 문장으로 접으면 판매자가 다음에 할 일 — 아무것도 / 새로고침 / 다시
    // 시도 — 이 구분되지 않는다.
    expect(answerRefusalOf(httpFailure(403, 'FORBIDDEN'))).toBe('forbidden')
    expect(answerRefusalOf(httpFailure(404, 'NOT_FOUND'))).toBe('gone')
  })

  it('leaves every other status to the code catalog', () => {
    expect(answerRefusalOf(httpFailure(500, 'INTERNAL_ERROR'))).toBe('other')
  })

  it('has nothing to divide when nothing arrived', () => {
    expect(answerRefusalOf({ kind: 'transport', reason: 'network' })).toBe('other')
  })
})
