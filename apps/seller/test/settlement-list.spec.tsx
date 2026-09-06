/**
 * `/settlements` — 정산 예정 금액과 회차 목록 (TASK-0082 F1 · F4).
 *
 * 이 파일이 재는 것 둘이 TASK 의 4장 그대로다.
 *
 * **예정액은 두 숫자다.** 합계가 화면 어디에도 없다는 것을 실제로 단언한다 — 「합치지
 * 않는다」는 규칙은 합쳐 놓아도 아무 검사가 빨개지지 않기 때문에 규칙으로만 남기
 * 쉽다.
 *
 * **목록 질의에는 언제나 `sellerId` 가 실린다.** 빠지면 서버는 그것을 플랫폼 전체
 * 목록 요청으로 읽고 403 으로 답한다(F1). 그 거절이 판매자를 남의 정산서에서 떼어
 * 놓는 장치이므로, 화면이 id 를 빠뜨리는 회귀는 「권한이 없어요」로만 드러난다.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettlementsPage from '@/app/settlements/page'
import { count, money } from '@/lib/orders/format'
import { messagesFor, screenTitle } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import {
  answerFailure,
  answerJson,
  answerJsonBy,
  answerNetworkFailure,
  lastRequestTo,
  resetApiStub,
  stubApiClient,
} from './support/api-stub'
import {
  MOCK_SELLER_ID,
  settlementListEmpty,
  settlementListPage1,
  settlementListPage2,
  settlementOutlook,
} from './support/settlement-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const copy = messagesFor().settlementList

const vocabulary = messagesFor().settlements

const LIST_PATH = '/settlements'

const OUTLOOK_PATH = '/seller-settlement-outlook'

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  answerJson(OUTLOOK_PATH, settlementOutlook)
  // 콘솔은 데스크톱 퍼스트다. 표가 기본이고, 카드는 아래 모바일 절이 따로 잰다.
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openList(): Promise<HTMLElement> {
  renderWithAuth(<SettlementsPage />)

  return screen.findByRole('table', { name: copy.table.caption })
}

function rows(table: HTMLElement): readonly HTMLElement[] {
  const [, ...body] = within(table).getAllByRole('row')

  return body
}

describe('the settlement list', () => {
  it('takes its heading from the sidebar entry it was reached by', async () => {
    answerJson(LIST_PATH, settlementListPage1)
    await openList()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(screenTitle('/settlements'))
  })

  it('always names the seller in the query (F1)', async () => {
    answerJson(LIST_PATH, settlementListPage1)
    await openList()

    const url = new URL(lastRequestTo(LIST_PATH) ?? '')

    expect(url.searchParams.get('sellerId')).toBe(MOCK_SELLER_ID)
  })

  it('shows the period, the status and the payout of each round', async () => {
    answerJson(LIST_PATH, settlementListPage1)
    const table = await openList()

    expect(rows(table)).toHaveLength(2)
    expect(within(table).getByText(vocabulary.statusLabels.HOLD)).toBeVisible()
    expect(within(table).getByText(money(1_551_000))).toBeVisible()
  })

  it('shows a hold reason on the round it belongs to', async () => {
    answerJson(LIST_PATH, settlementListPage1)
    const table = await openList()

    expect(
      within(table).getByText(copy.table.holdReason.replace('{reason}', '반품 분쟁 확인 중')),
    ).toBeVisible()
  })

  it('reports the total the filter selected, not the page', async () => {
    answerJson(LIST_PATH, settlementListPage1)
    await openList()

    const totals = screen.getByRole('region', { name: copy.totals.regionLabel })

    expect(
      within(totals).getByText(copy.totals.payout.replace('{amount}', money(2_100_000))),
    ).toBeVisible()
    // 세 장 중 두 장만 이 페이지에 있다. 합계는 여전히 셋을 말한다.
    expect(within(totals).getByText(copy.totals.count.replace('{count}', count(3)))).toBeVisible()
  })

  describe('정산 예정 금액 (F4)', () => {
    it('renders the two stages separately, each with its own label', async () => {
      answerJson(LIST_PATH, settlementListPage1)
      await openList()

      const panel = screen.getByRole('region', { name: copy.outlook.regionLabel })

      expect(within(panel).getByText(copy.outlook.awaitingConfirmationLabel)).toBeVisible()
      expect(within(panel).getByText(money(430_000))).toBeVisible()
      expect(within(panel).getByText(copy.outlook.awaitingSettlementLabel)).toBeVisible()
      expect(within(panel).getByText(money(180_000))).toBeVisible()
    })

    it('never prints the sum of the two', async () => {
      answerJson(LIST_PATH, settlementListPage1)
      await openList()

      const panel = screen.getByRole('region', { name: copy.outlook.regionLabel })

      // 610,000원. 합쳐 두면 「받기로 확정된 돈」으로 읽히고, 반품이 하나 들어온 날
      // 판매자는 자기가 본 숫자가 왜 줄었는지를 묻는다.
      expect(within(panel).queryByText(money(610_000))).toBeNull()
      expect(within(panel).getByText(copy.outlook.note)).toBeVisible()
    })

    it('says which stage can still change', async () => {
      answerJson(LIST_PATH, settlementListPage1)
      await openList()

      const panel = screen.getByRole('region', { name: copy.outlook.regionLabel })

      expect(within(panel).getByText(copy.outlook.awaitingConfirmationHint)).toBeVisible()
      expect(within(panel).getByText(copy.outlook.awaitingSettlementHint)).toBeVisible()
    })

    it('keeps the list readable when only the outlook failed', async () => {
      answerJson(LIST_PATH, settlementListPage1)
      answerNetworkFailure(OUTLOOK_PATH)
      const table = await openList()

      expect(await screen.findByRole('alert')).toHaveTextContent(copy.outlook.errorTitle)
      expect(rows(table)).toHaveLength(2)
    })
  })

  describe('the status filter', () => {
    it('sends the chosen status and starts again from the first page', async () => {
      const user = userEvent.setup()
      answerJson(LIST_PATH, settlementListPage1)
      await openList()

      await user.click(screen.getByRole('combobox', { name: copy.filters.statusLabel }))
      await user.click(await screen.findByRole('option', { name: vocabulary.statusLabels.HOLD }))

      await waitFor(() => {
        const url = new URL(lastRequestTo(LIST_PATH) ?? '')

        expect(url.searchParams.get('status')).toBe('HOLD')
        // 커서는 그 필터 안에서만 위치를 뜻한다. 넘겨받은 것을 그대로 쓰면 이제
        // 존재하지 않는 목록을 이어 달라고 하는 셈이다.
        expect(url.searchParams.has('cursor')).toBe(false)
      })
    })

    it('says "none like this" rather than "none at all" when a filter is on', async () => {
      const user = userEvent.setup()
      answerJsonBy(LIST_PATH, (url) =>
        url.searchParams.has('status') ? settlementListEmpty : settlementListPage1,
      )
      await openList()

      await user.click(screen.getByRole('combobox', { name: copy.filters.statusLabel }))
      await user.click(
        await screen.findByRole('option', { name: vocabulary.statusLabels.APPROVED }),
      )

      expect(await screen.findByText(copy.filteredEmpty.title)).toBeVisible()
    })
  })

  describe('paging', () => {
    it('hands the cursor back unchanged', async () => {
      const user = userEvent.setup()
      answerJsonBy(LIST_PATH, (url) =>
        url.searchParams.get('cursor') === 'cursor-page-2'
          ? settlementListPage2
          : settlementListPage1,
      )
      const table = await openList()
      expect(rows(table)).toHaveLength(2)

      await user.click(screen.getByRole('button', { name: copy.pagination.next }))

      await waitFor(() => {
        expect(rows(screen.getByRole('table', { name: copy.table.caption }))).toHaveLength(1)
      })
      expect(new URL(lastRequestTo(LIST_PATH) ?? '').searchParams.get('cursor')).toBe(
        'cursor-page-2',
      )
    })
  })

  describe('an empty console', () => {
    it('explains when the first round will arrive', async () => {
      answerJson(LIST_PATH, settlementListEmpty)
      renderWithAuth(<SettlementsPage />)

      expect(await screen.findByText(copy.empty.title)).toBeVisible()
    })
  })

  describe('when the API refuses', () => {
    it('offers a retry', async () => {
      answerFailure(LIST_PATH, 500, 'INTERNAL', '알 수 없는 오류입니다.')
      renderWithAuth(<SettlementsPage />)

      expect(await screen.findByText(copy.errorTitle)).toBeVisible()
      expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
    })
  })

  describe('an account with no store', () => {
    it('is pointed at the application form and asks the API for nothing', async () => {
      renderWithAuth(<SettlementsPage />, { session: null })

      expect(await screen.findByText(copy.noStore.title)).toBeVisible()
      // `sellerId` 없이 부르면 403 이고, 아직 신청하지 않았을 뿐인 사람이 「권한이
      // 없어요」를 보게 된다.
      expect(lastRequestTo(LIST_PATH)).toBeNull()
      expect(lastRequestTo(OUTLOOK_PATH)).toBeNull()
    })
  })

  describe('on a phone', () => {
    it('renders cards instead of the table, from the same column definitions', async () => {
      stubViewport(VIEWPORTS.mobile)
      answerJson(LIST_PATH, settlementListPage1)
      renderWithAuth(<SettlementsPage />)

      expect(await screen.findByText(vocabulary.statusLabels.HOLD)).toBeVisible()
      expect(screen.queryByRole('table', { name: copy.table.caption })).toBeNull()
    })
  })
})
