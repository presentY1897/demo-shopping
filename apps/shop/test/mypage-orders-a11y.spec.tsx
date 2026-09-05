/**
 * axe over `/mypage/orders` 와 `/mypage/orders/[id]`, 밀도 3단계 × 좁은 뷰포트 (P2 · P6).
 *
 * 이 두 화면이 다른 계정 화면에 없는 것을 들고 온다.
 *
 * - **같은 이름의 버튼이 묶음 수만큼 있다.** 구매확정 · 재구매 · 배송조회가 판매자
 *   셋에 하나씩이고, 구별되는 것은 접근성 이름에 붙은 브랜드뿐이다. 그 장치가
 *   빠지면 버튼 목록을 훑는 사람에게 「재구매」가 셋 남는다.
 * - **접었다 펴는 영역이 묶음마다 있다.** `aria-expanded` 와 `aria-controls` 가
 *   짝이 맞아야 하고, 닫혀 있을 때 없는 id 를 가리키면 `aria-valid-attr-value` 다.
 * - **목록이 목록 안에 있다.** 묶음 목록 → 항목 목록 → 상태 사다리 → 배송 이력까지
 *   `ol`/`ul` 이 네 겹이고, 제목 단계가 `h1 → h2 → h3` 로 이어지는지가 여기서만
 *   확인된다.
 * - **밀도가 실제로 갈린다.** 배송 추적과 상태 사다리가 단계별로 다른 것을 보여
 *   주므로, 세 단계 각각에서 이름 없는 컨트롤이 생기지 않는지 확인할 자리가 있다.
 *
 * 규칙 집합은 이 앱의 다른 a11y 검사들의 것을 다시 적는다 — `packages/ui` 의 사본은
 * `stories/` 까지 닿지 않는 `exports` 맵 뒤에 있다.
 */

import { MOCK_ORDER_IDS, MOCK_ORDER_NOW, resetOrderStore, sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OrdersPage from '@/app/mypage/orders/page'
import { OrderDetailScreen } from '@/components/mypage/order-detail-screen'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/orders' }))

const messages = messagesFor()
const list = messages.mypage.orders
const detail = messages.mypage.orderDetail

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title, the `main` landmark — belongs to
    // `app/layout.tsx`, which is not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

function atDensity(level: number): void {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
  document.documentElement.setAttribute('data-density', String(level))
}

async function openList(): Promise<UserEvent> {
  const user = userEvent.setup()

  renderAccountScreen(<OrdersPage />, { session: sessionBuyer })
  await screen.findByRole('list', { name: list.listLabel })

  return user
}

async function openDetail(): Promise<UserEvent> {
  const user = userEvent.setup()

  renderAccountScreen(<OrderDetailScreen id={MOCK_ORDER_IDS.mixed} messages={messages.mypage} />, {
    session: sessionBuyer,
  })
  await screen.findByRole('list', { name: detail.bundlesLabel })

  return user
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
  resetOrderStore()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(MOCK_ORDER_NOW))
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  vi.unstubAllGlobals()
  resetOrderStore()
})

describe('주문 목록', () => {
  it.each(DENSITY_LEVELS)('밀도 %s 에서 위반이 없다', async (level) => {
    atDensity(level)

    await openList()

    await expectNoViolations()
  })

  it('좁은 뷰포트에서도 위반이 없다', async () => {
    stubViewport(VIEWPORTS.mobile)

    await openList()

    await expectNoViolations()
  })

  it('필터가 걸려 목록이 비었을 때도 위반이 없다', async () => {
    const user = await openList()

    await user.click(screen.getByRole('combobox', { name: list.statusLabel }))
    await user.click(screen.getByRole('option', { name: list.statusFilters.pending }))
    await screen.findByText(list.filteredEmptyTitle)

    await expectNoViolations()
  })

  it('두 셀렉트가 이름을 갖는다', async () => {
    await openList()

    // `fieldset`/`legend` 가 둘을 묶고, 각각은 자기 `label` 로 이름을 갖는다.
    // 이름 없는 콤보박스는 「무엇을 고르는 건지」가 화면의 배치로만 전달된다.
    expect(screen.getByRole('combobox', { name: list.periodLabel })).toBeVisible()
    expect(screen.getByRole('combobox', { name: list.statusLabel })).toBeVisible()
  })
})

describe('주문 상세', () => {
  it.each(DENSITY_LEVELS)('밀도 %s 에서 위반이 없다', async (level) => {
    atDensity(level)

    await openDetail()

    await expectNoViolations()
  })

  it('좁은 뷰포트에서도 위반이 없다', async () => {
    stubViewport(VIEWPORTS.mobile)

    await openDetail()

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('밀도 %s 에서 배송 추적을 펼쳐도 위반이 없다', async (level) => {
    atDensity(level)

    const user = await openDetail()

    await user.click(
      screen.getByRole('button', { name: detail.tracking.open.replace('{brand}', '루미에르') }),
    )
    await screen.findByRole('list', { name: detail.tracking.timelineLabel })

    await expectNoViolations()
  })

  it('구매확정 확인창이 열려 있을 때도 위반이 없다', async () => {
    const user = await openDetail()

    await user.click(
      await screen.findByRole('button', { name: `${detail.confirm.action} 루미에르` }),
    )
    await screen.findByRole('dialog', { name: detail.confirm.title })

    await expectNoViolations()
  })

  it('제목 단계가 h1 → h2 → h3 로 이어진다', async () => {
    await openDetail()

    expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: detail.bundlesLabel })).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3)
  })

  it('묶음마다 있는 같은 버튼들이 서로 다른 이름을 갖는다 (P4)', async () => {
    await openDetail()

    const buttons = screen.getAllByRole('button')
    const visible = buttons.map((button) => button.textContent)
    const accessible = buttons.map(
      (button) => button.getAttribute('aria-label') ?? button.textContent,
    )

    // 눈에 보이는 글자는 겹친다 — 「재구매」가 셋이다. 그것이 문제가 아니라,
    // 접근성 이름까지 겹치는 것이 문제다.
    expect(new Set(visible).size).toBeLessThan(visible.length)
    expect(new Set(accessible).size).toBe(accessible.length)
  })

  it('보이는 글자가 접근성 이름의 앞에 온다 (WCAG 2.5.3)', async () => {
    await openDetail()

    const repurchase = screen.getByRole('button', {
      name: `${detail.repurchase.action} 루미에르`,
    })

    // 음성 제어가 「재구매」라고 말했을 때 이 버튼이 눌려야 한다.
    expect(repurchase).toHaveTextContent(detail.repurchase.action)
    expect(repurchase.getAttribute('aria-label')?.startsWith(detail.repurchase.action)).toBe(true)
  })

  it('묶음 목록 안의 항목 목록이 자기 이름을 갖는다', async () => {
    await openDetail()

    // 목록이 네 겹이라, 이름이 없으면 훑는 사람에게 「목록, 3개 항목」이 반복된다.
    const bundles = screen.getByRole('list', { name: detail.bundlesLabel })

    expect(
      within(bundles).getByRole('list', { name: `루미에르 ${detail.itemsLabel}` }),
    ).toBeVisible()
  })
})
