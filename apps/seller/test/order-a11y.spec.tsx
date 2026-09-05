/**
 * axe over 주문 목록 · 주문 상세, 세 뷰포트에서 (QUALITY-GATES 2장 P2 · P3 · P4).
 *
 * **게이트이자 대역이다.** 이 화면들은 아직 브라우저로 열 수 없어 Lighthouse 를 돌릴
 * 수 없고, TASK-0109 · 0110 · 0114 · 0116 이 전부 같은 벽에서 같은 엔진을 조립된
 * 화면에 돌렸다. 여기도 같다.
 *
 * **접근 가능한 컴포넌트를 모아 놓은 것이 접근 가능한 화면은 아니다.** 줄마다의
 * 체크박스에는 보이는 라벨이 없고, 일괄 막대는 필터 아래에서 나타났다 사라지며, 액션
 * 버튼 중 하나는 `aria-disabled` 에 사유를 달고 있다 — 전부 여기서 조립되기 전에는
 * 존재하지 않는다.
 *
 * 그리고 **360px 에서는 표가 아니라 카드가 마운트된다** (F9). 두 모양이 같은 열
 * 정의를 쓰므로 어느 쪽도 검사에서 빠지면 안 된다.
 */

import { sellerOrderHandlers, sellerOrderPage } from '@shopping/api-mocks'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OrdersPage from '@/app/orders/page'
import { OrderDetailWorkspace } from '@/components/orders/order-detail-workspace'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const list = messagesFor().orderList
const detail = messagesFor().orderDetail

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom 은 아무것도 칠하지 않으므로 axe 가 대비를 판단할 수 없다.
    'color-contrast': { enabled: false },
    // 문서의 껍데기 — lang · title — 는 `app/layout.tsx` 의 것이다.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    // 콘솔의 `<main>` 은 셸의 것이고 셸은 이 트리에 없다.
    region: { enabled: false },
  },
}

beforeEach(() => {
  testServer.server.use(...sellerOrderHandlers)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

function preparingId(): string {
  const row = sellerOrderPage.sellerOrders.find((entry) => entry.status === 'PREPARING')

  if (row === undefined) throw new Error('상품준비중인 픽스처가 없습니다.')

  return row.id
}

describe('주문 목록', () => {
  it('has no violations at 1440px', async () => {
    stubViewport(VIEWPORTS.desktop)
    render(<OrdersPage />)
    await screen.findByRole('table', { name: list.table.caption })

    await expectNoViolations()
  })

  it('has no violations at 768px', async () => {
    stubViewport(VIEWPORTS.tablet)
    render(<OrdersPage />)
    await screen.findByRole('table', { name: list.table.caption })

    await expectNoViolations()
  })

  it('has no violations as cards at 360px (F9)', async () => {
    stubViewport(VIEWPORTS.mobile)
    render(<OrdersPage />)
    await screen.findByRole('list', { name: list.table.caption })

    await expectNoViolations()
  })

  it('has no violations while the selection bar is open', async () => {
    stubViewport(VIEWPORTS.desktop)
    render(<OrdersPage />)
    await screen.findByRole('table', { name: list.table.caption })

    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: list.table.selectAll }))
    await screen.findByText(list.bulk.selected.replace('{count}', '20'))

    await expectNoViolations()
  })

  it('has no violations in the empty state', async () => {
    stubViewport(VIEWPORTS.desktop)
    render(<OrdersPage />)
    await screen.findByRole('table', { name: list.table.caption })

    const user = userEvent.setup()

    await user.type(screen.getByLabelText(list.filters.searchLabel), '없는주문번호')
    await screen.findByText(list.filteredEmpty.title)

    await expectNoViolations()
  })
})

describe('주문 상세', () => {
  it('has no violations at 1440px', async () => {
    stubViewport(VIEWPORTS.desktop)
    render(<OrderDetailWorkspace sellerOrderId={preparingId()} />)
    await screen.findByRole('table', { name: detail.items.caption })

    await expectNoViolations()
  })

  it('has no violations at 360px (F10)', async () => {
    stubViewport(VIEWPORTS.mobile)
    render(<OrderDetailWorkspace sellerOrderId={preparingId()} />)
    await screen.findByRole('table', { name: detail.items.caption })

    await expectNoViolations()
  })

  it('has no violations with the shipping dialog open — the phone path (F10)', async () => {
    stubViewport(VIEWPORTS.mobile)
    render(<OrderDetailWorkspace sellerOrderId={preparingId()} />)
    await screen.findByRole('table', { name: detail.items.caption })

    const user = userEvent.setup()

    await user.click(
      screen.getByRole('button', { name: messagesFor().orders.actionLabels.SHIPPED }),
    )
    await screen.findByRole('dialog')

    await expectNoViolations()
  })
})
