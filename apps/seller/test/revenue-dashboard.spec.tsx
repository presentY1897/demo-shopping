/**
 * `/` — 매출 대시보드 (TASK-0082 6장 F5 · F6).
 *
 * 여기서 단언하는 것은 **화면이 무엇을 했나**다: 기간을 옮기면 서버에 정말 다른
 * 질의가 나가는가, 그림 옆의 표에 같은 숫자가 있는가, 지난 기간이 0원일 때 퍼센트를
 * 그리지 **않는가**.
 *
 * API 대역은 `support/api-stub.ts` 다 — 그 파일이 왜 msw 가 아닌지 적고 있다. 응답은
 * 여전히 계약 스키마를 지나므로, 필드 이름이 어긋나면 화면이 `undefined` 를 그리는
 * 대신 여기서 실패한다.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RevenueDashboard } from '@/components/revenue/revenue-dashboard'
import { CHART_HEIGHT, CHART_WIDTH } from '@/lib/revenue/chart'
import { count, money } from '@/lib/orders/format'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import {
  answerFailure,
  answerJson,
  answerNetworkFailure,
  lastRequestTo,
  resetApiStub,
  stubApiClient,
} from './support/api-stub'
import {
  REVENUE_DAYS,
  sellerRevenue,
  sellerRevenueWithoutPrevious,
} from './support/settlement-fixtures'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const copy = messagesFor().revenue

const REVENUE_PATH = '/seller-revenue'

/** 기본 기간이 흔들리지 않도록 고정한다. 자정을 넘기며 도는 검사는 재현되지 않는다. */
const NOW = new Date('2026-09-06T03:00:00.000Z')

beforeEach(() => {
  resetApiStub()
  // 대역을 한 번 세워 둔다. `getApiClient` 를 대체한 것과 같은 인스턴스다.
  stubApiClient()
})

async function openDashboard(): Promise<void> {
  renderWithAuth(<RevenueDashboard now={NOW} />)

  await screen.findByRole('region', { name: copy.totals.regionLabel })
}

describe('the revenue dashboard', () => {
  it('asks for the last 30 days without naming a seller', async () => {
    answerJson(REVENUE_PATH, sellerRevenue)
    await openDashboard()

    const url = new URL(lastRequestTo(REVENUE_PATH) ?? '')

    expect(url.searchParams.get('from')).toBe('2026-08-08')
    expect(url.searchParams.get('to')).toBe('2026-09-06')
    // **자기 id 를 실어 보내지 않는다.** 서버가 부르는 사람의 스토어에서 정한다 —
    // 넣을 자리가 있으면 언젠가 다른 id 가 실린다.
    expect(url.searchParams.has('sellerId')).toBe(false)
  })

  it('shows takings, order count and average order value', async () => {
    answerJson(REVENUE_PATH, sellerRevenue)
    await openDashboard()

    const totals = screen.getByRole('region', { name: copy.totals.regionLabel })

    expect(within(totals).getByText(money(sellerRevenue.totals.salesAmount))).toBeVisible()
    expect(
      within(totals).getByText(
        copy.totals.orderCountValue.replace('{count}', count(sellerRevenue.totals.orderCount)),
      ),
    ).toBeVisible()
    expect(within(totals).getByText(money(sellerRevenue.totals.averageOrderAmount))).toBeVisible()
  })

  it('lists the best sellers of the period', async () => {
    answerJson(REVENUE_PATH, sellerRevenue)
    await openDashboard()

    const table = screen.getByRole('table', { name: copy.topProducts.caption })

    expect(within(table).getByText('리네아 오버사이즈 코트')).toBeVisible()
    expect(within(table).getByText(money(1_440_000))).toBeVisible()
  })

  describe('the chart', () => {
    it('is decoration, and the table beside it is the content (F5)', async () => {
      answerJson(REVENUE_PATH, sellerRevenue)
      await openDashboard()

      const chart = document.querySelector('svg')

      expect(chart).not.toBeNull()
      // `aria-label` 로 때우지 않는다 — 그것은 서른 날치 숫자를 한 마디로 요약해
      // 버리는 일이고, 요약은 대체물이 아니다.
      expect(chart).toHaveAttribute('aria-hidden', 'true')
      expect(chart).toHaveAttribute('viewBox', `0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`)
    })

    it('keeps the real table in the DOM even while it is collapsed', async () => {
      answerJson(REVENUE_PATH, sellerRevenue)
      await openDashboard()

      const table = screen.getByRole('table', { name: copy.chart.tableCaption })
      // 머리글 한 줄 + 서른 날.
      expect(within(table).getAllByRole('row')).toHaveLength(REVENUE_DAYS + 1)
    })

    it('carries the same numbers the line was drawn from', async () => {
      answerJson(REVENUE_PATH, sellerRevenue)
      await openDashboard()

      const table = screen.getByRole('table', { name: copy.chart.tableCaption })
      const best = sellerRevenue.days[REVENUE_DAYS - 1]

      expect(within(table).getByText(money(best?.salesAmount ?? -1))).toBeVisible()
    })

    it('opens and closes without ever removing the table', async () => {
      const user = userEvent.setup()
      answerJson(REVENUE_PATH, sellerRevenue)
      await openDashboard()

      const toggle = screen.getByRole('button', { name: copy.chart.showTable })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')

      await user.click(toggle)

      const opened = screen.getByRole('button', { name: copy.chart.hideTable })
      expect(opened).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('table', { name: copy.chart.tableCaption })).toBeVisible()
    })
  })

  describe('the comparison with the previous period (F6)', () => {
    it('states the change as a sentence, not a coloured arrow', async () => {
      answerJson(REVENUE_PATH, sellerRevenue)
      await openDashboard()

      const comparison = screen.getByRole('region', { name: copy.comparison.title })

      expect(
        within(comparison).getByText(money(sellerRevenue.previous.salesAmount), { exact: false }),
      ).toBeVisible()
      expect(within(comparison).getByText(/늘었어요|줄었어요/u)).toBeVisible()
    })

    it('refuses to print a percentage when the previous period sold nothing', async () => {
      answerJson(REVENUE_PATH, sellerRevenueWithoutPrevious)
      await openDashboard()

      const comparison = screen.getByRole('region', { name: copy.comparison.title })

      expect(within(comparison).getByText(copy.comparison.none)).toBeVisible()
      // 「+∞%」도 「+100%」도 둘 다 거짓말이다. 어떤 퍼센트도 그리지 않는다.
      expect(comparison.textContent).not.toContain('%')
    })
  })

  describe('the period filter', () => {
    it('asks again with the dates that were typed', async () => {
      const user = userEvent.setup()
      answerJson(REVENUE_PATH, sellerRevenue)
      await openDashboard()

      const from = screen.getByLabelText(copy.filters.fromLabel)
      await user.clear(from)
      await user.type(from, '2026-09-01')

      await waitFor(() => {
        expect(new URL(lastRequestTo(REVENUE_PATH) ?? '').searchParams.get('from')).toBe(
          '2026-09-01',
        )
      })
    })

    it('says a reversed range is reversed instead of asking for it', async () => {
      const user = userEvent.setup()
      answerJson(REVENUE_PATH, sellerRevenue)
      await openDashboard()

      const before = lastRequestTo(REVENUE_PATH)
      const to = screen.getByLabelText(copy.filters.toLabel)
      await user.clear(to)
      await user.type(to, '2026-07-01')

      expect(await screen.findByRole('alert')).toHaveTextContent(copy.filters.rangeReversed)
      // 서버는 그 질의에 0원으로 답한다 — 그리고 판매자는 그것을 「매출이 없다」로 읽는다.
      expect(lastRequestTo(REVENUE_PATH)).toBe(before)
    })
  })

  describe('when the API refuses or never answers', () => {
    it('offers a retry rather than an empty chart', async () => {
      answerNetworkFailure(REVENUE_PATH)
      renderWithAuth(<RevenueDashboard now={NOW} />)

      expect(await screen.findByText(copy.errorTitle)).toBeVisible()
      expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
    })

    it('reads the refusal out of the shared envelope', async () => {
      answerFailure(REVENUE_PATH, 403, 'AUTH_REQUIRED', '로그인이 필요합니다.')
      renderWithAuth(<RevenueDashboard now={NOW} />)

      expect(await screen.findByText(copy.errorTitle)).toBeVisible()
      expect(screen.getByText(messagesFor().errors.AUTH_REQUIRED, { exact: false })).toBeVisible()
    })
  })

  describe('an account with no store', () => {
    it('is pointed at the application form and nothing is asked of the API', async () => {
      renderWithAuth(<RevenueDashboard now={NOW} />, { session: null })

      expect(await screen.findByText(copy.noStore.title)).toBeVisible()
      // 매출을 **묻지도 않는다** — 스토어가 없는 계정에 서버가 답할 매출이 없다.
      expect(lastRequestTo(REVENUE_PATH)).toBeNull()
    })
  })
})
