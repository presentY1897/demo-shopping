/**
 * axe 로 훑는 판매자 쿠폰 화면, 세 뷰포트에서 (QUALITY-GATES 2장 P2 · P3 · P4).
 *
 * **게이트이자 대역이다.** 이 화면은 아직 브라우저로 열 수 없어 Lighthouse 를 돌릴 수
 * 없고, TASK-0060 이 같은 벽에서 같은 엔진을 조립된 화면에 돌렸다. 여기도 같다.
 *
 * **접근 가능한 컴포넌트를 모아 놓은 것이 접근 가능한 화면은 아니다.** 부담 경고는
 * 살아 있는 영역을 품고 있고, 상품 체크박스 묶음은 `fieldset` 안에서만 이름을 갖고,
 * 실패한 제출은 오류를 자기 칸에 단다 — 전부 여기서 조립되기 전에는 존재하지 않는다.
 *
 * ## 밀도를 바꿔 가며 한 번 더 도는 이유
 *
 * 콘솔은 D-033 으로 **밀도 2 고정**이라 토글이 없다. 그런데 밀도는 `<html data-density>`
 * 의 값이고 그 위에서 토큰(간격 · 글자 크기 · 터치 타깃)이 갈리므로, 언젠가 그 값이
 * 바뀌거나 중첩 스코프가 생기면 화면은 **아무도 재 본 적 없는 조합**으로 그려진다.
 * 재는 것은 「밀도 토글이 있다」가 아니라 **「토큰이 바뀌어도 접근성이 깨지지 않는다」**다.
 */

import {
  httpFailureOn,
  mockPaths,
  sellerCouponHandlers,
  sellerProductListItem,
  sessionSellerOwner,
} from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CouponsPage from '@/app/coupons/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const list = messagesFor().couponList
const form = messagesFor().couponForm
const vocabulary = messagesFor().coupons

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
  testServer.server.use(...sellerCouponHandlers)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-density')
})

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

async function openList(width: number): Promise<void> {
  stubViewport(width)
  renderWithAuth(<CouponsPage />)

  if (width >= VIEWPORTS.tablet) {
    await screen.findByRole('table', { name: list.table.caption })
    return
  }

  await screen.findByRole('list', { name: list.table.caption })
}

async function openForm(user: UserEvent, width: number): Promise<void> {
  await openList(width)
  await user.click(screen.getByRole('button', { name: form.openLabel }))
  await screen.findByRole('form', { name: form.legend })
}

describe('쿠폰 목록', () => {
  it('has no violations at 1440px', async () => {
    await openList(VIEWPORTS.desktop)

    await expectNoViolations()
  })

  it('has no violations at 768px', async () => {
    await openList(VIEWPORTS.tablet)

    await expectNoViolations()
  })

  it('has no violations as cards at 360px', async () => {
    await openList(VIEWPORTS.mobile)

    await expectNoViolations()
  })

  it('has no violations in the failure state', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.coupons, 403, 'FORBIDDEN', '다른 스토어의 쿠폰입니다.'),
    )
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<CouponsPage />)
    await screen.findByText(list.errorTitle)

    await expectNoViolations()
  })

  it('has no violations for an account with no store', async () => {
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<CouponsPage />, {
      session: { ...sessionSellerOwner, user: { ...sessionSellerOwner.user, sellerId: null } },
    })
    await screen.findByText(list.noStore.title)

    await expectNoViolations()
  })
})

describe('발행 폼', () => {
  it('has no violations at 1440px', async () => {
    await openForm(userEvent.setup(), VIEWPORTS.desktop)

    await expectNoViolations()
  })

  it('has no violations at 360px', async () => {
    await openForm(userEvent.setup(), VIEWPORTS.mobile)

    await expectNoViolations()
  })

  it('has no violations with the product picker open', async () => {
    const user = userEvent.setup()

    await openForm(user, VIEWPORTS.desktop)
    await user.click(screen.getByRole('combobox', { name: form.fields.scopeTypeLabel }))
    await user.click(
      await screen.findByRole('option', { name: vocabulary.scopeTypeLabels.PRODUCT }),
    )
    await screen.findByRole('checkbox', { name: sellerProductListItem(0).name })

    await expectNoViolations()
  })

  it('has no violations when a submit was refused', async () => {
    const user = userEvent.setup()

    await openForm(user, VIEWPORTS.mobile)
    await user.click(screen.getByRole('button', { name: form.submitLabel }))
    await screen.findByText(form.errors.nameRequired)

    await expectNoViolations()
  })
})

/**
 * 같은 두 화면을, 밀도 토큰만 바꿔 가며 한 번씩 더.
 *
 * `DENSITY_LEVELS` 를 그대로 도는 것은 단계가 늘면 이 검사도 함께 늘어야 하기
 * 때문이다 — 셋을 손으로 적으면 넷째 단계는 아무도 재지 않는다.
 */
describe('밀도 토큰이 바뀌어도 (D-033)', () => {
  for (const density of DENSITY_LEVELS) {
    it(`keeps the list accessible at 360px with data-density=${String(density)}`, async () => {
      document.documentElement.setAttribute('data-density', String(density))
      await openList(VIEWPORTS.mobile)

      await expectNoViolations()
    })

    it(`keeps the form accessible at 360px with data-density=${String(density)}`, async () => {
      document.documentElement.setAttribute('data-density', String(density))
      await openForm(userEvent.setup(), VIEWPORTS.mobile)

      await expectNoViolations()
    })
  }
})
