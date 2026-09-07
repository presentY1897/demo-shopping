/**
 * `/orders`, CS 가 실제로 만지는 대로 (TASK-0095).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 치거나 누른다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 주문번호로 바로 찾아지는가(F4), 다중 판매자 주문의 **묶음이 전부** 보이는가(F5),
 * 결제와 환불이 한 화면에서 읽히는가(F6), 그리고 **상태를 바꾸는 문이 없다는 사실을
 * 화면이 말하는가**다 (F7) — 버튼이 그냥 없으면 읽는 사람은 그것을 자기 권한 문제로
 * 읽는다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/admin/orders` 의 대역이 없고, 이 TASK 는 `apps/admin` 밖을
 * 고치지 않는다. 그래서 `lib/catalog/console-api` 를 대신 세운다 — 경로와 스키마가 그
 * 한 파일에 모여 있는 것이 이것을 가능하게 하고, 답은 여전히 계약 스키마를 지난 값이다
 * (`support/catalog.ts`).
 */

import { ApiClientError } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import {
  CATALOG_SELLER_ID,
  orderList,
  orderPayment,
  orderPayments,
  orderRow,
  splitOrderRow,
} from './support/catalog'
import { storeList, storeRow } from './support/stores'

const catalogApi = vi.hoisted(() => ({
  fetchProducts: vi.fn(),
  hideProduct: vi.fn(),
  unhideProduct: vi.fn(),
  fetchOrders: vi.fn(),
  fetchOrderPayments: vi.fn(),
  productSearch: vi.fn(),
  orderSearch: vi.fn(),
}))

const storesApi = vi.hoisted(() => ({
  fetchStores: vi.fn(),
  fetchStoreHistory: vi.fn(),
}))

vi.mock('@/lib/catalog/console-api', () => catalogApi)
vi.mock('@/lib/stores/console-api', () => storesApi)

const { adminOrders: copy } = messagesFor()

const BUYER_ID = '019596e0-0041-7000-8000-000000000001'

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

async function openScreen(): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: OrdersPage } = await import('@/app/orders/page')

  renderWithAuth(<OrdersPage />)
  await screen.findByRole('table', { name: copy.list.listLabel })

  return user
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: copy.list.listLabel })
}

/** 주문 하나를 연다. 목록의 「주문 상세」가 그 문이다. */
async function openDetail(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: new RegExp(copy.list.openLabel) }))

  return screen.findByRole('dialog', { name: copy.detail.title })
}

beforeEach(() => {
  vi.clearAllMocks()
  catalogApi.fetchOrders.mockResolvedValue(orderList([orderRow()]))
  catalogApi.fetchOrderPayments.mockResolvedValue(orderPayments([orderPayment()]))
  storesApi.fetchStores.mockResolvedValue(
    storeList([storeRow({ sellerId: CATALOG_SELLER_ID, brandName: '루미에르' })]),
  )
})

describe('주문 검색 (F4)', () => {
  /** CS 가 가장 먼저 손에 쥐는 값이다. 앞뒤 공백은 떼고, 나머지는 정확히 일치다 (4.3). */
  it('searches by an exact order number, with the pasted whitespace trimmed', async () => {
    const user = await openScreen()

    await user.type(screen.getByLabelText(copy.list.filters.orderNumberLabel), ' 20260906-000123 ')
    await user.click(screen.getByRole('button', { name: copy.list.filters.submit }))

    expect(catalogApi.fetchOrders).toHaveBeenLastCalledWith(
      { orderNumber: '20260906-000123' },
      expect.anything(),
    )
  })

  it('says out loud that the number has to match exactly', async () => {
    await openScreen()

    expect(screen.getByText(copy.list.filters.orderNumberHint)).toBeVisible()
  })

  it('does not go out on every keystroke', async () => {
    const user = await openScreen()

    await user.type(screen.getByLabelText(copy.list.filters.orderNumberLabel), '2026')

    expect(catalogApi.fetchOrders).toHaveBeenCalledTimes(1)
  })

  it('narrows by store and by period', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.sellerLabel }))
    await user.click(await screen.findByRole('option', { name: '루미에르' }))
    await user.type(screen.getByLabelText(copy.list.filters.fromLabel), '2026-09-01')
    await user.type(screen.getByLabelText(copy.list.filters.toLabel), '2026-09-07')
    await user.click(screen.getByRole('button', { name: copy.list.filters.submit }))

    expect(catalogApi.fetchOrders).toHaveBeenLastCalledWith(
      { sellerId: CATALOG_SELLER_ID, from: '2026-09-01', to: '2026-09-07' },
      expect.anything(),
    )
  })

  /**
   * 뒤집힌 기간은 서버가 **200 과 빈 목록**으로 답한다 — 아무도 그것이 조건 탓이라고
   * 말해 주지 않는다. 그래서 보내기 전에 그 자리에서 돌려보낸다.
   */
  it('refuses to send a period whose start is after its end', async () => {
    const user = await openScreen()

    await user.type(screen.getByLabelText(copy.list.filters.fromLabel), '2026-09-07')
    await user.type(screen.getByLabelText(copy.list.filters.toLabel), '2026-09-01')
    await user.click(screen.getByRole('button', { name: copy.list.filters.submit }))

    expect(await screen.findByText(copy.list.filters.issues.range)).toBeVisible()
    expect(catalogApi.fetchOrders).toHaveBeenCalledTimes(1)
  })

  it('refuses a buyer id that is not one, and accepts one that is', async () => {
    const user = await openScreen()
    const field = screen.getByLabelText(copy.list.filters.buyerIdLabel)

    await user.type(field, 'hong')
    await user.click(screen.getByRole('button', { name: copy.list.filters.submit }))

    expect(await screen.findByText(copy.list.filters.issues.buyerId)).toBeVisible()
    expect(catalogApi.fetchOrders).toHaveBeenCalledTimes(1)

    await user.clear(field)
    await user.type(field, BUYER_ID)
    await user.click(screen.getByRole('button', { name: copy.list.filters.submit }))

    expect(catalogApi.fetchOrders).toHaveBeenLastCalledWith(
      { buyerId: BUYER_ID },
      expect.anything(),
    )
  })

  it('says an empty result is the filter’s doing once something was narrowed', async () => {
    const user = await openScreen()

    catalogApi.fetchOrders.mockResolvedValue(orderList([]))
    await user.type(screen.getByLabelText(copy.list.filters.orderNumberLabel), 'NOPE')
    await user.click(screen.getByRole('button', { name: copy.list.filters.submit }))

    expect(await screen.findByText(copy.list.filteredEmptyTitle)).toBeVisible()
  })
})

describe('묶음과 개인정보 (F5)', () => {
  /** 하나만 보이면 다중 판매자 주문의 절반이 화면에서 사라진다 (4.3). */
  it('draws every seller bundle of a split order, in the list itself', async () => {
    catalogApi.fetchOrders.mockResolvedValue(orderList([splitOrderRow()]))

    await openScreen()

    const rows = table()

    expect(within(rows).getByText('루미에르')).toBeVisible()
    expect(within(rows).getByText('아틀리에')).toBeVisible()
    expect(within(rows).getByText(copy.statusLabels.PAID)).toBeVisible()
    expect(within(rows).getByText(copy.statusLabels.SHIPPED)).toBeVisible()
    expect(within(rows).getByText(copy.list.bundleValue.replace('{count}', '2'))).toBeVisible()
  })

  /** 계약이 가려진 이름만 싣는다. 화면에는 되돌릴 코드도 가릴 코드도 없다. */
  it('shows the masked buyer name and says why it is masked', async () => {
    await openScreen()

    expect(within(table()).getByText('홍*동')).toBeVisible()
    expect(screen.getByText(copy.list.maskedNotice)).toBeVisible()
  })
})

describe('주문 상세 (F5 · F6 · F7)', () => {
  it('lists the bundles again without asking the API for them', async () => {
    catalogApi.fetchOrders.mockResolvedValue(orderList([splitOrderRow()]))

    const user = await openScreen()
    const dialog = await openDetail(user)
    const bundles = within(dialog).getByRole('table', { name: copy.detail.bundlesLabel })

    expect(within(bundles).getByText('루미에르')).toBeVisible()
    expect(within(bundles).getByText('아틀리에')).toBeVisible()
    // 묶음은 목록의 줄이 이미 들고 있다. 다시 묻는 것은 결제뿐이다.
    expect(catalogApi.fetchOrders).toHaveBeenCalledTimes(1)
  })

  it('reads the payments and totals what was refunded', async () => {
    const row = orderRow()
    catalogApi.fetchOrders.mockResolvedValue(orderList([row]))
    catalogApi.fetchOrderPayments.mockResolvedValue(
      orderPayments([
        orderPayment({ amount: 189_000, canceledAmount: 40_000, status: 'PARTIAL_CANCELED' }),
      ]),
    )

    const user = await openScreen()
    const dialog = await openDetail(user)

    expect(catalogApi.fetchOrderPayments).toHaveBeenCalledWith(row.orderId, expect.anything())

    const payments = within(dialog).getByRole('table', { name: copy.detail.paymentsLabel })

    expect(within(payments).getByText(/40,000/)).toBeVisible()
    expect(within(dialog).getByText(new RegExp(copy.detail.refundedLabel))).toHaveTextContent(
      /40,000/,
    )
  })

  /** 승인 전에 끊긴 결제 시도가 실제로 남는다. 빈칸은 「못 읽었다」와 섞인다. */
  it('says 승인 전 rather than leaving the approval time blank', async () => {
    catalogApi.fetchOrderPayments.mockResolvedValue(
      orderPayments([orderPayment({ approvedAt: null, status: 'READY' })]),
    )

    const user = await openScreen()
    const dialog = await openDetail(user)

    expect(within(dialog).getByText(copy.detail.notApproved)).toBeVisible()
  })

  it('offers a retry when the payments could not be read', async () => {
    catalogApi.fetchOrderPayments.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'for the log' }),
    )

    const user = await openScreen()
    const dialog = await openDetail(user)

    expect(within(dialog).getByText(copy.detail.paymentsErrorTitle)).toBeVisible()
    expect(within(dialog).getByText(copy.failures.network)).toBeVisible()

    catalogApi.fetchOrderPayments.mockResolvedValue(orderPayments([orderPayment()]))
    await user.click(within(dialog).getByRole('button', { name: copy.detail.paymentsRetryLabel }))

    await waitFor(() => {
      expect(within(dialog).getByRole('table', { name: copy.detail.paymentsLabel })).toBeVisible()
    })
  })

  /**
   * **F7 은 없는 버튼에 대한 검사다.** 손으로 상태를 옮기면 재고·정산·환불이 따라오지
   * 않고, 그 어긋남은 몇 단계 뒤에 「정산 금액이 이상하다」로 나타난다 (4.4). 그래서
   * 화면은 그 사실과 이유와 대신 갈 곳을 함께 말한다.
   */
  it('offers no way to move the order, and says why, and points at the claim route', async () => {
    const user = await openScreen()
    const dialog = await openDetail(user)

    expect(within(dialog).getByText(copy.detail.statusNotice)).toBeVisible()
    expect(within(dialog).getByRole('link', { name: copy.detail.claimsLinkLabel })).toHaveAttribute(
      'href',
      '/claims',
    )
    // 상태 이름은 그려지지만 그것을 바꿀 수 있는 컨트롤은 하나도 없다.
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(within(dialog).getAllByRole('button')).toHaveLength(1)
    expect(within(dialog).getByRole('button', { name: copy.detail.closeLabel })).toBeVisible()
  })
})

describe('불러오지 못했을 때', () => {
  it('shows the failure and a way to retry', async () => {
    catalogApi.fetchOrders.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'for the log' }),
    )

    const user = userEvent.setup()
    const { default: OrdersPage } = await import('@/app/orders/page')

    renderWithAuth(<OrdersPage />)

    expect(await screen.findByText(copy.list.errorTitle)).toBeVisible()
    expect(screen.getByText(copy.failures.network)).toBeVisible()

    catalogApi.fetchOrders.mockResolvedValue(orderList([orderRow()]))
    await user.click(screen.getByRole('button', { name: copy.list.retryLabel }))

    expect(await screen.findByRole('table', { name: copy.list.listLabel })).toBeVisible()
  })
})

describe('접근성', { timeout: 20_000 }, () => {
  it('has no violations with the list on screen', async () => {
    await openScreen()

    await expectNoViolations()
  })

  it('has no violations with one order open', async () => {
    const user = await openScreen()
    await openDetail(user)

    await expectNoViolations()
  })
})
