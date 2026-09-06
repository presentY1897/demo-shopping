/**
 * axe over 쿠폰함 · 적립금 · 마이페이지 요약, in every state they can be in (P2).
 *
 * `mypage-a11y.spec.tsx` 와 `mypage-cards-a11y.spec.tsx` 가 다른 계정 화면들을 이미
 * 덮는다. 이 셋이 가져오는 것은 그 화면들에 없던 세 가지이고, 하나하나가 실제로 틀리기
 * 쉬운 자리다.
 *
 * - **탭 셋**이다. 탭과 패널이 `aria-controls`/`aria-labelledby` 로 짝지어져야 하고,
 *   탭의 접근성 이름에 배지의 수가 섞여 들어가는 자리이기도 하다.
 * - **표가 화면의 본문**이다. 카드 원장은 카드 안에서 열렸지만 여기서는 제목 단계가
 *   `h1 → h2` 로 이어지고 그 아래가 곧 표다 — 건너뛴 단계는 axe `heading-order` 가
 *   잡는 실제 결함이다.
 * - **폼과 목록이 한 화면에 있다.** 코드 등록의 오류가 칸에 붙을 때
 *   `aria-invalid` 와 `aria-describedby` 가 함께 걸려야 하고, 둘 중 하나만 있는 상태가
 *   이 검사가 잡으려는 것이다.
 *
 * 규칙 집합은 이 앱의 다른 a11y 검사들의 것을 그대로 쓴다.
 */

import {
  emptyPointLedger,
  emptyPointSummary,
  MOCK_COUPON_BOX_NOW,
  resetCouponBoxStore,
  resetPointStore,
  sessionBuyer,
} from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CouponsPage from '@/app/mypage/coupons/page'
import MyPage from '@/app/mypage/page'
import PointsPage from '@/app/mypage/points/page'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage' }))

const messages = messagesFor()
const couponCopy = messages.mypage.coupons
const pointCopy = messages.mypage.points

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

async function openCoupons(empty = false): Promise<UserEvent> {
  resetCouponBoxStore(empty ? [] : undefined)

  const user = userEvent.setup()

  renderAccountScreen(<CouponsPage />, { session: sessionBuyer })

  if (empty) await screen.findByText(couponCopy.empty.ISSUED.title)
  else await screen.findByRole('list', { name: couponCopy.listLabel })

  return user
}

async function openPoints(empty = false): Promise<void> {
  if (empty) resetPointStore(emptyPointSummary, emptyPointLedger.entries)
  else resetPointStore()

  renderAccountScreen(<PointsPage />, { session: sessionBuyer })

  if (empty) await screen.findByText(pointCopy.emptyTitle)
  else await screen.findByRole('table')
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
  vi.setSystemTime(new Date(MOCK_COUPON_BOX_NOW))
})

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('쿠폰함', () => {
  it('has no violations with the three tabs and a list', async () => {
    await openCoupons()

    await expectNoViolations()
  })

  it('has none when every tab is empty', async () => {
    await openCoupons(true)

    await expectNoViolations()
  })

  it('has none on a phone', async () => {
    stubViewport(VIEWPORTS.mobile)

    await openCoupons()

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has none at density %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    await openCoupons()

    await expectNoViolations()
  })

  it('has none once a code has been refused', async () => {
    const user = await openCoupons()

    await user.type(
      screen.getByRole('textbox', { name: new RegExp(`^${couponCopy.claim.codeLabel}`, 'u') }),
      'ZZZZZZZZZZ',
    )
    await user.click(screen.getByRole('button', { name: couponCopy.claim.submit }))
    await screen.findByText(messages.mypage.errors.COUPON_CODE_UNKNOWN)

    await expectNoViolations()
  })

  it('ties each tab to the panel it controls', async () => {
    await openCoupons()

    const selected = screen.getByRole('tab', { selected: true })
    const controls = selected.getAttribute('aria-controls') ?? ''

    // 없는 id 를 가리키면 `aria-valid-attr-value` 다.
    expect(document.getElementById(controls)).not.toBeNull()
    // 숨겨진 탭의 패널은 접근성 트리에 없어야 한다 — 셋이 동시에 읽히면 목록이 세
    // 벌인 화면이 된다.
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })
})

describe('적립금', () => {
  it('has no violations with the ledger on screen', async () => {
    await openPoints()

    await expectNoViolations()
  })

  it('has none on an account that has never earned', async () => {
    await openPoints(true)

    await expectNoViolations()
  })

  it('has none on a phone, where the five-column table scrolls inside itself', async () => {
    stubViewport(VIEWPORTS.mobile)

    await openPoints()

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has none at density %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    await openPoints()

    await expectNoViolations()
  })

  it('names the order links apart from one another (WCAG 2.4.4)', async () => {
    await openPoints()

    const names = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label') ?? link.textContent)

    expect(new Set(names).size).toBe(names.length)
  })
})

describe('마이페이지 요약', () => {
  it('has no violations once both figures have arrived', async () => {
    resetCouponBoxStore()
    resetPointStore()

    renderAccountScreen(<MyPage />, { session: sessionBuyer })
    await screen.findByRole('heading', { level: 2, name: messages.mypage.summary.title })
    await screen.findByText(messages.mypage.summary.pointsLink)

    await expectNoViolations()
  })
})
