/**
 * `/reviews` — 답해야 할 리뷰를 찾는 화면 (TASK-0085 F5 · F6 · F7).
 *
 * 이 파일이 재는 것 셋이 TASK 의 4장 그대로다.
 *
 * **화면이 정렬하지 않는다.** 픽스처의 첫 줄은 **이미 답한** 리뷰다 — 서버가 보내는
 * 순서(미답변 우선)와 반대로 심어 둔 것이고, 화면이 스스로 정렬하면 이 검사가
 * 빨개진다. 커서 목록에서 클라이언트 정렬은 페이지 경계에서 반드시 거짓말을 한다.
 *
 * **뱃지는 목록에서 파생되지 않는다.** 픽스처의 미답변 건수는 7이고 이 페이지의
 * 미답변 줄은 하나다. 두 수가 다른 것이 계약의 뜻이고(필터와 무관한 전체 건수),
 * 「보이는 줄로 세기」로 되돌아가는 회귀는 이 차이로만 드러난다.
 *
 * **목록 질의에는 언제나 `sellerId` 가 실린다.** 빠지면 요청이 거절되고, 그 거절이
 * 판매자를 남의 스토어 리뷰에서 떼어 놓는 장치다.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ReviewsPage from '@/app/reviews/page'
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
  EXISTING_REPLY_CONTENT,
  MOCK_SELLER_ID,
  REPLY_BRAND_NAME,
  reviewsAllAnswered,
  reviewsEmpty,
  reviewsPage1,
  reviewsPage2,
  UNANSWERED_CONTENT,
  UNANSWERED_PRODUCT_NAME,
} from './support/review-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const copy = messagesFor().reviewList

const LIST_PATH = '/seller-product-reviews'

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openList(): Promise<HTMLElement> {
  renderWithAuth(<ReviewsPage />)

  return screen.findByRole('list', { name: copy.card.listLabel })
}

function cards(list: HTMLElement): readonly HTMLElement[] {
  return within(list).getAllByRole('listitem')
}

describe('the product review console', () => {
  it('takes its heading from the sidebar entry it was reached by', async () => {
    answerJson(LIST_PATH, reviewsPage1)
    await openList()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(screenTitle('/reviews'))
  })

  it('always names the seller in the query', async () => {
    answerJson(LIST_PATH, reviewsPage1)
    await openList()

    const url = new URL(lastRequestTo(LIST_PATH) ?? '')

    expect(url.searchParams.get('sellerId')).toBe(MOCK_SELLER_ID)
  })

  it('shows the product, the rating, the body and the author of each review', async () => {
    answerJson(LIST_PATH, reviewsPage1)
    const list = await openList()

    expect(cards(list)).toHaveLength(2)
    expect(within(list).getByText(UNANSWERED_CONTENT)).toBeVisible()
    expect(
      within(list).getByText(copy.card.productLabel.replace('{name}', UNANSWERED_PRODUCT_NAME)),
    ).toBeVisible()
    // 별 다섯 개는 보조 기술에게 숫자가 아니다. 이 문장이 숫자다.
    expect(within(list).getByText(copy.card.ratingValue.replace('{rating}', '2'))).toBeVisible()
    expect(within(list).getByText(copy.card.authorLabel.replace('{name}', '홍*동'))).toBeVisible()
  })

  it('says how many photos are attached rather than drawing them', async () => {
    answerJson(LIST_PATH, reviewsPage1)
    const list = await openList()

    // 계약이 주는 것은 저장소의 열쇠이고 공개 주소가 아니다. 주소를 조합하면 저장소
    // 설정이 다른 배포에서 깨진 이미지 아이콘이 뜨고, 그것은 「사진이 없다」로 읽힌다.
    expect(within(list).getByText(copy.card.photoCount.replace('{count}', '2'))).toBeVisible()
    expect(within(list).queryByRole('img')).toBeNull()
  })

  it('renders the reply under the review it answers', async () => {
    answerJson(LIST_PATH, reviewsPage1)
    const list = await openList()

    expect(within(list).getByText(EXISTING_REPLY_CONTENT)).toBeVisible()
    expect(within(list).getByText(REPLY_BRAND_NAME)).toBeVisible()
  })

  it('keeps the order the server sent, unanswered first or not (F5)', async () => {
    answerJson(LIST_PATH, reviewsPage1)
    const list = await openList()
    const [first, second] = cards(list)

    // 픽스처는 답한 것을 먼저 싣고 있다. 화면이 스스로 정렬하면 이 둘이 뒤집힌다.
    expect(first).toHaveTextContent(ANSWERED_PRODUCT_NAME)
    expect(second).toHaveTextContent(UNANSWERED_PRODUCT_NAME)
  })

  describe('미답변 건수 뱃지 (F7)', () => {
    it('reports what the server counted, not what this page shows', async () => {
      answerJson(LIST_PATH, reviewsPage1)
      await openList()

      const badge = screen.getByRole('region', { name: copy.unanswered.regionLabel })

      expect(
        within(badge).getByText(copy.unanswered.value.replace('{count}', count(7))),
      ).toBeVisible()
      // 이 페이지의 미답변 줄은 하나다. 뱃지가 목록에서 파생되면 여기서 1이 나온다.
      expect(
        within(badge).queryByText(copy.unanswered.value.replace('{count}', count(1))),
      ).toBeNull()
    })

    it('says out loud that the filters do not touch it', async () => {
      answerJson(LIST_PATH, reviewsPage1)
      await openList()

      const badge = screen.getByRole('region', { name: copy.unanswered.regionLabel })

      expect(within(badge).getByText(copy.unanswered.note)).toBeVisible()
    })

    it('does not shrink when a filter is switched on', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, reviewsPage1)
      await openList()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unansweredOnlyLabel }))

      await waitFor(() => {
        expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.get('unansweredOnly')).toBe(
          'true',
        )
      })

      const badge = screen.getByRole('region', { name: copy.unanswered.regionLabel })

      expect(
        within(badge).getByText(copy.unanswered.value.replace('{count}', count(7))),
      ).toBeVisible()
    })

    it('says "nothing to answer" rather than printing a zero', async () => {
      answerJson(LIST_PATH, reviewsAllAnswered)
      await openList()

      const badge = screen.getByRole('region', { name: copy.unanswered.regionLabel })

      expect(within(badge).getByText(copy.unanswered.none)).toBeVisible()
    })
  })

  describe('the filters (F6)', () => {
    it('sends unansweredOnly and starts again from the first page', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, reviewsPage1)
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

    it('sends the rating ceiling the seller chose', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, reviewsPage1)
      await openList()

      await user.click(screen.getByRole('combobox', { name: copy.filters.maxRatingLabel }))
      await user.click(
        await screen.findByRole('option', {
          name: copy.filters.maxRatingOption.replace('{rating}', '2'),
        }),
      )

      await waitFor(() => {
        expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.get('maxRating')).toBe('2')
      })
    })

    it('offers no ceiling that means the same as 전체', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, reviewsPage1)
      await openList()

      await user.click(screen.getByRole('combobox', { name: copy.filters.maxRatingLabel }))

      expect(
        screen.queryByRole('option', {
          name: copy.filters.maxRatingOption.replace('{rating}', '5'),
        }),
      ).toBeNull()
    })

    it('says "none like this" rather than "none at all" when a filter is on', async () => {
      const user = userEvent.setup()
      answerJsonBy(LIST_PATH, (url) =>
        url.searchParams.has('unansweredOnly') ? reviewsEmpty : reviewsPage1,
      )
      await openList()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unansweredOnlyLabel }))

      expect(await screen.findByText(copy.filteredEmpty.title)).toBeVisible()
    })

    it('clears both axes at once', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, reviewsPage1)
      await openList()

      await user.click(screen.getByRole('checkbox', { name: copy.filters.unansweredOnlyLabel }))
      await waitFor(() => {
        expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.has('unansweredOnly')).toBe(
          true,
        )
      })

      await user.click(screen.getByRole('button', { name: copy.filters.reset }))

      await waitFor(() => {
        const url = new URL(lastRequestTo(LIST_PATH) ?? '')

        expect(url.searchParams.has('unansweredOnly')).toBe(false)
        expect(url.searchParams.has('maxRating')).toBe(false)
      })
    })
  })

  describe('paging', () => {
    it('hands the cursor back unchanged', async () => {
      const user = userEvent.setup()
      answerJsonBy(LIST_PATH, (url) =>
        url.searchParams.get('cursor') === 'cursor-page-2' ? reviewsPage2 : reviewsPage1,
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
    it('explains when the first review will arrive', async () => {
      answerJson(LIST_PATH, reviewsEmpty)
      renderWithAuth(<ReviewsPage />)

      expect(await screen.findByText(copy.empty.title)).toBeVisible()
    })
  })

  describe('when the API refuses', () => {
    it('offers a retry', async () => {
      answerFailure(LIST_PATH, 500, 'INTERNAL_ERROR', '알 수 없는 오류입니다.')
      renderWithAuth(<ReviewsPage />)

      expect(await screen.findByText(copy.errorTitle)).toBeVisible()
      expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
    })
  })

  describe('an account with no store', () => {
    it('is pointed at the application form and asks the API for nothing', async () => {
      renderWithAuth(<ReviewsPage />, { session: null })

      expect(await screen.findByText(copy.noStore.title)).toBeVisible()
      // `sellerId` 없이 부르면 거절되고, 아직 신청하지 않았을 뿐인 사람이 「불러오지
      // 못했습니다」를 보게 된다.
      expect(lastRequestTo(LIST_PATH)).toBeNull()
    })
  })
})
