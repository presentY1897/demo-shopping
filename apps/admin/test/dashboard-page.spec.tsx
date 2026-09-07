/**
 * `/`, 운영자가 실제로 만지는 대로 (TASK-0092).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 읽거나 고른다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * **처리 대기가 맨 위에 서는가**(F2), 각 줄이 그 일을 처리하는 화면으로 가는가,
 * 직전 기간이 0일 때 퍼센트를 그리지 **않는가**(F3), 멈춘 배치와 아직 안 돈 배치가
 * 다른 문장을 받는가(F4), 그림 옆의 표가 접혀도 DOM 에 남는가(F1), 한 섹션이 실패해도
 * 나머지가 그려지는가(4.1), 그리고 볼 수 없는 계정이 **문을 두드리지도 않고** 거절을
 * 읽는가(F6)다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/admin/dashboard/*` 의 대역이 없고(`mockPaths` 에 항목이
 * 없다), 이 TASK 는 `apps/admin` 밖을 고치지 않는다. 그래서
 * `lib/dashboard/console-api` 를 대신 세운다 — 경로와 스키마가 그 한 파일에 모여 있는
 * 것이 이것을 가능하게 하고, 답은 여전히 계약 스키마를 지난 값이다
 * (`support/dashboard.ts`). `reports-page.spec.tsx` 가 같은 사정을 같은 방식으로
 * 다룬다.
 */

import { adminClaimHandlers, resetAdminClaimStore, sessionBuyer } from '@shopping/api-mocks'
import type {
  DashboardMetricsResponse,
  DashboardPendingResponse,
  DashboardSystemResponse,
} from '@shopping/shared'
import { ApiClientError } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardWorkspace } from '@/components/dashboard/dashboard-workspace'
import { CHART_HEIGHT } from '@/lib/dashboard/chart'
import type { DashboardPeriod } from '@/lib/dashboard/dashboard-console'
import { dashboardCount, dashboardMoney } from '@/lib/dashboard/format'
import { messagesFor } from '@/messages'

import {
  DASHBOARD_NOW,
  DEFAULT_FROM,
  DEFAULT_TO,
  dashboardMetrics,
  dashboardPending,
  dashboardSystem,
  METRIC_DAYS,
  scheduler,
} from './support/dashboard'
import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

/**
 * 대역 셋. **타입을 붙여 둔다** — 붙이지 않으면 `mock.calls` 가 `any` 라 「어떤 기간을
 * 물었나」를 재는 자리가 전부 검사 없는 코드가 되고, 대역의 답이 계약과 어긋나도
 * typecheck 이 아무 말도 하지 않는다.
 */
interface CallOptions {
  readonly signal?: AbortSignal
}

const api = vi.hoisted(() => ({
  fetchDashboardMetrics:
    vi.fn<(period: DashboardPeriod, options?: CallOptions) => Promise<DashboardMetricsResponse>>(),
  fetchDashboardPending: vi.fn<(options?: CallOptions) => Promise<DashboardPendingResponse>>(),
  fetchDashboardSystem: vi.fn<(options?: CallOptions) => Promise<DashboardSystemResponse>>(),
}))

vi.mock('@/lib/dashboard/console-api', () => api)

const { dashboard: copy, errors: errorCopy } = messagesFor()

/**
 * The rule set, restated rather than imported — `claims-a11y.spec.tsx` 와
 * `coupons-a11y.spec.tsx` 가 같은 목록을 들고 있다.
 *
 * `page-has-heading-one` 을 끄는 것은 이 검사가 **화면 하나가 아니라 그 화면의 본체**를
 * 그리기 때문이다. `<h1>` 은 `app/page.tsx` 의 `PageHeader` 가 그리고, 그것은 이
 * 컴포넌트의 바깥이다 (`html-has-lang` 을 끄는 것과 같은 이유).
 */
const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    'page-has-heading-one': { enabled: false },
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAdminClaimStore()
  testServer.server.use(...adminClaimHandlers)
  api.fetchDashboardMetrics.mockResolvedValue(dashboardMetrics())
  api.fetchDashboardPending.mockResolvedValue(dashboardPending())
  api.fetchDashboardSystem.mockResolvedValue(dashboardSystem())
})

/** 세 섹션이 다 도착할 때까지. 시스템 상태가 가장 아래라 그것을 기다린다. */
async function openDashboard(session?: Parameters<typeof renderWithAuth>[1]): Promise<UserEvent> {
  const user = userEvent.setup()

  renderWithAuth(
    <DashboardWorkspace errors={errorCopy} messages={copy} now={DASHBOARD_NOW} />,
    session,
  )
  await screen.findByRole('table', { name: copy.system.caption })

  return user
}

function region(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

/** 서버가 답한 실패 하나. `createApiClient` 가 만드는 모양 그대로. */
function refusal(status: number, code: string): ApiClientError {
  return new ApiClientError({
    kind: 'http',
    message: 'for the log',
    status,
    body: { error: { code, message: '서버 문장', details: [], requestId: 'req-1' } },
  })
}

describe('처리 대기 (F2)', () => {
  /**
   * 4장이 한 문장으로 적어 두었다: 「대시보드의 목적은 예쁜 숫자가 아니라 *지금 뭘
   * 해야 하는가*다」. 거래액이 먼저 오면 이 화면은 아침마다 훑는 보고서가 되고, 밀린
   * 신청은 스크롤 아래에 남는다.
   */
  it('stands above the headline numbers, not below them', async () => {
    await openDashboard()

    const pending = region(copy.pending.title)
    const metrics = region(copy.metrics.title)

    expect(pending.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  /**
   * 링크는 **콘솔의 지식**이다 — 계약은 건수만 보낸다. 줄 전체가 링크인 것은, 그 숫자를
   * 본 사람이 다음에 하려는 일이 정확히 그 화면을 여는 것이기 때문이다.
   */
  it('gives every queue its count and the console screen that handles it', async () => {
    await openDashboard()

    const list = within(region(copy.pending.title)).getByRole('list', {
      name: copy.pending.listLabel,
    })
    const links = within(list).getAllByRole('link')

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/sellers',
      '/claims',
      '/reports',
      '/settlements',
    ])
    // 이름에 항목과 건수가 함께 들어 있어야, 소리로 훑는 사람도 같은 판단을 한다.
    expect(links[0]).toHaveAccessibleName(
      new RegExp(`${copy.pending.labels.sellerApplications}.*3`),
    )
  })

  /** 기간을 받지 않는 문이다. 화면이 기간을 얹으면 밀린 일이 사라진다 (4.2). */
  it('asks for the queue without a period', async () => {
    await openDashboard()

    expect(api.fetchDashboardPending).toHaveBeenCalledTimes(1)
    // 실은 것은 취소 신호뿐이다 — 기간이 실리면 밀린 일이 화면에서 사라진다.
    expect(Object.keys(api.fetchDashboardPending.mock.calls[0]?.[0] ?? {})).toEqual(['signal'])
  })

  /** 넷이 전부 0 이면 표가 아니라 한 문장이다 — 이 화면에서 가장 좋은 소식이다. */
  it('says so in one sentence when there is nothing to do', async () => {
    api.fetchDashboardPending.mockResolvedValue(
      dashboardPending({ claims: 0, reports: 0, sellerApplications: 0, settlements: 0 }),
    )
    await openDashboard()

    const pending = region(copy.pending.title)

    expect(within(pending).getByText(copy.pending.allClear)).toBeVisible()
    expect(within(pending).queryByRole('list')).toBeNull()
  })
})

describe('지표와 증감 (F1 · F3)', () => {
  it('opens on the last 30 days and sends both ends', async () => {
    await openDashboard()

    expect(api.fetchDashboardMetrics.mock.calls[0]?.[0]).toEqual({
      from: DEFAULT_FROM,
      to: DEFAULT_TO,
    })
  })

  it('shows the four headline numbers', async () => {
    await openDashboard()

    const summary = screen.getByRole('group', { name: copy.metrics.regionLabel })

    expect(within(summary).getByText(dashboardMoney(900_000))).toBeVisible()
    expect(
      within(summary).getByText(copy.metrics.orderCountValue.replace('{count}', '10')),
    ).toBeVisible()
    expect(
      within(summary).getByText(copy.metrics.newUsersValue.replace('{count}', '12')),
    ).toBeVisible()
    expect(
      within(summary).getByText(copy.metrics.activeSellersValue.replace('{count}', '4')),
    ).toBeVisible()
  })

  /**
   * 방향은 **문장**으로 말한다. 붉은 삼각형은 색을 구분하지 못하는 사람에게 아무것도
   * 아니고 흑백 인쇄에서 사라진다 (P2).
   */
  it('reads the change against the previous period as a sentence, not a colour', async () => {
    await openDashboard()

    const summary = screen.getByRole('group', { name: copy.metrics.regionLabel })

    expect(
      within(summary).getByText(new RegExp(copy.metrics.comparison.up.replace('{percent}', '50'))),
    ).toBeVisible()
    expect(within(summary).getByText(new RegExp(copy.metrics.comparison.flat))).toBeVisible()
  })

  /**
   * **0 에서 온 변화는 퍼센트가 아니다.** 0 으로 나눈 값을 그리면 `Infinity%` 가 뜨고,
   * 100% 로 반올림해 두면 「두 배로 늘었다」는 거짓말이 된다.
   */
  it('refuses a percentage when the previous period had nothing in it', async () => {
    api.fetchDashboardMetrics.mockResolvedValue(
      dashboardMetrics({
        previous: { activeSellers: 0, newUsers: 0, orderCount: 0, salesAmount: 0 },
      }),
    )
    await openDashboard()

    const summary = screen.getByRole('group', { name: copy.metrics.regionLabel })

    expect(within(summary).getAllByText(new RegExp(copy.metrics.comparison.none))).toHaveLength(4)
  })

  it('asks the server again when the period moves', async () => {
    const user = await openDashboard()

    await user.clear(screen.getByLabelText(copy.metrics.filters.fromLabel))
    await user.type(screen.getByLabelText(copy.metrics.filters.fromLabel), '2026-09-01')

    await waitFor(() => {
      expect(api.fetchDashboardMetrics.mock.lastCall?.[0]).toEqual({
        from: '2026-09-01',
        to: DEFAULT_TO,
      })
    })
  })

  /**
   * 「최근 30일로」는 **되돌릴 길**이다. 잘못 고른 기간이 화면을 멈춰 세우는 것이
   * 아니므로(막지 않고 말한다), 두 칸을 손으로 되돌리는 대신 한 번에 돌아올 수 있어야
   * 한다 — 그 기준 시각이 `now` 이고, 그것이 없으면 검사는 자정 근처에서만 깨진다.
   */
  it('walks back to the last 30 days in one press', async () => {
    const user = await openDashboard()

    await user.clear(screen.getByLabelText(copy.metrics.filters.fromLabel))
    await user.type(screen.getByLabelText(copy.metrics.filters.fromLabel), '2026-09-01')
    await user.click(screen.getByRole('button', { name: copy.metrics.filters.reset }))

    await waitFor(() => {
      expect(api.fetchDashboardMetrics.mock.lastCall?.[0]).toEqual({
        from: DEFAULT_FROM,
        to: DEFAULT_TO,
      })
    })
  })

  /**
   * 서버는 거꾸로 고른 기간을 **하루짜리로 접어** 200 으로 답한다(`rangeOf`). 그대로
   * 보내면 운영자가 보는 것은 「거래액 0원」이고, 그것은 「날짜를 거꾸로 골랐다」와
   * 전혀 다른 문장이다.
   */
  it('names a reversed period in place instead of sending it', async () => {
    const user = await openDashboard()
    const calls = api.fetchDashboardMetrics.mock.calls.length

    await user.clear(screen.getByLabelText(copy.metrics.filters.toLabel))
    await user.type(screen.getByLabelText(copy.metrics.filters.toLabel), '2026-07-01')

    expect(await screen.findByText(copy.metrics.filters.rangeReversed)).toBeVisible()
    expect(api.fetchDashboardMetrics.mock.calls).toHaveLength(calls)
  })
})

describe('거래액 추이 (F1)', () => {
  /**
   * **그림은 장식이고 표가 내용이다.** `<svg>` 에 `aria-hidden` 이 붙어 있으므로, 표가
   * 없으면 소리로 읽는 운영자에게 이 섹션은 아무 데이터도 아니다. 그래서 표는 접혀
   * 있을 때도 DOM 에 있다 — 접기는 `sr-only` 이지 조건부 렌더가 아니다.
   */
  it('keeps the table in the DOM while it is collapsed', async () => {
    const user = await openDashboard()

    const table = within(region(copy.chart.title)).getByRole('table', {
      name: copy.chart.tableCaption,
    })

    for (const day of METRIC_DAYS) {
      expect(within(table).getByText(dashboardMoney(day.salesAmount))).toBeInTheDocument()
    }

    // 버튼이 바꾸는 것은 **눈에 보이는지**뿐이다.
    const toggle = screen.getByRole('button', { name: copy.chart.showTable })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(screen.getByRole('button', { name: copy.chart.hideTable })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('draws the line the same days produced', async () => {
    await openDashboard()

    const svg = region(copy.chart.title).querySelector('svg')

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg?.getAttribute('viewBox')).toContain(String(CHART_HEIGHT))
  })

  it('says there is nothing to draw rather than drawing an empty box', async () => {
    api.fetchDashboardMetrics.mockResolvedValue(dashboardMetrics({ days: [] }))
    await openDashboard()

    const chart = region(copy.chart.title)

    expect(within(chart).getByText(copy.chart.empty)).toBeVisible()
    expect(within(chart).queryByRole('table')).toBeNull()
  })
})

describe('시스템 상태 (F4)', () => {
  /**
   * 등록 순서대로 그리면 아홉 줄이 초록인 표의 여섯째 줄에 붉은 줄이 하나 낀다. 이
   * 화면의 목적은 「지금 뭘 해야 하는가」라 사고가 먼저 온다.
   */
  it('puts a stopped scheduler at the top and says so above the table', async () => {
    api.fetchDashboardSystem.mockResolvedValue(
      dashboardSystem({
        schedulers: [
          scheduler({ key: 'order.confirm.lastRunAt' }),
          scheduler({ key: 'settlement.batch.lastRunAt', status: 'stale' }),
        ],
      }),
    )
    await openDashboard()

    const table = screen.getByRole('table', { name: copy.system.caption })
    const rows = within(table).getAllByRole('row')

    expect(
      within(rows[1]!).getByText(copy.system.names['settlement.batch.lastRunAt']),
    ).toBeVisible()
    expect(
      screen.getByText(copy.system.summary.stopped.replace('{count}', '1')),
    ).toBeInTheDocument()
  })

  /**
   * **`never` 와 `stale` 은 다른 사실이다.** 한 번도 안 돈 것은 갓 뜬 프로세스의 정상
   * 상태이고, 둘을 같은 문장으로 말하면 배포 직후마다 사고 문구가 뜬다 — 그것이 몇 번
   * 반복되면 사람은 그 문구를 안 믿는다.
   */
  it('does not call a scheduler that has never run a stopped one', async () => {
    api.fetchDashboardSystem.mockResolvedValue(
      dashboardSystem({
        schedulers: [scheduler({ lastRunAt: null, status: 'never' })],
      }),
    )
    await openDashboard()

    expect(screen.getByText(copy.system.summary.idle.replace('{count}', '1'))).toBeVisible()
    expect(screen.queryByText(copy.system.summary.stopped.replace('{count}', '1'))).toBeNull()
    // 마지막 실행 칸을 빈칸으로 두지 않는다 — 빈칸은 「못 읽었다」와 구별되지 않는다.
    expect(screen.getByText(copy.system.neverRun)).toBeVisible()
  })

  /**
   * API 와 콘솔은 따로 배포된다. 이름을 모른다고 그 줄을 숨기면 **멈춘 배치가 아무 데도
   * 안 보이게 되고**, 그것이 정확히 이 섹션이 막으려던 일이다.
   */
  it('still draws a scheduler this console has no Korean name for', async () => {
    api.fetchDashboardSystem.mockResolvedValue(
      dashboardSystem({
        schedulers: [scheduler({ key: 'search.reindex.lastRunAt', status: 'stale' })],
      }),
    )
    await openDashboard()

    expect(screen.getByText('search.reindex.lastRunAt')).toBeVisible()
    expect(screen.getByText(copy.system.unnamedNotice)).toBeVisible()
  })

  it('summarises the demo accounts beside the schedulers', async () => {
    await openDashboard()

    const demo = region(copy.system.demo.title)

    expect(
      within(demo).getByText(copy.system.demo.activeAccounts.replace('{count}', '5')),
    ).toBeVisible()
    expect(within(demo).getByRole('link', { name: copy.system.demo.link })).toHaveAttribute(
      'href',
      '/demo',
    )
  })
})

describe('색인 큐 (2장 「인덱싱 큐」)', () => {
  /**
   * **배치 표에 없다.** 저 표의 열은 「마지막으로 언제 돌았나」인데 줄 서 있는 일은
   * 방금 돌았어도 뒤처져 있을 수 있다 — 같은 표에 두면 초록 불 옆에 만 건이 밀린
   * 큐가 나란히 앉는다.
   */
  it('shows how much is waiting to be indexed', async () => {
    api.fetchDashboardSystem.mockResolvedValue(
      dashboardSystem({ searchIndex: { oldestAt: null, pending: 12 } }),
    )
    await openDashboard()

    const section = screen.getByRole('region', { name: copy.system.searchIndex.title })

    expect(within(section).getByText('대기 12건')).toBeVisible()
  })

  /** 0건은 「한가하다」이고, 그때는 오래 기다린 줄도 없다. */
  it('says nothing about the oldest row when the queue is empty', async () => {
    await openDashboard()

    const section = screen.getByRole('region', { name: copy.system.searchIndex.title })

    expect(within(section).getByText('대기 0건')).toBeVisible()
    expect(within(section).queryByText(/가장 오래/u)).toBeNull()
  })
})

describe('한 섹션이 실패해도 (4.1)', () => {
  /**
   * 문이 셋인 이유가 이것이다. 하나로 묶으면 한 번의 500 이 화면을 통째로 비우고,
   * 대시보드에서 그것은 「지표를 못 읽었다」가 아니라 「플랫폼이 죽었나」로 읽힌다.
   */
  it('draws the other two when the metrics door answers 500', async () => {
    api.fetchDashboardMetrics.mockRejectedValue(refusal(500, 'INTERNAL_ERROR'))
    await openDashboard()

    const metrics = region(copy.metrics.title)

    expect(within(metrics).getByRole('alert')).toHaveTextContent(copy.metrics.errorTitle)
    // 나머지 둘은 멀쩡하다.
    expect(within(region(copy.pending.title)).getByRole('list')).toBeVisible()
    expect(screen.getByRole('table', { name: copy.system.caption })).toBeVisible()
  })

  it('offers a retry that asks the failed door again, and only that one', async () => {
    api.fetchDashboardPending.mockRejectedValueOnce(refusal(500, 'INTERNAL_ERROR'))
    const user = await openDashboard()

    const pending = region(copy.pending.title)
    const metricsCalls = api.fetchDashboardMetrics.mock.calls.length

    await user.click(within(pending).getByRole('button', { name: copy.pending.retryLabel }))

    await waitFor(() => {
      expect(api.fetchDashboardPending).toHaveBeenCalledTimes(2)
    })
    expect(api.fetchDashboardMetrics.mock.calls).toHaveLength(metricsCalls)
  })
})

describe('권한 (F6)', () => {
  /**
   * 서버가 재는 것은 `order.read` 의 **스코프**다 — 구매자도 그 퍼미션을 갖고 있지만
   * `own` 이라 세 문 전부에서 403 을 받는다. 물어봐야 세 번 다 거절당할 계정에게
   * 오류 셋을 그리는 대신, **왜 안 되는지를 한 번** 말한다.
   */
  it('renders a refusal for a buyer and knocks on no door at all', async () => {
    renderWithAuth(<DashboardWorkspace errors={errorCopy} messages={copy} now={DASHBOARD_NOW} />, {
      session: sessionBuyer,
    })

    expect(await screen.findByText(copy.forbiddenTitle)).toBeVisible()
    expect(api.fetchDashboardMetrics).not.toHaveBeenCalled()
    expect(api.fetchDashboardPending).not.toHaveBeenCalled()
    expect(api.fetchDashboardSystem).not.toHaveBeenCalled()
  })
})

describe('접근성 (P2)', () => {
  it('has no violation once every section has arrived', async () => {
    await openDashboard()
    await expectNoViolations()
  })

  it('has none with a failed section and a stopped scheduler on screen', async () => {
    api.fetchDashboardMetrics.mockRejectedValue(refusal(500, 'INTERNAL_ERROR'))
    api.fetchDashboardSystem.mockResolvedValue(
      dashboardSystem({ schedulers: [scheduler({ status: 'stale' })] }),
    )
    await openDashboard()
    await expectNoViolations()
  })
})

describe('숫자를 그리는 방식', () => {
  /** 거래액 옆의 주문 수에 세 자리 구분이 없으면 두 수가 같은 종류로 보이지 않는다. */
  it('groups digits in counts as well as in money', () => {
    expect(dashboardCount(12_345)).toBe('12,345')
  })
})
