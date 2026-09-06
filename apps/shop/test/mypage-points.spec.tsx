/**
 * `/mypage/points` — 적립금 (TASK-0077 F4 · F5 · F6 · F7).
 *
 * **이 파일이 재는 것의 중심은 F4 와 F6 이다.**
 *
 * F4 — 원장을 그대로 보여 주는가. 「왜 줄었지」에 답하는 것이 이 화면의 존재 이유이고,
 * 그 답은 줄마다 붙은 `balanceAfter` 다. 그래서 검사는 「숫자가 보인다」가 아니라
 * **사슬이 읽히는가**를 묻는다: 사용 줄의 잔액이 그 앞 적립 줄의 잔액에서 사용액만큼
 * 줄어 있는가.
 *
 * F6 — 「샀는데 왜 적립이 안 됐지」에 미리 답하는가. 원장에 행이 없는 사실이라, 그것을
 * 그리지 않으면 아무리 정확한 원장도 그 오해를 풀지 못한다.
 *
 * **화면이 로딩을 지나온 뒤에 단언한다** (`cart-page.spec.tsx` 의 함정).
 */

import {
  emptyPointLedger,
  emptyPointSummary,
  httpFailureOn,
  MOCK_POINT_LEDGER_PAGE_SIZE,
  MOCK_POINT_ORDER_ID,
  mockPaths,
  mockPointLedgerSeeds,
  resetPointStore,
  sessionBuyer,
  shopperPointSummary,
} from '@shopping/api-mocks'
import type { PointLedgerEntry } from '@shopping/shared'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { formatMoney } from '@shopping/ui/format'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PointsPage from '@/app/mypage/points/page'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/points' }))

const messages = messagesFor()
const copy = messages.mypage.points

const won = (amount: number): string => formatMoney({ amount, currency: 'KRW' })

/** 씨앗 한 줄을, **없으면 터지면서** 꺼낸다. */
function seed(seq: number): PointLedgerEntry {
  const row = mockPointLedgerSeeds.find((entry) => entry.seq === seq)

  if (row === undefined) throw new Error(`원장 씨앗 ${String(seq)} 번이 없다`)

  return row
}

/** 적립 → 사용 → 적립의 세 줄. 사슬이 읽히는지를 이 셋으로 묻는다. */
const EARNED = seed(3)
const USED = seed(4)
const ADJUSTED = seed(7)

async function openScreen(
  summary: typeof shopperPointSummary = shopperPointSummary,
  entries: readonly PointLedgerEntry[] = mockPointLedgerSeeds,
): Promise<UserEvent> {
  resetPointStore(summary, entries)

  const user = userEvent.setup()

  renderAccountScreen(<PointsPage />, { session: sessionBuyer })
  await screen.findByRole('heading', { level: 1, name: copy.title })

  // 원장이 도착할 때까지. 비어 있으면 표 대신 빈 상태가 온다.
  if (entries.length === 0) await screen.findByText(copy.emptyTitle)
  else await screen.findByRole('table')

  return user
}

/**
 * 잔액이 사는 구역.
 *
 * 화면 전체에서 금액으로 찾으면 머리의 잔액과 원장 마지막 줄의 잔액이 **둘 다** 걸린다.
 * 그 둘이 같은 수인 것은 결함이 아니라 이 화면이 대사된다는 증거이므로(마지막 줄의
 * `balanceAfter` 가 곧 지금 잔액이다), 구역으로 좁혀서 묻는다.
 */
function head(): HTMLElement {
  return screen.getByRole('region', { name: copy.balanceLabel })
}

/** 표에서 이 글자가 처음 나오는 줄. 「그 줄의 잔액」을 물으려면 줄을 먼저 집는다. */
function ledgerRow(text: string): HTMLElement {
  const [cell] = screen.getAllByText(text)
  const row = cell?.closest('tr') ?? null

  if (row === null) throw new Error(`${text} 줄을 찾지 못했습니다.`)

  return row
}

function countRequests(method: string, endsWith: string): () => number {
  let seen = 0

  testServer.server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(endsWith)) seen += 1
  })

  return () => seen
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  testServer.server.events.removeAllListeners()
})

describe('잔액과 그 주변', () => {
  it('says what is on the account right now', async () => {
    await openScreen()

    expect(within(head()).getByText(won(shopperPointSummary.account.balance))).toBeVisible()
  })

  it('says what is coming at 구매확정, and why it has not arrived (F6)', async () => {
    await openScreen()

    // 이 두 줄이 「샀는데 왜 적립이 안 됐지」에 대한 답이다. 원장에는 이 사실을
    // 말하는 행이 없으므로, 여기 없으면 어디에도 없다.
    expect(screen.getByText(new RegExp(copy.pendingTitle, 'u'))).toBeVisible()
    expect(screen.getByText(copy.pendingBody)).toBeVisible()
    expect(screen.getByText(new RegExp(won(shopperPointSummary.pendingEarn), 'u'))).toBeVisible()
  })

  it('says there is nothing waiting rather than drawing a zero', async () => {
    await openScreen(emptyPointSummary, emptyPointLedger.entries)

    // 「0원이 들어올 예정」은 사실이지만 사람이 찾는 답이 아니다.
    expect(screen.getByText(copy.pendingNone)).toBeVisible()
    expect(screen.queryByText(copy.pendingBody)).toBeNull()
  })

  it('warns about what disappears soon, with the amount and the day', async () => {
    await openScreen()

    const expiring = shopperPointSummary.expiringSoon

    if (expiring === null) throw new Error('만료 예정 씨앗이 없다')

    expect(screen.getByText(copy.expiringTitle)).toBeVisible()
    expect(within(head()).getByText(new RegExp(won(expiring.amount), 'u'))).toBeVisible()
  })

  it('draws no warning when nothing is about to expire', async () => {
    await openScreen(emptyPointSummary, emptyPointLedger.entries)

    expect(screen.queryByText(copy.expiringTitle)).toBeNull()
  })
})

describe('원장 그대로 (F4)', () => {
  it('gives every row a Korean name for its type (R1)', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.loadMore }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: copy.loadMore })).toBeNull()
    })

    // 다섯 유형이 전부 그려진다. `Record` 가 문장을 강제하지만, 그려지는지는 다른
    // 질문이다 — 라벨이 있는데 표가 코드를 그대로 찍는 화면도 컴파일된다.
    for (const type of ['EARN', 'USE', 'RESTORE', 'EXPIRE', 'ADJUST'] as const) {
      expect(screen.getAllByText(copy.types[type]).length).toBeGreaterThan(0)
    }
  })

  it('shows the balance after each row, which is what answers 「왜 줄었지」', async () => {
    await openScreen()

    // 사슬이 읽힌다: 3,000원이 들어와 잔액이 3,000이 되고, 2,000원을 써서 1,000이
    // 된다. 이 두 칸이 나란히 보이지 않으면 원장은 숫자의 목록일 뿐이다.
    // 그 적립이 첫 적립이라 금액과 잔액이 같은 수이고, 그래서 한 줄에 두 번 나온다.
    expect(
      within(ledgerRow(won(EARNED.amount))).getAllByText(won(EARNED.balanceAfter)),
    ).toHaveLength(2)
    expect(within(ledgerRow(won(USED.amount))).getByText(won(USED.balanceAfter))).toBeVisible()
    expect(USED.balanceAfter).toBe(EARNED.balanceAfter + USED.amount)
  })

  it('keeps the sign, so an increase and a decrease do not look alike', async () => {
    await openScreen()

    expect(USED.amount).toBeLessThan(0)
    expect(screen.getAllByText(won(USED.amount))[0]?.textContent).toContain('-')
  })

  it('says why a hand-made adjustment happened', async () => {
    await openScreen()

    // 사유가 없으면 그 줄은 아무도 설명할 수 없는 잔액 변동이 된다. `ADJUST` 에만
    // 사유가 필수인 이유가 그것이고(계약), 그 문장이 관련 칸에 그대로 선다.
    expect(ADJUSTED.reason).not.toBeNull()
    expect(screen.getByText(ADJUSTED.reason ?? '')).toBeVisible()
  })

  it('does not summarise the rows away', async () => {
    await openScreen()

    // 한 쪽만큼의 줄이 **그대로** 있다. 「9월에 3,000원 적립, 2,000원 사용」으로
    // 묶으면 사슬이 끊기고, 끊긴 표는 대사할 수 없다.
    const body = screen.getAllByRole('rowgroup').at(-1)

    expect(within(body ?? document.body).getAllByRole('row')).toHaveLength(
      MOCK_POINT_LEDGER_PAGE_SIZE,
    )
  })
})

describe('주문 링크 (F5)', () => {
  it('links a use to the order it paid for', async () => {
    await openScreen()

    const link = within(ledgerRow(won(USED.amount))).getByRole('link')

    expect(link).toHaveAttribute('href', `/mypage/orders/${MOCK_POINT_ORDER_ID}`)
    expect(link).toHaveTextContent(copy.orderLinkText)
  })

  it('leaves a row that points at no order as a row, not a broken link', async () => {
    await openScreen()

    // 적립은 판매자 몫(`SELLER_ORDER`)을 가리킨다 — 구매자가 열 수 있는 화면이
    // 아니므로 링크가 없다. 링크가 없는 줄이지 잘못된 줄이 아니다.
    expect(within(ledgerRow(won(EARNED.amount))).queryByRole('link')).toBeNull()
  })
})

describe('더 보기', () => {
  it('keeps the rows already read when the next page arrives', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.loadMore }))

    await waitFor(() => {
      const body = screen.getAllByRole('rowgroup').at(-1)

      expect(within(body ?? document.body).getAllByRole('row')).toHaveLength(
        mockPointLedgerSeeds.length,
      )
    })
    // 갈아치우면 「더 보기」가 원장을 지우는 버튼이 된다 — 훑던 사람이 답을 잃는다.
    expect(screen.getAllByText(won(ADJUSTED.amount)).length).toBeGreaterThan(0)
  })

  it('asks for the next page once even when pressed twice (U3)', async () => {
    const asked = countRequests('GET', '/transactions')
    const user = await openScreen()

    const before = asked()
    const more = screen.getByRole('button', { name: copy.loadMore })

    await Promise.all([user.click(more), user.click(more)])
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: copy.loadMore })).toBeNull()
    })

    expect(asked()).toBe(before + 1)
  })
})

describe('불러오지 못했을 때 (U1 · U6)', () => {
  it('keeps the balance on screen when only the ledger failed', async () => {
    testServer.server.use(
      httpFailureOn(
        'get',
        mockPaths.mePointTransactions,
        500,
        'INTERNAL_ERROR',
        '문제가 생겼어요.',
      ),
    )
    resetPointStore()

    renderAccountScreen(<PointsPage />, { session: sessionBuyer })

    expect(await screen.findByText(messages.mypage.loadErrorTitle)).toBeVisible()
    // 원장을 못 읽어도 「지금 얼마인가」는 여전히 참이다. 셋을 한 상태로 묶은
    // 화면이었다면 이 숫자까지 사라진다.
    expect(within(head()).getByText(won(shopperPointSummary.account.balance))).toBeVisible()
  })

  it('says nothing about a balance it could not read', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.mePoints, 500, 'INTERNAL_ERROR', '문제가 생겼어요.'),
    )
    resetPointStore()

    renderAccountScreen(<PointsPage />, { session: sessionBuyer })

    expect(await screen.findByRole('table')).toBeVisible()
    expect(screen.getByText(messages.mypage.loadErrorTitle)).toBeVisible()
    expect(screen.queryByText(copy.pendingBody)).toBeNull()
  })

  it('shows an empty ledger as empty rather than as a failure', async () => {
    await openScreen(emptyPointSummary, emptyPointLedger.entries)

    expect(screen.getByText(copy.emptyTitle)).toBeVisible()
    expect(within(head()).getByText(won(0))).toBeVisible()
  })
})

describe('F7 아홉 조합', () => {
  /**
   * 밀도 3 × 뷰포트 3. jsdom 은 아무것도 칠하지 않으므로 「깨짐 0건」을 픽셀로 잴 수
   * 없다 — 잴 수 있는 것은 **완전한 화면인가**이다: 잔액, 적립 예정, 만료 예정, 그리고
   * 한 쪽만큼의 원장.
   *
   * 다섯 열짜리 표가 360px 에서도 페이지를 옆으로 밀지 않는다는 것이 이 조합이 재려는
   * 것이고, 그 성질은 표가 **자기 안에서** 스크롤하는 데서 온다 (`packages/ui` 의 `Table`).
   */
  it.each(
    DENSITY_LEVELS.flatMap((density) =>
      (['mobile', 'tablet', 'desktop'] as const).map((band) => ({ density, band })),
    ),
  )('draws a complete point screen at density $density on $band', async ({ density, band }) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
    document.documentElement.setAttribute('data-density', String(density))
    stubViewport(VIEWPORTS[band])

    await openScreen()

    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
    expect(within(head()).getByText(won(shopperPointSummary.account.balance))).toBeVisible()
    expect(screen.getByText(new RegExp(copy.pendingTitle, 'u'))).toBeVisible()
    expect(screen.getByText(copy.expiringTitle)).toBeVisible()

    const body = screen.getAllByRole('rowgroup').at(-1)

    expect(within(body ?? document.body).getAllByRole('row')).toHaveLength(
      MOCK_POINT_LEDGER_PAGE_SIZE,
    )
  })
})
