/**
 * axe over `/coupons`, in every state it can be in (P2).
 *
 * `packages/ui` 는 스토리마다 같은 엔진을 돌린다
 * (`packages/ui/test/story-a11y.spec.tsx`) — 그러나 **따로따로 접근 가능한 컴포넌트가
 * 접근 가능한 화면은 아니다**: 표의 행 머리, 필터의 이름, 탭의 패널, 대화상자의 초점
 * 가둠, 그리고 **버튼을 대신한 문장들**은 여기서 조립된 뒤에야 존재한다. 이 파일은 그
 * 조립에 대한 게이트이고, 이 TASK 에서는 그것이 **유일한** 성능 계열 게이트다
 * (QUALITY-GATES 2장이 남긴 것은 P2 하나다 · D-217).
 *
 * 이 화면에서 특히 문제되는 것이 둘 있다. 하나는 **끝난 쿠폰의 버튼을 대신한 문장**
 * 이다 — 회색 버튼보다 낫다는 주장의 근거가 「읽힌다」이므로, 읽히지 않으면 그 주장이
 * 무너진다. 다른 하나는 **예상 비용 패널**이다: 숫자와 목록이 이름 없는 상자에 담기면
 * 화면을 소리로 듣는 사람에게 그것은 문맥 없는 금액 두 개다.
 */

import {
  MOCK_PLATFORM_COUPON_IDS,
  mockPaths,
  networkFailureOn,
  platformCouponHandlers,
  platformCouponSnapshot,
  resetPlatformCouponStore,
  sessionDemoAdmin,
} from '@shopping/api-mocks'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it } from 'vitest'

import CouponsPage from '@/app/coupons/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { coupons: copy } = messagesFor()

/**
 * The rule set, restated rather than imported.
 *
 * `claims-a11y.spec.tsx`, `sellers-a11y.spec.tsx`, `categories-a11y.spec.tsx` 와
 * `attributes-a11y.spec.tsx` 가 같은 목록을 들고 있다. 넷을 맞춰 두는 것은 보고할
 * 가치가 있지만, 여기서만 다른 문턱을 만드는 것은 그렇지 않다.
 */
const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title — belongs to `app/layout.tsx`.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    // Dialogs and toasts render through portals, outside this page's `<main>`.
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

beforeEach(() => {
  resetPlatformCouponStore()
  testServer.server.use(...platformCouponHandlers)
})

async function openList(): Promise<void> {
  renderWithAuth(<CouponsPage />)
  await screen.findByRole('table', { name: copy.list.listLabel })
}

async function openForm(): Promise<UserEvent> {
  const user = userEvent.setup()

  await openList()
  await user.click(screen.getByRole('tab', { name: copy.tabs.issue }))
  await screen.findByRole('form', { name: copy.form.title })

  return user
}

function rowOf(couponId: string): HTMLElement {
  const entry = platformCouponSnapshot().find((coupon) => coupon.coupon.id === couponId)
  const table = screen.getByRole('table', { name: copy.list.listLabel })
  const row = within(table)
    .getByText(entry?.coupon.name ?? '')
    .closest('tr')

  if (row === null) throw new Error('그 이름을 가진 줄이 없습니다.')

  return row
}

/** 클레임 콘솔이 같은 이유로 같은 예산을 쓴다 — 이 파일의 검사는 화면 전체다. */
const A11Y_TIMEOUT = { timeout: 20_000 } as const

describe('the coupon console has no accessibility violations', A11Y_TIMEOUT, () => {
  it('while the list is loading', async () => {
    renderWithAuth(<CouponsPage />)

    await expectNoViolations()
  })

  it('when the list has arrived', async () => {
    await openList()

    await expectNoViolations()
  })

  it('when the API refused the list', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.coupons))
    renderWithAuth(<CouponsPage />)
    await screen.findByText(copy.list.errorTitle)

    await expectNoViolations()
  })

  it('with the state filter open', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(
      screen.getByRole('combobox', {
        name: (name) => name.startsWith(copy.list.filters.lifecycleLabel),
      }),
    )
    await screen.findByRole('option', { name: copy.lifecycleLabels.SUSPENDED })

    await expectNoViolations()
  })

  /** 버튼을 대신한 문장. 이것이 조용하면 문장을 고른 근거가 무너진다. */
  it('with the actions on an ended coupon replaced by a sentence', async () => {
    await openList()

    expect(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.ended)).getByText(copy.list.actions.ended),
    ).toBeVisible()

    await expectNoViolations()
  })

  it('with the demo scope notice up', async () => {
    renderWithAuth(<CouponsPage />, { session: sessionDemoAdmin })
    await screen.findByText(copy.scope.demoNotice)

    await expectNoViolations()
  })

  it('with the bulk issue dialog open', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByRole('button', {
        name: copy.list.actions.bulkIssue,
      }),
    )
    await screen.findByRole('dialog', { name: new RegExp(copy.bulk.title) })

    await expectNoViolations()
  })

  it('with the three numbers a bulk issue answered with', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.unlimited)).getByRole('button', {
        name: copy.list.actions.bulkIssue,
      }),
    )
    const dialog = await screen.findByRole('dialog', { name: new RegExp(copy.bulk.title) })
    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm }))
    await within(dialog).findByText(copy.bulk.remaining)

    await expectNoViolations()
  })

  it('on the issue form, before anything is typed', async () => {
    await openForm()

    await expectNoViolations()
  })

  /** 값이 채워진 뒤의 비용 패널 — 숫자 둘과 곱셈 한 줄에 이름이 붙는지. */
  it('with an estimated cost drawn', async () => {
    const user = await openForm()

    await user.click(
      screen.getByRole('combobox', {
        name: (name) => name.startsWith(copy.form.discountTypeLabel),
      }),
    )
    await user.click(await screen.findByRole('option', { name: copy.discountTypeLabels.FIXED }))
    await user.type(
      screen.getByLabelText(copy.form.discountValueLabels.FIXED, { exact: false }),
      '3000',
    )
    await user.type(screen.getByLabelText(copy.form.issueLimitLabel, { exact: false }), '1000')
    await within(screen.getByRole('region', { name: copy.form.cost.title })).findByText(
      '₩3,000,000',
    )

    await expectNoViolations()
  })

  /** 계산할 수 없다고 말하는 쪽. 목록이 이름 없는 상자에 담기면 문맥이 사라진다. */
  it('with the reasons a cost cannot be worked out', async () => {
    const user = await openForm()

    await user.click(
      screen.getByRole('combobox', {
        name: (name) => name.startsWith(copy.form.discountTypeLabel),
      }),
    )
    await user.click(await screen.findByRole('option', { name: copy.discountTypeLabels.PERCENT }))
    await user.type(
      screen.getByLabelText(copy.form.discountValueLabels.PERCENT, { exact: false }),
      '10',
    )
    await screen.findByText(copy.form.cost.gaps.no_ceiling)

    await expectNoViolations()
  })

  it('with what the form refused, under the fields it is about', async () => {
    const user = await openForm()

    await user.click(screen.getByRole('button', { name: copy.form.submit }))
    await screen.findByText(copy.form.errors.nameRequired)

    await expectNoViolations()
  })

  it('with the confirmation the issue goes through', async () => {
    const user = await openForm()

    await user.type(screen.getByLabelText(copy.form.nameLabel, { exact: false }), '가을 쿠폰')
    await user.click(
      screen.getByRole('combobox', {
        name: (name) => name.startsWith(copy.form.discountTypeLabel),
      }),
    )
    await user.click(await screen.findByRole('option', { name: copy.discountTypeLabels.FIXED }))
    await user.type(
      screen.getByLabelText(copy.form.discountValueLabels.FIXED, { exact: false }),
      '3000',
    )
    await user.type(screen.getByLabelText(copy.form.validFromLabel, { exact: false }), '2026-09-10')
    await user.type(
      screen.getByLabelText(copy.form.validUntilLabel, { exact: false }),
      '2026-09-20',
    )
    await user.type(screen.getByLabelText(copy.form.issueLimitLabel, { exact: false }), '1000')
    await user.click(screen.getByRole('button', { name: copy.form.submit }))
    await screen.findByRole('dialog', { name: copy.form.confirm.title })

    await expectNoViolations()
  })
})
