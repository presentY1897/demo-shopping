/**
 * `/questions` — 답해야 할 문의를 찾는 화면 (TASK-0088 F5 · 4.2).
 *
 * 재는 것 넷이 TASK 의 4장 그대로다.
 *
 * **화면이 정렬하지 않는다.** 픽스처의 첫 줄은 **이미 답한** 문의다 — 서버가 보내는
 * 순서(미답변 우선)와 반대로 심어 둔 것이고, 화면이 스스로 정렬하면 이 검사가
 * 빨개진다. 커서 목록에서 클라이언트 정렬은 페이지 경계에서 반드시 거짓말을 한다.
 *
 * **뱃지는 목록에서 파생되지 않는다.** 픽스처의 미답변 건수는 4이고 이 페이지의
 * 미답변 줄은 하나다. 두 수가 다른 것이 계약의 뜻이고(필터와 무관한 전체 건수),
 * 「보이는 줄로 세기」로 되돌아가는 회귀는 이 차이로만 드러난다.
 *
 * **목록 질의에는 언제나 `sellerId` 가 실린다.** 빠지면 요청이 거절되고, 그 거절이
 * 판매자를 남의 스토어 문의에서 떼어 놓는 장치다.
 *
 * **비공개 문의가 줄로 도착하고, 그렇게 표시된다** (4.2). 판매자에게 가리지 않는
 * 것이 계약의 판단이므로 화면이 할 일은 감추는 것이 아니라 **답이 공개되지 않는다는
 * 것을 말하는 것**이다.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QuestionsPage from '@/app/questions/page'
import { count } from '@/lib/orders/format'
import { messagesFor, screenTitle } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import {
  answerFailure,
  answerJson,
  answerJsonBy,
  lastRequestTo,
  resetApiStub,
  stubApiClient,
} from './support/api-stub'
import {
  ANSWERED_PRODUCT_NAME,
  EXISTING_ANSWER_CONTENT,
  ANSWER_BRAND_NAME,
  MOCK_SELLER_ID,
  questionsAllAnswered,
  questionsEmpty,
  questionsPage1,
  questionsPage2,
  UNANSWERED_CONTENT,
  UNANSWERED_PRODUCT_NAME,
} from './support/question-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const copy = messagesFor().questionList

const LIST_PATH = '/seller-questions'

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openList(): Promise<HTMLElement> {
  renderWithAuth(<QuestionsPage />)

  return screen.findByRole('list', { name: copy.card.listLabel })
}

function cards(list: HTMLElement): readonly HTMLElement[] {
  return within(list).getAllByRole('listitem')
}

describe('the product question console', () => {
  it('takes its heading from the sidebar entry it was reached by', async () => {
    answerJson(LIST_PATH, questionsPage1)
    await openList()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(screenTitle('/questions'))
  })

  it('always names the seller in the query', async () => {
    answerJson(LIST_PATH, questionsPage1)
    await openList()

    const url = new URL(lastRequestTo(LIST_PATH) ?? '')

    expect(url.searchParams.get('sellerId')).toBe(MOCK_SELLER_ID)
  })

  it('shows the product, the body and the author of each question', async () => {
    answerJson(LIST_PATH, questionsPage1)
    const list = await openList()

    expect(cards(list)).toHaveLength(2)
    expect(within(list).getByText(UNANSWERED_CONTENT)).toBeVisible()
    expect(
      within(list).getByText(copy.card.productLabel.replace('{name}', UNANSWERED_PRODUCT_NAME)),
    ).toBeVisible()
    expect(within(list).getByText(copy.card.authorLabel.replace('{name}', '홍*동'))).toBeVisible()
  })

  it('renders the answer under the question it answers', async () => {
    answerJson(LIST_PATH, questionsPage1)
    const list = await openList()

    expect(within(list).getByText(EXISTING_ANSWER_CONTENT)).toBeVisible()
    expect(within(list).getByText(ANSWER_BRAND_NAME)).toBeVisible()
  })

  it('keeps the order the server sent, unanswered first or not (F5)', async () => {
    answerJson(LIST_PATH, questionsPage1)
    const list = await openList()
    const [first, second] = cards(list)

    // 픽스처는 답한 것을 먼저 싣고 있다. 화면이 스스로 정렬하면 이 둘이 뒤집힌다.
    expect(first).toHaveTextContent(ANSWERED_PRODUCT_NAME)
    expect(second).toHaveTextContent(UNANSWERED_PRODUCT_NAME)
  })

  describe('비공개 문의 (4.2)', () => {
    it('shows it rather than hiding it — the seller is who has to answer', async () => {
      answerJson(LIST_PATH, questionsPage1)
      const list = await openList()

      // 답할 사람이 읽지 못하면 비공개 문의라는 것이 성립하지 않는다.
      expect(within(list).getByText(UNANSWERED_CONTENT)).toBeVisible()
      expect(within(list).getByText(copy.card.privateBadge)).toBeVisible()
    })

    it('says the answer will not be public either', async () => {
      answerJson(LIST_PATH, questionsPage1)
      const list = await openList()

      // 적지 않으면 판매자가 공개 글을 쓰듯 답한다.
      expect(within(list).getByText(copy.card.privateNote)).toBeVisible()
    })

    it('marks only the private one', async () => {
      answerJson(LIST_PATH, questionsPage1)
      const list = await openList()
      const answered = cards(list)[0]

      if (answered === undefined) throw new Error('the answered question is not on the page')

      // 픽스처의 답한 문의는 공개다. 배지를 둘 다 달면 표시가 아무 말도 하지 않는다.
      expect(within(answered).queryByText(copy.card.privateBadge)).toBeNull()
    })
  })

  describe('미답변 건수 뱃지', () => {
    it('reports what the server counted, not what this page shows', async () => {
      answerJson(LIST_PATH, questionsPage1)
      await openList()

      const badge = screen.getByRole('region', { name: copy.unanswered.regionLabel })

      expect(
        within(badge).getByText(copy.unanswered.value.replace('{count}', count(4))),
      ).toBeVisible()
      // 이 페이지의 미답변 줄은 하나다. 뱃지가 목록에서 파생되면 여기서 1이 나온다.
      expect(
        within(badge).queryByText(copy.unanswered.value.replace('{count}', count(1))),
      ).toBeNull()
    })

    it('says out loud that the filter does not touch it', async () => {
      answerJson(LIST_PATH, questionsPage1)
      await openList()

      const badge = screen.getByRole('region', { name: copy.unanswered.regionLabel })

      expect(within(badge).getByText(copy.unanswered.note)).toBeVisible()
    })

    it('does not shrink when the filter is switched on', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, questionsPage1)
      await openList()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unansweredOnlyLabel }))

      await waitFor(() => {
        expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.get('unansweredOnly')).toBe(
          'true',
        )
      })

      const badge = screen.getByRole('region', { name: copy.unanswered.regionLabel })

      expect(
        within(badge).getByText(copy.unanswered.value.replace('{count}', count(4))),
      ).toBeVisible()
    })

    it('says "nothing to answer" rather than printing a zero', async () => {
      answerJson(LIST_PATH, questionsAllAnswered)
      await openList()

      const badge = screen.getByRole('region', { name: copy.unanswered.regionLabel })

      expect(within(badge).getByText(copy.unanswered.none)).toBeVisible()
    })
  })

  describe('the filter', () => {
    it('sends unansweredOnly and starts again from the first page', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, questionsPage1)
      await openList()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unansweredOnlyLabel }))

      await waitFor(() => {
        const url = new URL(lastRequestTo(LIST_PATH) ?? '')

        expect(url.searchParams.get('unansweredOnly')).toBe('true')
        // 커서는 그 필터 안에서만 위치를 뜻한다. 넘겨받은 것을 그대로 쓰면 이제
        // 존재하지 않는 목록을 이어 달라고 하는 셈이다.
        expect(url.searchParams.has('cursor')).toBe(false)
      })
    })

    it('says "none like this" rather than "none at all" when it is on', async () => {
      const user = userEvent.setup()
      answerJsonBy(LIST_PATH, (url) =>
        url.searchParams.has('unansweredOnly') ? questionsEmpty : questionsPage1,
      )
      await openList()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unansweredOnlyLabel }))

      expect(await screen.findByText(copy.filteredEmpty.title)).toBeVisible()
    })

    it('clears the axis', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, questionsPage1)
      await openList()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unansweredOnlyLabel }))
      await waitFor(() => {
        expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.has('unansweredOnly')).toBe(
          true,
        )
      })

      await user.click(screen.getByRole('button', { name: copy.filters.reset }))

      await waitFor(() => {
        expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.has('unansweredOnly')).toBe(
          false,
        )
      })
    })
  })

  describe('paging', () => {
    it('hands the cursor back unchanged', async () => {
      const user = userEvent.setup()
      answerJsonBy(LIST_PATH, (url) =>
        url.searchParams.get('cursor') === 'cursor-page-2' ? questionsPage2 : questionsPage1,
      )
      const list = await openList()
      expect(cards(list)).toHaveLength(2)

      await user.click(screen.getByRole('button', { name: copy.pagination.next }))

      await waitFor(() => {
        expect(cards(screen.getByRole('list', { name: copy.card.listLabel }))).toHaveLength(1)
      })
      expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.get('cursor')).toBe(
        'cursor-page-2',
      )
    })
  })

  describe('an empty console', () => {
    it('explains when the first question will arrive', async () => {
      answerJson(LIST_PATH, questionsEmpty)
      renderWithAuth(<QuestionsPage />)

      expect(await screen.findByText(copy.empty.title)).toBeVisible()
    })
  })

  describe('when the API refuses', () => {
    it('offers a retry', async () => {
      answerFailure(LIST_PATH, 500, 'INTERNAL_ERROR', '알 수 없는 오류입니다.')
      renderWithAuth(<QuestionsPage />)

      expect(await screen.findByText(copy.errorTitle)).toBeVisible()
      expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
    })
  })

  describe('an account with no store', () => {
    it('is pointed at the application form and asks the API for nothing', async () => {
      renderWithAuth(<QuestionsPage />, { session: null })

      expect(await screen.findByText(copy.noStore.title)).toBeVisible()
      // `sellerId` 없이 부르면 거절되고, 아직 신청하지 않았을 뿐인 사람이 「불러오지
      // 못했습니다」를 보게 된다.
      expect(lastRequestTo(LIST_PATH)).toBeNull()
    })
  })
})
