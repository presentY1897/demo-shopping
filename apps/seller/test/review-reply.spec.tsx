/**
 * 답변을 쓰고 · 고치고 · 지운다 (TASK-0085 F1 · F2 · F3).
 *
 * **한 문이다.** 처음 쓰는 것과 고치는 것이 같은 `PUT` 으로 나가는지를 두 검사가
 * 각각 잰다 — 리뷰당 답변이 하나이고 그것을 기본키가 만들므로, 화면에 문을 둘 두면
 * 하나는 언젠가 400 을 받는다. 그 회귀는 화면에서 보이지 않는다: 두 버튼 다 저장된
 * 것처럼 보이고, 두 번째만 조용히 실패한다.
 *
 * **지우기는 묻고 나서 지운다.** 답변에는 이력이 없고(4장), 지운 답변을 되살리는
 * 길은 다시 쓰는 것뿐이다.
 *
 * **거절 셋이 각각 다른 문장이다.** 403 은 「내 스토어가 아니다」, 404 는 「그 사이에
 * 사라졌다」, 나머지는 코드 카탈로그의 것. 셋을 한 문장으로 접으면 판매자가 다음에
 * 할 일 — 아무것도 / 새로고침 / 다시 시도 — 이 구분되지 않는다.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ReviewsPage from '@/app/reviews/page'
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
  ANSWERED_REVIEW_ID,
  EXISTING_REPLY_CONTENT,
  NEW_REPLY_CONTENT,
  reviewsAfterReply,
  reviewsPage1,
  UNANSWERED_PRODUCT_NAME,
  UNANSWERED_REVIEW_ID,
  writtenReply,
} from './support/review-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const messages = messagesFor()

const copy = messages.reviewList

const reply = copy.reply

const LIST_PATH = '/seller-product-reviews'

const UNANSWERED_REPLY_PATH = `/reviews/${UNANSWERED_REVIEW_ID}/reply`

const ANSWERED_REPLY_PATH = `/reviews/${ANSWERED_REVIEW_ID}/reply`

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
  renderWithAuth(<ReviewsPage />)

  const list = await screen.findByRole('list', { name: copy.card.listLabel })
  const card = within(list)
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(UNANSWERED_PRODUCT_NAME) === true)

  if (card === undefined) throw new Error('the unanswered review is not on the page')

  return card
}

describe('답변 쓰기 (F1)', () => {
  it('sends what was typed, to the review it was typed under', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)
    answerJson(UNANSWERED_REPLY_PATH, writtenReply)

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: reply.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: reply.contentLabel }), NEW_REPLY_CONTENT)
    await user.click(screen.getByRole('button', { name: reply.saveLabel }))

    await waitFor(() => {
      const call = lastCallTo(UNANSWERED_REPLY_PATH)

      expect(call?.method).toBe('PUT')
      expect(call?.body).toEqual({ content: NEW_REPLY_CONTENT })
    })
  })

  it('shows the saved reply on the row, and says so', async () => {
    const user = userEvent.setup()
    let written = false

    // 쓰기가 끝나면 목록을 **다시 읽는다**. 답한 한 건이 미답변 건수에서 빠지는 것을
    // 화면이 손으로 계산하면, 다른 탭에서 답한 건은 영영 반영되지 않는다.
    answerJsonBy(LIST_PATH, () => (written ? reviewsAfterReply : reviewsPage1))
    answerJsonBy(UNANSWERED_REPLY_PATH, () => {
      written = true

      return writtenReply
    })

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: reply.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: reply.contentLabel }), NEW_REPLY_CONTENT)
    await user.click(screen.getByRole('button', { name: reply.saveLabel }))

    expect(await screen.findByText(NEW_REPLY_CONTENT)).toBeVisible()
    expect(screen.getByText(reply.savedNotice)).toBeVisible()
    // 폼은 닫힌다. 저장한 글이 두 곳에 — 줄에도, 편집기에도 — 남아 있으면 어느 쪽이
    // 지금 서버에 있는 것인지 알 수 없다.
    expect(screen.queryByRole('textbox', { name: reply.contentLabel })).toBeNull()
  })

  it('refuses an empty answer without asking the API', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: reply.writeLabel }))
    await user.click(screen.getByRole('button', { name: reply.saveLabel }))

    expect(await screen.findByText(reply.errors.required)).toBeVisible()
    expect(lastCallTo(UNANSWERED_REPLY_PATH)).toBeNull()
  })
})

describe('답변 고치기 (F3)', () => {
  it('starts from what is already there rather than from a blank box', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)

    renderWithAuth(<ReviewsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: reply.editLabel }))

    // 빈 칸에서 다시 쓰게 하면 「수정」이 사실상 「삭제 후 재작성」이 되고, 그것은
    // 4장이 명시적으로 거절한 모양이다.
    expect(screen.getByRole('textbox', { name: reply.contentLabel })).toHaveValue(
      EXISTING_REPLY_CONTENT,
    )
  })

  it('overwrites through the same door the first answer went through', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)
    answerJson(ANSWERED_REPLY_PATH, writtenReply)

    renderWithAuth(<ReviewsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: reply.editLabel }))

    const box = screen.getByRole('textbox', { name: reply.contentLabel })
    await user.clear(box)
    await user.type(box, '다시 확인해 보겠습니다.')
    await user.click(screen.getByRole('button', { name: reply.saveLabel }))

    await waitFor(() => {
      const call = lastCallTo(ANSWERED_REPLY_PATH)

      // 「두 번째 답변」이라는 것이 없다. 같은 `PUT` 이고, 저장될 자리도 하나다.
      expect(call?.method).toBe('PUT')
      expect(call?.body).toEqual({ content: '다시 확인해 보겠습니다.' })
    })
  })
})

describe('답변 지우기', () => {
  it('asks first, and sends nothing when the answer is no', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)

    renderWithAuth(<ReviewsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: reply.deleteLabel }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(reply.confirm.title)).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: reply.confirm.cancel }))

    expect(lastCallTo(ANSWERED_REPLY_PATH)).toBeNull()
  })

  it('removes the reply and leaves the review standing', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)
    // 204, 몸통 없음. `z.undefined()` 가 그 모양을 그대로 받는다.
    answerNoContent(ANSWERED_REPLY_PATH)

    renderWithAuth(<ReviewsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: reply.deleteLabel }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: reply.confirm.confirm }))

    await waitFor(() => {
      expect(lastCallTo(ANSWERED_REPLY_PATH)?.method).toBe('DELETE')
    })
    expect(await screen.findByText(reply.deletedNotice)).toBeVisible()
  })
})

describe('거절 (F2)', () => {
  it('says whose store it is when the review belongs to somebody else', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)
    answerFailure(
      UNANSWERED_REPLY_PATH,
      403,
      'FORBIDDEN',
      'review.reply 퍼미션으로 접근할 수 없는 리소스입니다.',
    )

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: reply.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: reply.contentLabel }), NEW_REPLY_CONTENT)
    await user.click(screen.getByRole('button', { name: reply.saveLabel }))

    // 서버의 「review.reply 퍼미션으로…」가 그대로 나가면 안 된다. 그것은 콘솔이
    // 버튼을 왜 껐는지 설명할 때 쓰는 말이지 판매자에게 할 말이 아니다.
    expect(await screen.findByText(reply.refusals.forbidden)).toBeVisible()
  })

  it('tells the seller to refresh when the review vanished under them', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)
    answerFailure(ANSWERED_REPLY_PATH, 404, 'NOT_FOUND', '답변을 찾을 수 없어요.')

    renderWithAuth(<ReviewsPage />)
    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(within(list).getByRole('button', { name: reply.deleteLabel }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: reply.confirm.confirm }))

    expect(await screen.findByRole('alert')).toHaveTextContent(reply.refusals.gone)
  })

  it('leaves every other refusal to the code catalog', async () => {
    const user = userEvent.setup()
    answerJson(LIST_PATH, reviewsPage1)
    answerFailure(UNANSWERED_REPLY_PATH, 500, 'INTERNAL_ERROR', '알 수 없는 오류입니다.')

    const card = await openUnansweredCard()
    await user.click(within(card).getByRole('button', { name: reply.writeLabel }))
    await user.type(screen.getByRole('textbox', { name: reply.contentLabel }), NEW_REPLY_CONTENT)
    await user.click(screen.getByRole('button', { name: reply.saveLabel }))

    expect(await screen.findByText(messages.errors.INTERNAL_ERROR)).toBeVisible()
  })
})
