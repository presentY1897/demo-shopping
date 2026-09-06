/**
 * axe 로 훑는 매출·정산 화면, 세 뷰포트에서 (QUALITY-GATES 2장 P2 · P3 · P4).
 *
 * **게이트이자 대역이다.** 이 화면들은 아직 브라우저로 열 수 없어 Lighthouse 를 돌릴
 * 수 없고, TASK-0074 가 같은 벽에서 같은 엔진을 조립된 화면에 돌렸다. 여기도 같다.
 *
 * **접근 가능한 컴포넌트를 모아 놓은 것이 접근 가능한 화면은 아니다.** 매출 차트가
 * 특히 그렇다 — `<svg>` 는 접근성 트리에서 빠지고 그 대신 표가 서는데, 그 둘의 관계는
 * 여기서 조립되기 전에는 존재하지 않는다 (F5).
 *
 * ## 밀도를 바꿔 가며 한 번 더 도는 이유
 *
 * 콘솔은 D-033 으로 **밀도 2 고정**이라 토글이 없다. 그런데 밀도는 `<html data-density>`
 * 의 값이고 그 위에서 토큰이 갈리므로, 언젠가 그 값이 바뀌면 화면은 **아무도 재 본 적
 * 없는 조합**으로 그려진다.
 */

import { DENSITY_LEVELS } from '@shopping/ui'
import { screen } from '@testing-library/react'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettlementsPage from '@/app/settlements/page'
import { RevenueDashboard } from '@/components/revenue/revenue-dashboard'
import { SettlementDetailWorkspace } from '@/components/settlements/settlement-detail-workspace'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import { answerJson, resetApiStub, stubApiClient } from './support/api-stub'
import {
  PAID_SETTLEMENT_ID,
  sellerRevenue,
  settlementDetail,
  settlementListPage1,
  settlementOutlook,
} from './support/settlement-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const revenue = messagesFor().revenue

const list = messagesFor().settlementList

const detail = messagesFor().settlementDetail

const NOW = new Date('2026-09-06T03:00:00.000Z')

const OPTIONS: RunOptions = {
  rules: {
    // jsdom 은 아무것도 칠하지 않으므로 axe 가 대비를 판단할 수 없다.
    'color-contrast': { enabled: false },
    // 문서의 껍데기 — lang · title — 는 `app/layout.tsx` 의 것이다.
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    // 콘솔의 `<main>` 은 셸의 것이고 셸은 이 트리에 없다.
    region: { enabled: false },
  },
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
}

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  answerJson('/seller-revenue', sellerRevenue)
  answerJson('/seller-settlement-outlook', settlementOutlook)
  answerJson('/settlements', settlementListPage1)
  answerJson(`/settlements/${PAID_SETTLEMENT_ID}`, settlementDetail)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-density')
})

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

describe('the revenue dashboard', () => {
  it.each(Object.entries(VIEWPORTS))('has no axe violations at %s', async (_name, width) => {
    stubViewport(width)
    renderWithAuth(<RevenueDashboard now={NOW} />)
    await screen.findByRole('table', { name: revenue.chart.tableCaption })

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has no axe violations at density %s', async (level) => {
    document.documentElement.setAttribute('data-density', String(level))
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<RevenueDashboard now={NOW} />)
    await screen.findByRole('table', { name: revenue.chart.tableCaption })

    await expectNoViolations()
  })

  it('leaves the chart out of the accessibility tree and the table in it (F5)', async () => {
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<RevenueDashboard now={NOW} />)

    const table = await screen.findByRole('table', { name: revenue.chart.tableCaption })

    // 표는 접혀 있어도 트리에 있다. `hidden` 으로 감췄다면 이 조회가 실패한다.
    expect(table).toBeInTheDocument()
    expect(document.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('the settlement list', () => {
  it.each(Object.entries(VIEWPORTS))('has no axe violations at %s', async (_name, width) => {
    stubViewport(width)
    renderWithAuth(<SettlementsPage />)
    await screen.findByText(list.outlook.awaitingConfirmationLabel)

    await expectNoViolations()
  })
})

describe('the settlement detail', () => {
  it.each(Object.entries(VIEWPORTS))('has no axe violations at %s', async (_name, width) => {
    stubViewport(width)
    renderWithAuth(<SettlementDetailWorkspace settlementId={PAID_SETTLEMENT_ID} />)
    await screen.findByRole('table', { name: detail.calculation.caption })

    await expectNoViolations()
  })
})
