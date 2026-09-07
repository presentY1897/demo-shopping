/**
 * `/sellers` 의 스토어 지표 탭, 운영자가 실제로 만지는 대로 (TASK-0094).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 고르거나 누른다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 한 건도 팔지 않은 스토어의 클레임률이 **0%가 아닌가**(4.5), 리뷰가 없는 스토어의
 * 평점이 0.0점으로 서지 **않는가**, 정렬이 서버에 실제로 나가는가(F2), 데모 스토어가
 * 구분되는가(F7), 제재 이력이 **몇 번 정지됐는지**에 답하는가(F6), 그리고 심사 탭이
 * 그대로 살아 있는가다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/admin/stores` 의 대역이 없고, 이 TASK 는 `apps/admin` 밖을
 * 고치지 않는다. 그래서 `lib/stores/console-api` 를 대신 세운다 — 경로와 스키마가 그 한
 * 파일에 모여 있는 것이 이것을 가능하게 하고, 답은 여전히 계약 스키마를 지난 값이다
 * (`support/stores.ts`). 심사 탭 쪽은 그 패키지의 진짜 msw 대역을 그대로 쓴다.
 */

import { sessionAdminOperator } from '@shopping/api-mocks'
import { ApiClientError } from '@shopping/shared'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import {
  statusEvent,
  statusHistory,
  storeList,
  storeMetrics,
  storeRow,
  untradedMetrics,
} from './support/stores'

const api = vi.hoisted(() => ({
  fetchStores: vi.fn(),
  fetchStoreHistory: vi.fn(),
}))

vi.mock('@/lib/stores/console-api', () => api)

const { sellers, stores: copy } = messagesFor()

/** `sellers-a11y.spec.tsx` 의 규칙표와 같은 것. 세 곳이 같은 바를 쓴다. */
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

/** 화면을 열고 **지표 탭으로 옮긴 뒤** 표가 설 때까지 기다린다. */
async function openMetrics(): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: SellersPage } = await import('@/app/sellers/page')

  renderWithAuth(<SellersPage />)

  await user.click(screen.getByRole('tab', { name: copy.tabLabel }))
  await screen.findByRole('table', { name: copy.list.listLabel })

  return user
}

/** `Select` 를 열고 보이는 글자로 하나 고른다. */
async function choose(user: UserEvent, comboboxName: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: option }))
}

function metricsTable(): HTMLElement {
  return screen.getByRole('table', { name: copy.list.listLabel })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchStores.mockResolvedValue(storeList([storeRow()]))
  api.fetchStoreHistory.mockResolvedValue(statusHistory([statusEvent()]))
})

describe('탭 (TASK-0094 4.3)', () => {
  it('opens on the review queue, so the M04 console is still the first thing', async () => {
    const { default: SellersPage } = await import('@/app/sellers/page')

    renderWithAuth(<SellersPage />)

    expect(await screen.findByRole('table', { name: sellers.listLabel })).toBeVisible()
    // 지표 탭은 아직 마운트되지 않았다 — 집계 질의가 심사 큐를 보러 온 사람을
    // 기다리게 하지 않는다.
    expect(api.fetchStores).not.toHaveBeenCalled()
  })

  it('reads the store metrics only once the tab is opened', async () => {
    await openMetrics()

    expect(api.fetchStores).toHaveBeenCalledTimes(1)
  })
})

describe('지표 (F1)', () => {
  it('shows sales, the claim rate and the rating for a store that has traded', async () => {
    api.fetchStores.mockResolvedValue(
      storeList([storeRow({ brandName: '루미에르', metrics: storeMetrics({ claimRateBp: 350 }) })]),
    )

    await openMetrics()

    const table = metricsTable()

    // 이름은 줄 머리(`<th scope="row">`)에 있다. 같은 글자가 이력 버튼의 낭독용
    // 이름에도 들어가므로, 표에서 찾을 때는 그 자리를 짚는다.
    expect(within(table).getByRole('rowheader', { name: '루미에르' })).toBeVisible()
    expect(within(table).getByText(/1,890,000/)).toBeVisible()
    expect(within(table).getByText(/3\.5/)).toBeVisible()
    expect(within(table).getByText(/4\.2/)).toBeVisible()
  })

  /**
   * **이 화면의 판단 하나가 통째로 여기 걸려 있다** (4.5). 0%로 그리면 아직 아무것도
   * 안 판 스토어가 「클레임 한 건도 없는 좋은 스토어」로 목록의 맨 위에 앉는다.
   */
  it('says 판매 없음 — never 0% — for a store that has never sold', async () => {
    api.fetchStores.mockResolvedValue(
      storeList([storeRow({ brandName: '신생스토어', metrics: untradedMetrics })]),
    )

    await openMetrics()

    const table = metricsTable()

    expect(within(table).getByText(copy.list.noSales)).toBeVisible()
    expect(within(table).queryByText('0.0%')).not.toBeInTheDocument()
    expect(within(table).queryByText('0%')).not.toBeInTheDocument()
  })

  /** 리뷰가 없는 스토어의 `ratingAvg` 는 0으로 온다. 그 0은 **최악의 스토어**로 읽힌다. */
  it('says 평가 없음 rather than 0.0 for a store nobody has reviewed', async () => {
    api.fetchStores.mockResolvedValue(storeList([storeRow({ metrics: untradedMetrics })]))

    await openMetrics()

    expect(within(metricsTable()).getByText(copy.list.noRatings)).toBeVisible()
  })

  it('explains, above the table, that an empty claim rate is not a zero', async () => {
    await openMetrics()

    expect(screen.getByText(copy.list.metricNotice)).toBeVisible()
  })

  /** 계정이 어떻게 만들어졌는가와 지금 영업할 수 있는가는 다른 축이다 (F7). */
  it('marks a demo store without touching its status', async () => {
    api.fetchStores.mockResolvedValue(
      storeList([storeRow({ isDemo: true, status: 'ACTIVE', brandName: '체험스토어' })]),
    )

    await openMetrics()

    const table = metricsTable()

    expect(within(table).getByText(copy.list.demoBadge)).toBeVisible()
    expect(within(table).getByText(sellers.statusLabels.ACTIVE)).toBeVisible()
  })
})

describe('필터와 정렬 (F2)', () => {
  it('asks the API for the claim-rate order and goes back to the first page', async () => {
    const user = await openMetrics()

    await choose(user, copy.list.filters.sortLabel, copy.list.filters.sortNames.claimRate)

    expect(api.fetchStores).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'claimRate' }),
      expect.anything(),
    )
    expect(api.fetchStores.mock.lastCall?.[0]).not.toHaveProperty('cursor')
  })

  it('narrows by status, and says the emptiness is the filter’s', async () => {
    const user = await openMetrics()

    api.fetchStores.mockResolvedValue(storeList([]))
    await choose(user, copy.list.filters.statusLabel, sellers.statusLabels.SUSPENDED)

    expect(api.fetchStores).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'SUSPENDED' }),
      expect.anything(),
    )
    expect(await screen.findByText(copy.list.filteredEmptyTitle)).toBeVisible()
  })

  it('separates demo stores from real ones', async () => {
    const user = await openMetrics()

    await choose(user, copy.list.filters.demoLabel, copy.list.filters.demoOnly)

    expect(api.fetchStores).toHaveBeenLastCalledWith(
      expect.objectContaining({ isDemo: true }),
      expect.anything(),
    )
  })
})

describe('제재 이력 (F6)', () => {
  /**
   * 이 표가 답하는 질문은 하나다 — 몇 번 정지됐나. 줄을 세어 보게 하는 것이 아니라
   * 그 수를 먼저 말한다 (4.6).
   */
  it('answers "how many times was this store suspended" before the rows', async () => {
    api.fetchStoreHistory.mockResolvedValue(
      statusHistory([
        statusEvent({ fromStatus: 'SUSPENDED', toStatus: 'ACTIVE', reason: null }),
        statusEvent({ fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' }),
        statusEvent({ fromStatus: 'SUSPENDED', toStatus: 'ACTIVE', reason: null }),
        statusEvent({ fromStatus: 'ACTIVE', toStatus: 'SUSPENDED' }),
        statusEvent({ fromStatus: null, toStatus: 'PENDING', reason: null, actorId: null }),
      ]),
    )

    const user = await openMetrics()
    await user.click(screen.getByRole('button', { name: new RegExp(copy.list.historyLabel) }))

    const dialog = await screen.findByRole('dialog', { name: copy.history.title })

    expect(within(dialog).getByText(copy.history.summary.replace('{count}', '2'))).toBeVisible()
    expect(within(dialog).getAllByText(copy.history.kinds.sanction)).toHaveLength(2)
    expect(within(dialog).getAllByText(copy.history.kinds.lift)).toHaveLength(2)
    expect(within(dialog).getByText(copy.history.kinds.filed)).toBeVisible()
  })

  it('says a store has never been suspended rather than writing "0번"', async () => {
    api.fetchStoreHistory.mockResolvedValue(
      statusHistory([statusEvent({ fromStatus: 'PENDING', toStatus: 'ACTIVE', reason: null })]),
    )

    const user = await openMetrics()
    await user.click(screen.getByRole('button', { name: new RegExp(copy.list.historyLabel) }))

    const dialog = await screen.findByRole('dialog', { name: copy.history.title })

    expect(within(dialog).getByText(copy.history.noSanction)).toBeVisible()
  })

  /** 이력은 처리자에 외래키를 걸지 않는다 (4.6). 시스템이 옮긴 줄이 실제로 있다. */
  it('names the system when nobody signed the move, and says so when a reason is missing', async () => {
    api.fetchStoreHistory.mockResolvedValue(
      statusHistory([
        statusEvent({ fromStatus: null, toStatus: 'PENDING', reason: null, actorId: null }),
      ]),
    )

    const user = await openMetrics()
    await user.click(screen.getByRole('button', { name: new RegExp(copy.list.historyLabel) }))

    const dialog = await screen.findByRole('dialog', { name: copy.history.title })

    expect(within(dialog).getByText(copy.history.systemActor)).toBeVisible()
    expect(within(dialog).getByText(copy.history.noReason)).toBeVisible()
  })

  it('reads a store’s own history, not somebody else’s', async () => {
    const row = storeRow({ brandName: '아틀리에' })
    api.fetchStores.mockResolvedValue(storeList([row]))

    const user = await openMetrics()
    await user.click(screen.getByRole('button', { name: new RegExp(copy.list.historyLabel) }))
    await screen.findByRole('dialog', { name: copy.history.title })

    expect(api.fetchStoreHistory).toHaveBeenCalledWith(row.sellerId, expect.anything())
  })

  it('offers a retry when the history could not be read', async () => {
    api.fetchStoreHistory.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'for the log' }),
    )

    const user = await openMetrics()
    await user.click(screen.getByRole('button', { name: new RegExp(copy.list.historyLabel) }))

    const dialog = await screen.findByRole('dialog', { name: copy.history.title })

    expect(within(dialog).getByText(copy.history.errorTitle)).toBeVisible()
    expect(within(dialog).getByText(copy.failures.network)).toBeVisible()
  })
})

describe('무엇도 볼 수 없는 계정', () => {
  it('shows the failure and a way to retry when the list could not be read', async () => {
    api.fetchStores.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'for the log' }),
    )

    const user = userEvent.setup()
    const { default: SellersPage } = await import('@/app/sellers/page')

    renderWithAuth(<SellersPage />)
    await user.click(screen.getByRole('tab', { name: copy.tabLabel }))

    expect(await screen.findByText(copy.list.errorTitle)).toBeVisible()
    expect(screen.getByText(copy.failures.network)).toBeVisible()

    api.fetchStores.mockResolvedValue(storeList([storeRow()]))
    await user.click(screen.getByRole('button', { name: copy.list.retryLabel }))

    expect(await screen.findByRole('table', { name: copy.list.listLabel })).toBeVisible()
  })

  it('lets an operator read the metrics — reading is not the approval permission', async () => {
    const user = userEvent.setup()
    const { default: SellersPage } = await import('@/app/sellers/page')

    renderWithAuth(<SellersPage />, { session: sessionAdminOperator })
    await user.click(screen.getByRole('tab', { name: copy.tabLabel }))

    expect(await screen.findByRole('table', { name: copy.list.listLabel })).toBeVisible()
  })
})

describe('접근성', { timeout: 20_000 }, () => {
  it('has no violations with the metrics on screen', async () => {
    await openMetrics()

    await expectNoViolations()
  })

  it('has no violations with the history open', async () => {
    const user = await openMetrics()
    await user.click(screen.getByRole('button', { name: new RegExp(copy.list.historyLabel) }))
    await screen.findByRole('dialog', { name: copy.history.title })

    await expectNoViolations()
  })
})
