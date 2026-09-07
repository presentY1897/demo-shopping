/**
 * 답변을 쓰고 · 고치고 · 지운다 (TASK-0088 F3 · 4.3).
 *
 * **한 문이다.** 처음 쓰는 것과 고치는 것이 같은 `PUT` 으로 나가는지를 두 검사가
 * 각각 잰다 — 문의당 답변이 하나이고 그것을 기본키가 만들므로, 화면에 문을 둘 두면
 * 하나는 언젠가 400 을 받는다. 그 회귀는 화면에서 보이지 않는다: 두 버튼 다 저장된
 * 것처럼 보이고, 두 번째만 조용히 실패한다.
 *
 * **지우기는 묻고 나서 지운다.** 답변에는 이력이 없고, 지운 답변을 되살리는 길은
 * 다시 쓰는 것뿐이다.
 *
 * **거절 셋이 각각 다른 문장이다.** 403 은 「내 스토어가 아니다」, 404 는 「그 사이에
 * 사라졌다」, 나머지는 코드 카탈로그의 것. 셋을 한 문장으로 접으면 판매자가 다음에
 * 할 일 — 아무것도 / 새로고침 / 다시 시도 — 이 구분되지 않는다.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QuestionsPage from '@/app/questions/page'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import {
  answerFailure,
  answerJson,
  answerJsonBy,
  answerNoContent,
  lastCallTo,
  resetApiStub,
  stubApiClient,
} from './support/api-stub'
import {
  ANSWERED_QUESTION_ID,
  EXISTING_ANSWER_CONTENT,
  NEW_ANSWER_CONTENT,
  questionsAfterAnswer,
  questionsPage1,
  UNANSWERED_PRODUCT_NAME,
  UNANSWERED_QUESTION_ID,
  writtenAnswer,
} from './support/question-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const messages = messagesFor()

const copy = messages.questionList

const answer = copy.answer

const LIST_PATH = '/seller-questions'

const UNANSWERED_ANSWER_PATH = `/questions/${UNANSWERED_QUESTION_ID}/answer`

const ANSWERED_ANSWER_PATH = `/questions/${ANSWERED_QUESTION_ID}/answer`

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 아직 답하지 않은 줄. 픽스처가 두 번째로 싣고 있다 — 서버의 순서 그대로다. */
async function openUnansweredCard(): Promise<HTMLElement> {
  renderWithAuth(<QuestionsPage />)

  const list = await screen.findByRole('list', { name: copy.card.listLabel })
  const card = within(list)
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(UNANSWERED_PRODUCT_NAME) === true)

  if (card === undefined) throw new Error('the unanswered question is not on the page')

  return card
}

describe('답변 쓰기', () => {
  it('sends what was typed, to the question it was typed under', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)
    answerJson(UNANSWERED_ANSWER_PATH, writtenAnswer)

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: answer.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: answer.contentLabel }), NEW_ANSWER_CONTENT)
    await user.click(screen.getByRole('button', { name: answer.saveLabel }))

    await waitFor(() => {
      const call = lastCallTo(UNANSWERED_ANSWER_PATH)

      expect(call?.method).toBe('PUT')
      expect(call?.body).toEqual({ content: NEW_ANSWER_CONTENT })
    })
  })

  it('shows the saved answer on the row, and says so', async () => {
    const user = userEvent.setup()
    let written = false

    // 쓰기가 끝나면 목록을 **다시 읽는다**. 답한 한 건이 미답변 건수에서 빠지는 것을
    // 화면이 손으로 계산하면, 다른 탭에서 답한 건은 영영 반영되지 않는다.
    answerJsonBy(LIST_PATH, () => (written ? questionsAfterAnswer : questionsPage1))
    answerJsonBy(UNANSWERED_ANSWER_PATH, () => {
      written = true

      return writtenAnswer
    })

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: answer.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: answer.contentLabel }), NEW_ANSWER_CONTENT)
    await user.click(screen.getByRole('button', { name: answer.saveLabel }))

    expect(await screen.findByText(NEW_ANSWER_CONTENT)).toBeVisible()
    expect(screen.getByText(answer.savedNotice)).toBeVisible()
    // 폼은 닫힌다. 저장한 글이 두 곳에 — 줄에도, 편집기에도 — 남아 있으면 어느 쪽이
    // 지금 서버에 있는 것인지 알 수 없다.
    expect(screen.queryByRole('textbox', { name: answer.contentLabel })).toBeNull()
  })

  it('refuses an empty answer without asking the API', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: answer.writeLabel }))
    await user.click(screen.getByRole('button', { name: answer.saveLabel }))

    expect(await screen.findByText(answer.errors.required)).toBeVisible()
    expect(lastCallTo(UNANSWERED_ANSWER_PATH)).toBeNull()
  })

  it('opens one editor at a time', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)

    renderWithAuth(<QuestionsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: answer.writeLabel }))
    await user.click(within(list).getByRole('button', { name: answer.editLabel }))

    // 열 개의 텍스트에어리어를 동시에 두면 어느 것이 무엇의 답인지 잃는다.
    expect(screen.getAllByRole('textbox', { name: answer.contentLabel })).toHaveLength(1)
  })
})

describe('답변 고치기 (4.3)', () => {
  it('starts from what is already there rather than from a blank box', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)

    renderWithAuth(<QuestionsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: answer.editLabel }))

    // 빈 칸에서 다시 쓰게 하면 「수정」이 사실상 「삭제 후 재작성」이 된다.
    expect(screen.getByRole('textbox', { name: answer.contentLabel })).toHaveValue(
      EXISTING_ANSWER_CONTENT,
    )
  })

  it('overwrites through the same door the first answer went through', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)
    answerJson(ANSWERED_ANSWER_PATH, writtenAnswer)

    renderWithAuth(<QuestionsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: answer.editLabel }))
    await user.clear(screen.getByRole('textbox', { name: answer.contentLabel }))
    await user.type(screen.getByRole('textbox', { name: answer.contentLabel }), NEW_ANSWER_CONTENT)
    await user.click(screen.getByRole('button', { name: answer.saveLabel }))

    await waitFor(() => {
      // 「작성」과 「수정」이 서버에서 같은 일이다. 문을 둘 두면 하나는 400 을 받는다.
      expect(lastCallTo(ANSWERED_ANSWER_PATH)?.method).toBe('PUT')
    })
  })
})

describe('답변 지우기', () => {
  it('asks first, and sends nothing when the answer is no', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)

    renderWithAuth(<QuestionsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: answer.deleteLabel }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: answer.confirm.cancel }))

    expect(lastCallTo(ANSWERED_ANSWER_PATH)).toBeNull()
  })

  it('removes the answer and leaves the question standing', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)
    answerNoContent(ANSWERED_ANSWER_PATH)

    renderWithAuth(<QuestionsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: answer.deleteLabel }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: answer.confirm.confirm }))

    await waitFor(() => {
      expect(lastCallTo(ANSWERED_ANSWER_PATH)?.method).toBe('DELETE')
    })
    expect(await screen.findByText(answer.deletedNotice)).toBeVisible()
  })
})

describe('거절 (F3)', () => {
  it('says whose store it is when the question belongs to somebody else', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)
    answerFailure(
      UNANSWERED_ANSWER_PATH,
      403,
      'FORBIDDEN',
      'question.answer 퍼미션으로 접근할 수 없는 리소스입니다.',
    )

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: answer.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: answer.contentLabel }), NEW_ANSWER_CONTENT)
    await user.click(screen.getByRole('button', { name: answer.saveLabel }))

    // 서버의 문장이 그대로 나가지 않는다.
    expect(await screen.findByText(answer.refusals.forbidden)).toBeVisible()
  })

  it('tells the seller to refresh when the question vanished under them', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)
    answerFailure(UNANSWERED_ANSWER_PATH, 404, 'NOT_FOUND', '문의를 찾을 수 없습니다.')

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: answer.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: answer.contentLabel }), NEW_ANSWER_CONTENT)
    await user.click(screen.getByRole('button', { name: answer.saveLabel }))

    expect(await screen.findByText(answer.refusals.gone)).toBeVisible()
  })

  it('leaves every other refusal to the code catalog', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, questionsPage1)
    answerFailure(UNANSWERED_ANSWER_PATH, 500, 'INTERNAL_ERROR', '알 수 없는 오류입니다.')

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: answer.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: answer.contentLabel }), NEW_ANSWER_CONTENT)
    await user.click(screen.getByRole('button', { name: answer.saveLabel }))

    // 여기에 문장을 하나 더 두면 이미 답한 것을 두 번째로 답하게 된다.
    expect(await screen.findByText(messages.errors.INTERNAL_ERROR)).toBeVisible()
  })
})
