/**
 * `/mypage/orders` — 주문 내역 목록 (TASK-0063).
 *
 * 대역은 `@shopping/api-mocks` 의 것이고 실 API 를 부르지 않는다 (QUALITY-GATES 2장).
 *
 * **시계를 픽스처의 「지금」에 맞춘다.** 화면이 「최근 3개월」의 시작을 계산해 질의로
 * 보내고, 픽스처 다섯 건이 그 시각을 기준으로 경계 양쪽에 흩어져 있다. 시계를 맞추지
 * 않으면 이 파일의 검사들은 실행하는 날짜에 따라 다른 답을 낸다 — 통과했다가
 * 언젠가 조용히 빨개지는 종류다.
 *
 * **거르는 것은 서버다** (TASK-0063 2장). 그래서 여기서 재는 것은 「화면이 목록을
 * 잘 걸렀는가」가 아니라 **「화면이 조건을 질의로 보내고 그 답을 그리는가」**다 —
 * 대역도 서버와 같은 스키마로 질의를 읽고 같은 뜻으로 거른다.
 */

import {
  httpFailure,
  MOCK_ORDER_NOW,
  MOCK_ORDER_PAGE_SIZE,
  mockPaths,
  neverAnswers,
  noOrders,
  resetOrderStore,
  sessionBuyer,
  shopperOrderPage,
  shopperOrderPageTwo,
} from '@shopping/api-mocks'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OrdersPage from '@/app/mypage/orders/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/orders' }))

const messages = messagesFor()
const copy = messages.mypage.orders

async function openList(seed: typeof shopperOrderPage = shopperOrderPage): Promise<UserEvent> {
  resetOrderStore(seed)

  const user = userEvent.setup()

  renderAccountScreen(<OrdersPage />, { session: sessionBuyer })
  await screen.findByRole('heading', { level: 1, name: copy.title })

  return user
}

async function listReady(): Promise<HTMLElement> {
  return screen.findByRole('list', { name: copy.listLabel })
}

/**
 * 지금 그려진 목록.
 *
 * 조건이 바뀌면 화면이 다시 물으므로 그 사이에는 목록이 없다. `waitFor` 안에서
 * 부르면 그 틈이 재시도로 넘어간다 — 조건을 바꾼 직후에 개수를 세는 검사들이
 * 전부 이 함수를 쓴다.
 */
function shownList(): HTMLElement {
  return screen.getByRole('list', { name: copy.listLabel })
}

/** 목록에 실제로 그려진 주문번호들. */
function shownOrderNumbers(list: HTMLElement): readonly string[] {
  return within(list)
    .getAllByRole('link')
    .map((link) => link.getAttribute('aria-label') ?? '')
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(MOCK_ORDER_NOW))
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  vi.unstubAllGlobals()
  resetOrderStore()
})

describe('네 상태 (U1 · P5)', () => {
  it('불러오는 동안 기다림을 알린다', async () => {
    // 답이 오지 않는 동안 화면을 붙잡아 둔다. 세션 확인이 먼저 지나가므로 그냥
    // 렌더한 직후에는 아직 로그인 확인 스켈레톤이 서 있다.
    testServer.server.use(neverAnswers(mockPaths.orders))
    renderAccountScreen(<OrdersPage />, { session: sessionBuyer })

    expect(await screen.findByRole('status', { name: copy.loadingLabel })).toBeInTheDocument()
  })

  it('주문이 있으면 목록을 그린다', async () => {
    await openList()

    const list = await listReady()

    // 기본 필터는 3개월이라 첫 장 셋이 전부 든다.
    expect(within(list).getAllByRole('link')).toHaveLength(shopperOrderPage.orders.length)
  })

  it('주문한 적이 없으면 상품을 보러 가라고 한다', async () => {
    await openList(noOrders)

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.emptyAction })).toBeVisible()
  })

  it('읽기가 실패하면 다시 시도할 수 있다', async () => {
    testServer.server.use(
      httpFailure(mockPaths.orders, 500, 'INTERNAL_ERROR', '서버에서 문제가 생겼습니다.'),
    )

    renderAccountScreen(<OrdersPage />, { session: sessionBuyer })

    expect(await screen.findByText(messages.mypage.loadErrorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: messages.mypage.retryLabel })).toBeVisible()
  })
})

describe('한 줄이 말하는 것', () => {
  it('판매자별 상태를 하나로 뭉치지 않는다', async () => {
    await openList()

    const list = await listReady()
    const first = within(list).getAllByRole('listitem')[0]

    if (first === undefined) throw new Error('첫 줄이 없다')

    // 세 판매자가 배송완료 · 배송중 · 상품준비중이다. 대표 상태 하나로 줄이면
    // 목록에서 이미 거짓말이 시작된다 (D-023).
    expect(within(first).getByText(copy.statuses.DELIVERED)).toBeVisible()
    expect(within(first).getByText(copy.statuses.SHIPPED)).toBeVisible()
    expect(within(first).getByText(copy.statuses.PREPARING)).toBeVisible()
  })

  it('링크 이름이 주문번호를 싣는다 (WCAG 2.4.4)', async () => {
    await openList()

    const list = await listReady()
    const names = shownOrderNumbers(list)

    // 「주문 상세」가 스무 개 있는 목록은 링크를 훑는 사람에게 아무 말도 하지 않는다.
    expect(new Set(names).size).toBe(names.length)
    expect(names[0]).toContain(shopperOrderPage.orders[0]?.orderNumber ?? '')
  })
})

describe('기간·상태 필터 (서버가 거른다)', () => {
  it('조건을 질의로 보낸다 — 상태는 쉼표 목록, 기간은 ISO 시각', async () => {
    const asked: URL[] = []

    testServer.server.events.on('request:start', ({ request }) => {
      const url = new URL(request.url)

      if (url.pathname.endsWith('/orders')) asked.push(url)
    })

    const user = await openList()

    await listReady()

    await user.click(screen.getByRole('combobox', { name: copy.statusLabel }))
    await user.click(screen.getByRole('option', { name: copy.statusFilters.pending }))

    await waitFor(() => {
      expect(asked.length).toBeGreaterThan(1)
    })

    // **기본 조건은 아무것도 안 싣는다.** 사람이 고르지 않은 조건이 결과를 지우면
    // 빈 화면의 뜻이 거짓이 되므로, 좁히는 것은 고를 때만 일어난다.
    expect(asked[0]?.searchParams.get('from')).toBeNull()
    expect(asked[0]?.searchParams.get('status')).toBeNull()
    expect(asked[0]?.searchParams.get('status')).toBeNull()

    // 탭 하나가 상태 둘이 되고, 쿼리스트링에는 배열이 없으므로 **쉼표 하나**다 —
    // 판매자 목록과 같은 문법이다.
    expect(asked.at(-1)?.searchParams.get('status')).toBe('PAYMENT_PENDING,PAYMENT_FAILED')

    testServer.server.events.removeAllListeners('request:start')
  })

  it('불러오지 않은 장에 있던 주문도 조건에 맞으면 나온다', async () => {
    const user = await openList()

    await listReady()

    // 구매확정된 주문은 셋인데 **둘은 둘째 장에 있다**. 화면이 불러온 것 위에서
    // 걸렀다면 여기서 하나만 나온다 — 서버가 걸렀다는 증거가 이 숫자다.
    await user.click(screen.getByRole('combobox', { name: copy.periodLabel }))
    await user.click(screen.getByRole('option', { name: copy.periods.all }))
    await user.click(screen.getByRole('combobox', { name: copy.statusLabel }))
    await user.click(screen.getByRole('option', { name: copy.statusFilters.confirmed }))

    await waitFor(() => {
      expect(within(shownList()).getAllByRole('link')).toHaveLength(3)
    })
  })

  it('기간을 좁히면 오래된 주문이 빠진다', async () => {
    const user = await openList()

    await listReady()

    // 기본 3개월에는 셋, 1개월로 좁히면 둘 (6월 15일 주문이 빠진다).
    await user.click(screen.getByRole('combobox', { name: copy.periodLabel }))
    await user.click(screen.getByRole('option', { name: copy.periods['1m'] }))

    await waitFor(() => {
      expect(within(shownList()).getAllByRole('link')).toHaveLength(2)
    })
  })

  it('상태로 좁히면 그 상태를 가진 묶음이 있는 주문만 남는다', async () => {
    const user = await openList()

    await listReady()

    await user.click(screen.getByRole('combobox', { name: copy.statusLabel }))
    await user.click(screen.getByRole('option', { name: copy.statusFilters.shipping }))

    // 배송중인 **묶음이 하나라도 있는** 주문이 답이다. 첫 주문은 배송완료·배송중·
    // 준비중이 섞여 있고, 「전부 배송중」으로 쳤다면 여기서 사라진다.
    await waitFor(() => {
      const links = within(shownList()).getAllByRole('link')

      expect(links).toHaveLength(1)
      expect(links[0]?.getAttribute('aria-label')).toContain(
        shopperOrderPage.orders[0]?.orderNumber ?? '',
      )
    })
  })

  it('조건에 맞는 것이 없으면 「조건을 지우라」고 한다', async () => {
    const user = await openList()

    await listReady()

    await user.click(screen.getByRole('combobox', { name: copy.statusLabel }))
    await user.click(screen.getByRole('option', { name: copy.statusFilters.pending }))

    // 「주문한 적이 없습니다」가 아니다. 조건을 걸어 둔 사람에게 그렇게 말하면
    // 화면이 거짓말을 한다.
    expect(await screen.findByText(copy.filteredEmptyTitle)).toBeVisible()
    expect(screen.queryByText(copy.emptyTitle)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: copy.resetFilter }))

    expect(await listReady()).toBeVisible()
  })

  it('조건에 맞는 것이 없으면 남은 장도 없다', async () => {
    const user = await openList()

    await listReady()

    await user.click(screen.getByRole('combobox', { name: copy.statusLabel }))
    await user.click(screen.getByRole('option', { name: copy.statusFilters.pending }))
    await screen.findByText(copy.filteredEmptyTitle)

    // 서버가 거르고 나서 자르므로, 걸러진 결과가 비면 다음 장도 없다. 화면이
    // 「더 있을 수 있습니다」로 자기 한계를 말하던 자리가 여기였고, 그 말은 이제
    // 거짓이라 사라졌다.
    expect(screen.queryByRole('button', { name: copy.loadMore })).not.toBeInTheDocument()
  })
})

describe('커서 페이지네이션', () => {
  /** 「전체 기간」으로 넓혀 다섯 건을 두 장에 걸치게 한다. */
  async function openAllPeriods(): Promise<UserEvent> {
    const user = await openList()

    await listReady()
    await user.click(screen.getByRole('combobox', { name: copy.periodLabel }))
    await user.click(screen.getByRole('option', { name: copy.periods.all }))
    await waitFor(() => {
      expect(within(shownList()).getAllByRole('link')).toHaveLength(MOCK_ORDER_PAGE_SIZE)
    })

    return user
  }

  it('석 달로 좁히면 한 장에 다 들어와 「더 보기」가 없다', async () => {
    const user = await openList()

    await listReady()
    await user.click(screen.getByRole('combobox', { name: copy.periodLabel }))
    await user.click(screen.getByRole('option', { name: copy.periods['3m'] }))

    // 최근 3개월에 드는 것이 셋이고 한 장이 셋이다. 서버가 **거르고 나서** 자르기
    // 때문에 나오는 결과이고, 미리 잘린 장을 주는 대역에서는 잴 수 없다.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: copy.loadMore })).not.toBeInTheDocument()
    })
  })

  it('「더 보기」가 앞 장을 지우지 않고 이어 붙인다', async () => {
    const user = await openAllPeriods()

    // jsdom 에는 `IntersectionObserver` 가 없으므로 버튼이 유일한 길이다. 그것이
    // `useInfiniteScroll` 이 `supported` 를 내주는 이유이고, 키보드만 쓰는
    // 사람에게도 같은 길이다 (U5).
    await user.click(screen.getByRole('button', { name: copy.loadMore }))

    await waitFor(() => {
      expect(within(shownList()).getAllByRole('link')).toHaveLength(
        shopperOrderPage.orders.length + shopperOrderPageTwo.orders.length,
      )
    })
    expect(
      screen.getByText(
        copy.countLabel.replace(
          '{count}',
          String(shopperOrderPage.orders.length + shopperOrderPageTwo.orders.length),
        ),
      ),
    ).toBeVisible()
  })

  it('마지막 장에 닿으면 「더 보기」가 사라진다', async () => {
    const user = await openAllPeriods()

    await user.click(screen.getByRole('button', { name: copy.loadMore }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: copy.loadMore })).not.toBeInTheDocument()
    })
  })

  it('조건이 바뀌면 이어 붙인 것을 버리고 다시 묻는다', async () => {
    const user = await openAllPeriods()

    await user.click(screen.getByRole('button', { name: copy.loadMore }))
    await waitFor(() => {
      expect(within(shownList()).getAllByRole('link')).toHaveLength(5)
    })

    // 조건이 바뀌면 지금까지 이어 붙인 것은 **다른 질문의 답**이다. 남겨 두면
    // 좁혔는데 넓은 조건의 주문이 화면에 남는다.
    await user.click(screen.getByRole('combobox', { name: copy.periodLabel }))
    await user.click(screen.getByRole('option', { name: copy.periods['1m'] }))

    await waitFor(() => {
      expect(within(shownList()).getAllByRole('link')).toHaveLength(2)
    })
  })
})
