/**
 * `/claims`, driven the way an administrator drives it.
 *
 * Everything below renders the real screen and then clicks or types. No
 * component is handed a made-up prop bag and no class name is asserted on
 * (QUALITY-GATES Q5): what is checked is that a filter narrows the queue, that
 * narrowing to one store from a row is possible at all, that the two attention
 * lists answer from their own routes, and that **what a demo administrator
 * cannot do is said in a sentence** rather than expressed as a grey button.
 *
 * The API is `@shopping/api-mocks`, which keeps real claims — so "the list
 * narrowed" is answered by what the API was asked for, not by trusting the
 * frame the screen drew.
 *
 * **`server.use(...adminClaimHandlers)` is the first line of every render.**
 * `/claims/:id` is a door the buyer double opens too, and in the default list
 * that one is registered first; the admin store is only reachable with these
 * handlers in front (the same line every seller console spec starts with).
 */

import {
  adminClaimHandlers,
  adminClaimRowsSnapshot,
  mockPaths,
  networkFailureOn,
  sessionDemoAdmin,
  sessionSellerOwner,
} from '@shopping/api-mocks'
import type { AdminClaimListItem } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ClaimsPage from '@/app/claims/page'
import HomePage from '@/app/page'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const { claims: copy } = messagesFor()

/**
 * The dashboard's three doors, held open (TASK-0092).
 *
 * `HomePage` now mounts `DashboardWorkspace`, and `packages/api-mocks` carries
 * no handler for `/admin/dashboard/*` — an unhandled request fails the whole
 * file. The stub answers **nothing**, so each dashboard section stays in its
 * loading state and this file keeps measuring the claim panel it is about.
 */
vi.mock('@/lib/dashboard/console-api', () => ({
  fetchDashboardMetrics: vi.fn(() => new Promise(() => undefined)),
  fetchDashboardPending: vi.fn(() => new Promise(() => undefined)),
  fetchDashboardSystem: vi.fn(() => new Promise(() => undefined)),
}))

/** Every request the app made, newest last. Reset before each test. */
const requests: string[] = []

testServer.server.events.on('request:start', ({ request }) => {
  requests.push(`${request.method} ${request.url}`)
})

beforeEach(() => {
  requests.length = 0
  testServer.server.use(...adminClaimHandlers)
})

/**
 * What the claim list was last asked for.
 *
 * 지연 라우트를 빼는 것이 요점이다 — `/admin/claims/overdue` 도 같은 접두어로
 * 시작하므로, 그것을 세면 「조건을 지웠다」가 지연 목록의 요청으로 판정된다.
 */
function lastListQuery(): string {
  const entry = [...requests]
    .reverse()
    .find((line) => line.includes('/admin/claims') && !line.includes('/overdue'))

  return entry ?? ''
}

/** 지금 화면에 있는 목록 표. 필터가 바뀔 때마다 다시 그려지므로 그때마다 다시 찾는다. */
function listTable(): HTMLElement {
  return screen.getByRole('table', { name: copy.list.listLabel })
}

async function openList(session?: MockSession): Promise<HTMLElement> {
  renderWithAuth(<ClaimsPage />, session === undefined ? {} : { session })

  return screen.findByRole('table', { name: copy.list.listLabel })
}

async function switchTo(user: UserEvent, name: string): Promise<void> {
  await user.click(screen.getByRole('tab', { name: new RegExp(name) }))
}

/** One seeded row, by whatever the test needs it to be. */
function rowWhere(match: (row: AdminClaimListItem) => boolean): AdminClaimListItem {
  const row = adminClaimRowsSnapshot().find(match)

  if (row === undefined) throw new Error('the mock store holds no such claim')

  return row
}

describe('the claim queue', () => {
  it('lists every claim on the platform with its store and its buyer', async () => {
    const table = await openList()

    // 열두 건 + 머리글 한 줄. 한 페이지 한도(20) 안이라 커서가 없다.
    expect(within(table).getAllByRole('row')).toHaveLength(adminClaimRowsSnapshot().length + 1)
    expect(within(table).getAllByRole('rowheader')).toHaveLength(adminClaimRowsSnapshot().length)
  })

  it('announces that it is loading before anything arrives', () => {
    renderWithAuth(<ClaimsPage />)

    expect(screen.getByText(copy.list.loadingLabel)).toBeInTheDocument()
  })

  it('shows the failure and a way to retry when the API cannot be reached', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.adminClaims))
    renderWithAuth(<ClaimsPage />)

    expect(await screen.findByText(copy.list.errorTitle)).toBeVisible()
    expect(screen.getAllByRole('button', { name: copy.list.retryLabel }).length).toBeGreaterThan(0)
  })

  it('recovers when the retry succeeds', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('get', mockPaths.adminClaims))
    renderWithAuth(<ClaimsPage />)
    await screen.findByText(copy.list.errorTitle)

    testServer.server.resetHandlers()
    testServer.server.use(...adminClaimHandlers)
    await user.click(screen.getAllByRole('button', { name: copy.list.retryLabel })[0]!)

    expect(await screen.findByRole('table', { name: copy.list.listLabel })).toBeVisible()
  })

  it('marks an overdue row with a sentence, not only a colour', async () => {
    const table = await openList()
    const overdue = rowWhere((row) => row.overdue)
    const row = within(table).getByRole('link', { name: overdue.orderNumber }).closest('tr')

    expect(within(row as HTMLElement).getByText(copy.list.badges.overdue)).toBeVisible()
  })
})

describe('narrowing the queue', () => {
  it('asks the API for one type and redraws', async () => {
    const user = userEvent.setup()
    await openList()

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.typeLabel }))
    await user.click(await screen.findByRole('option', { name: copy.vocabulary.typeLabels.CANCEL }))

    await waitFor(() => {
      expect(lastListQuery()).toContain('type=CANCEL')
    })
    // 표 안에서만 본다. 라딕스의 셀렉트는 폼 안에서 숨은 native `<select>` 를 함께
    // 그리므로, 문서 전체에서 찾으면 그 옵션들이 목록의 줄로 오인된다.
    await waitFor(() => {
      expect(
        within(listTable()).queryByText(copy.vocabulary.statusLabels.RETURN_REJECTED),
      ).not.toBeInTheDocument()
    })
  })

  it('asks for pending appeals only when the switch is on', async () => {
    const user = userEvent.setup()
    await openList()

    await user.click(screen.getByRole('switch', { name: copy.list.filters.appealedLabel }))

    await waitFor(() => {
      expect(lastListQuery()).toContain('appealed=true')
    })
    await waitFor(() => {
      expect(within(listTable()).getAllByRole('rowheader')).toHaveLength(
        adminClaimRowsSnapshot().filter((row) => row.appealPending).length,
      )
    })
  })

  /**
   * 판매자·구매자는 계약에서 식별자다. 이 콘솔에는 둘을 빠짐없이 답하는 엔드포인트가
   * 없으므로 **행에서** 고른다 — 첫 페이지만 담은 셀렉트는 거기 없는 가게를 조용히 못
   * 고르게 만든다.
   */
  it('narrows to one store from its row and says which store that is', async () => {
    const user = userEvent.setup()
    await openList()
    const target = rowWhere(() => true)

    await user.click(
      screen.getAllByRole('button', {
        name: copy.list.narrow.seller.replace('{name}', target.brandName),
      })[0]!,
    )

    await waitFor(() => {
      expect(lastListQuery()).toContain(`sellerId=${target.sellerId}`)
    })
    expect(
      screen.getByText(copy.list.narrow.activeSeller.replace('{name}', target.brandName)),
    ).toBeVisible()
  })

  it('drops the store filter again when the chip is cleared', async () => {
    const user = userEvent.setup()
    await openList()
    const target = rowWhere(() => true)

    await user.click(
      screen.getAllByRole('button', {
        name: copy.list.narrow.seller.replace('{name}', target.brandName),
      })[0]!,
    )
    await screen.findByText(copy.list.narrow.activeSeller.replace('{name}', target.brandName))
    await user.click(screen.getByRole('button', { name: copy.list.narrow.clear }))

    await waitFor(() => {
      expect(lastListQuery()).not.toContain('sellerId=')
    })
  })

  /**
   * 계약이 받는 것은 순간이고 사람이 고르는 것은 날짜다. 그 사이를 화면이 한국 시간의
   * 하루로 메우고, 그 사실은 필터 아래 한 줄이 말한다.
   */
  it('turns a chosen day into the instants the API takes', async () => {
    const user = userEvent.setup()
    await openList()

    await user.type(screen.getByLabelText(copy.list.filters.fromLabel), '2026-09-05')

    await waitFor(() => {
      expect(lastListQuery()).toContain(encodeURIComponent('2026-09-04T15:00:00.000Z'))
    })
    expect(screen.getByText(copy.list.filters.periodHint)).toBeVisible()
  })

  it('says an empty queue is empty *because of the filter*', async () => {
    const user = userEvent.setup()
    await openList()

    // 대역이 말하는 「지금」보다 뒤의 날짜. 조건이 없었다면 열두 건이 있는 자리다.
    await user.type(screen.getByLabelText(copy.list.filters.fromLabel), '2026-09-09')

    expect(await screen.findByText(copy.list.filteredEmptyTitle)).toBeVisible()
  })
})

describe('what needs a hand right now', () => {
  it('lists the overdue claims from their own route', async () => {
    const user = userEvent.setup()
    await openList()
    await switchTo(user, copy.list.tabs.overdue)

    const table = await screen.findByRole('table', { name: copy.overdue.listLabel })
    const overdue = adminClaimRowsSnapshot().filter((row) => row.overdue)

    expect(within(table).getAllByRole('rowheader')).toHaveLength(overdue.length)
    expect(requests.some((line) => line.includes('/admin/claims/overdue'))).toBe(true)
  })

  it('shows the two kinds of stuck refund, with what was tried', async () => {
    const user = userEvent.setup()
    await openList()
    await switchTo(user, copy.list.tabs.failedRefunds)

    const table = await screen.findByRole('table', { name: copy.failedRefunds.listLabel })

    expect(within(table).getAllByRole('rowheader')).toHaveLength(2)
    expect(within(table).getByText('이미 전액 환불된 결제입니다.')).toBeVisible()
  })

  it('counts them on the tab so the queue is not the only way to notice', async () => {
    await openList()

    const overdue = adminClaimRowsSnapshot().filter((row) => row.overdue).length

    expect(
      await screen.findByRole('tab', {
        name: copy.list.tabs.countLabel
          .replace('{name}', copy.list.tabs.overdue)
          .replace('{count}', String(overdue)),
      }),
    ).toBeVisible()
  })

  /** F7 — 대시보드에 노출된다. 숫자만이 아니라 무엇이 밀렸는지까지. */
  it('puts both lists on the dashboard, with the counts', async () => {
    renderWithAuth(<HomePage />)

    const panel = await screen.findByRole('region', { name: copy.attention.title })
    const overdue = adminClaimRowsSnapshot().filter((row) => row.overdue).length

    expect(
      await within(panel).findByText(
        copy.attention.overdueCount.replace('{count}', String(overdue)),
      ),
    ).toBeVisible()
    expect(
      within(panel).getByText(copy.attention.failedCount.replace('{count}', '2')),
    ).toBeVisible()
    expect(within(panel).getByRole('table', { name: copy.overdue.listLabel })).toBeVisible()
    expect(within(panel).getByRole('link', { name: copy.attention.link })).toBeVisible()
  })
})

describe('what a demo administrator is told', () => {
  /**
   * F5 — 데모 관리자는 **조회는 전부, 처리는 데모가 만든 것만**. 어느 줄이 데모의
   * 것인지는 응답에 없으므로(소유자 표시가 없다), 화면은 줄을 잠그는 대신 계정에 대해
   * 참인 문장을 세워 둔다.
   */
  it('says what its writes reach, and leaves every row readable', async () => {
    const table = await openList(sessionDemoAdmin)

    expect(screen.getByText(copy.scope.demoNotice)).toBeVisible()
    // 실계정 건도 그대로 보인다 — 조회는 좁혀지지 않는다.
    expect(within(table).getAllByRole('rowheader')).toHaveLength(adminClaimRowsSnapshot().length)
  })

  it('says nothing about scope to a full administrator', async () => {
    await openList()

    expect(screen.queryByText(copy.scope.demoNotice)).not.toBeInTheDocument()
  })

  /**
   * 이 화면이 요구하는 것은 `claim.read` 를 **`any` 로** 가졌는가다 — 판매자와 구매자도
   * 자기 클레임에 대해 그 퍼미션을 갖고 있고, 그것으로 열면 플랫폼 전체 목록의 403 이
   * 「불러오지 못했어요 · 다시 시도」로 도착한다. 아무리 눌러도 되지 않는 재시도다.
   */
  it('refuses an account that only holds claims of its own, instead of offering a dead retry', async () => {
    renderWithAuth(<ClaimsPage />, { session: sessionSellerOwner })

    expect(await screen.findByText(copy.forbiddenTitle)).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.list.retryLabel })).not.toBeInTheDocument()
    expect(requests.some((line) => line.includes('/admin/claims'))).toBe(false)
  })
})

describe('at the three verification viewports', () => {
  /**
   * jsdom paints nothing, so "레이아웃이 깨지지 않는다" cannot be measured here — what
   * can be is the structure the console's mobile rule rests on
   * (`docs/design/pages.md` — 관리자 표는 옆으로 구르고 첫 열이 고정된다). The row
   * header and the named, keyboard-reachable scroll region are that structure, and
   * they have to be there at every width because this screen has no
   * width-dependent branch at all.
   */
  it.each(Object.entries(VIEWPORTS))('%s (%ipx)', async (_name, width) => {
    stubViewport(width)
    await openList()

    const region = screen.getByRole('region', { name: copy.list.listLabel })

    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getAllByRole('rowheader')).toHaveLength(adminClaimRowsSnapshot().length)
  })

  /**
   * D-033 — 콘솔은 밀도 2 고정이고 토글이 **어디에도** 없다. 셸에 대해서는
   * `console-shell.spec.tsx` 가 같은 것을 재고, 여기서 다시 재는 것은 새 화면이 자기
   * 밀도 컨트롤을 들여오지 않았음을 말하기 위해서다.
   */
  it('offers no display-density control of its own', async () => {
    await openList()

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(document.querySelectorAll('[data-density]')).toHaveLength(0)
  })
})
