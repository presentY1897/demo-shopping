/**
 * `/settlements/[id]`, 관리자가 실제로 만지는 대로 (TASK-0081).
 *
 * 재는 것은 계산 근거가 TASK 4장의 다섯 줄로 서는가(F1), 항목의 줄이 그 주문으로
 * 내려가는 링크를 갖는가(F2), 승인·보류·지급이 **전이표가 허락하는 것만** 내는가
 * (F3 · F5), 사유 없는 보류가 **보내지기 전에** 막히는가(F4), 지급 확정이 금액을
 * 다시 보여 주고 확인을 받는가(R1), 그리고 자격이 없는 계정에게 세 버튼이 이유와
 * 함께 막히는가(F7)다.
 *
 * 대역이 msw 가 아니라 모듈인 사정은 `settlements-page.spec.tsx` 에 적혀 있다.
 */

import { sessionAdminOperator, sessionDemoAdmin } from '@shopping/api-mocks'
import { ApiClientError } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import { settlement, settlementDetail, settlementItem } from './support/settlements'

const api = vi.hoisted(() => ({
  fetchSettlements: vi.fn(),
  fetchSettlement: vi.fn(),
  approveSettlement: vi.fn(),
  holdSettlement: vi.fn(),
  paySettlement: vi.fn(),
  approveSettlements: vi.fn(),
}))

vi.mock('@/lib/settlements/console-api', () => api)

const { settlements: copy, auth, errors } = messagesFor()

const PENDING = settlement()

async function openScreen(session?: MockSession): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: SettlementDetailPage } = await import('@/app/settlements/[id]/page')
  const page = await SettlementDetailPage({ params: Promise.resolve({ id: PENDING.id }) })

  renderWithAuth(page, session === undefined ? {} : { session })
  await screen.findByRole('region', { name: copy.detail.sections.calculation })

  return user
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchSettlement.mockResolvedValue(settlementDetail(PENDING, [settlementItem()]))
  api.approveSettlement.mockResolvedValue({ settlement: settlement({ status: 'APPROVED' }) })
  api.holdSettlement.mockResolvedValue({ settlement: settlement({ status: 'HOLD' }) })
  api.paySettlement.mockResolvedValue({ settlement: settlement({ status: 'PAID' }) })
})

describe('계산 근거 (F1)', () => {
  /**
   * TASK-0081 4장이 그린 그대로. 수수료와 쿠폰은 계약에서 양수로 오고, 화면이 그것을
   * **한 열의 부호 있는 금액**으로 세운다 — 안 그러면 다섯 줄의 합이 마지막 줄과
   * 맞지 않는 표가 된다.
   */
  it('reads the payout down TASK-0081 4장의 다섯 줄', async () => {
    await openScreen()

    const panel = screen.getByRole('region', { name: copy.detail.sections.calculation })
    const values = within(panel)
      .getAllByRole('definition')
      .map((node) => node.textContent)

    expect(values).toEqual(['₩1,890,000', '-₩189,000', '-₩30,000', '-₩120,000', '₩1,551,000'])
  })

  /** 마지막 줄은 저장된 값이다. 화면이 더해 그리면 서버와 다른 답을 낼 수 있게 된다. */
  it('shows a negative payout rather than clamping it to zero', async () => {
    api.fetchSettlement.mockResolvedValue(
      settlementDetail(
        settlement({
          salesAmount: 0,
          commissionAmount: 0,
          sellerCouponAmount: 0,
          returnAdjustmentAmount: -120_000,
          payoutAmount: -120_000,
        }),
      ),
    )

    await openScreen()

    const panel = screen.getByRole('region', { name: copy.detail.sections.calculation })

    expect(within(panel).getAllByText('-₩120,000')).toHaveLength(2)
  })
})

describe('항목별 내역 (F2)', () => {
  it('links every line to the order it came from', async () => {
    const sale = settlementItem({ orderNumber: '20260824-001' })

    api.fetchSettlement.mockResolvedValue(settlementDetail(PENDING, [sale]))

    await openScreen()

    const link = screen.getByRole('link', {
      name: copy.detail.items.openOrder.replace('{orderNumber}', sale.orderNumber),
    })

    expect(link).toHaveAttribute(
      'href',
      `/orders?orderNumber=${sale.orderNumber}&sellerOrderId=${sale.sellerOrderId}`,
    )
  })

  /**
   * 차감 줄은 이번 회차의 판매가 아니라 지난 회차의 되돌림이고 금액이 전부 음수다.
   * 판매 줄과 같은 모양으로 그리면 표를 훑는 사람은 그것을 **작은 판매**로 읽는다.
   */
  it('makes a return adjustment read differently from a sale', async () => {
    api.fetchSettlement.mockResolvedValue(
      settlementDetail(PENDING, [
        settlementItem(),
        settlementItem({
          type: 'RETURN_ADJUSTMENT',
          salesAmount: -120_000,
          commissionAmount: -12_000,
          sellerCouponAmount: 0,
          payoutAmount: -108_000,
        }),
      ]),
    )

    await openScreen()

    const table = screen.getByRole('table', { name: copy.detail.items.caption })

    expect(within(table).getByText(copy.itemTypeLabels.RETURN_ADJUSTMENT)).toBeVisible()
    expect(within(table).getByText(copy.itemTypeLabels.SALE)).toBeVisible()
    expect(within(table).getByText('-₩120,000')).toBeVisible()
    expect(screen.getByText(copy.detail.items.adjustmentNotice)).toBeVisible()
  })
})

describe('승인 · 보류 · 지급 (F3 · F4 · F5)', () => {
  it('offers only what the transition table allows from this status', async () => {
    await openScreen()

    expect(screen.getByRole('button', { name: copy.actions.labels.approve })).toBeVisible()
    expect(screen.getByRole('button', { name: copy.actions.labels.hold })).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.actions.labels.pay })).toBeNull()
  })

  it('offers only 지급 확정 once a settlement has been approved', async () => {
    api.fetchSettlement.mockResolvedValue(
      settlementDetail(settlement({ status: 'APPROVED', approvedAt: '2026-09-01T00:00:00.000Z' })),
    )

    await openScreen()

    expect(screen.getByRole('button', { name: copy.actions.labels.pay })).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.actions.labels.approve })).toBeNull()
    expect(screen.queryByRole('button', { name: copy.actions.labels.hold })).toBeNull()
  })

  /**
   * **F5.** 「지급완료된 정산서는 수정할 수 없다」는 화면의 조건문이 아니라 전이표의
   * 빈 배열이다. 버튼이 하나도 없고, 그 자리에 왜인지가 적힌다 — 권한을 얻어도
   * 열리지 않는 자리라 「권한이 없어요」로는 말할 수 없다.
   */
  it('offers nothing at all once the money has gone out', async () => {
    api.fetchSettlement.mockResolvedValue(
      settlementDetail(
        settlement({
          status: 'PAID',
          approvedAt: '2026-09-01T00:00:00.000Z',
          paidAt: '2026-09-02T00:00:00.000Z',
        }),
      ),
    )

    await openScreen()

    for (const label of Object.values(copy.actions.labels)) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }

    expect(screen.getByText(copy.actions.locked.title)).toBeVisible()
    expect(screen.getByText(copy.actions.locked.description)).toBeVisible()
  })

  it('approves after asking once, with the amount on the confirmation', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.actions.labels.approve }))

    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).getByText(
        copy.actions.confirm.approve.description
          .replace('{brand}', '루미에르')
          .replace('{period}', '2026. 8. 24. ~ 2026. 8. 30.')
          .replace('{amount}', '₩1,551,000'),
      ),
    ).toBeVisible()

    await user.click(
      within(dialog).getByRole('button', { name: copy.actions.confirm.approve.confirm }),
    )

    await waitFor(() => {
      expect(api.approveSettlement).toHaveBeenCalledWith(PENDING.id)
    })
    expect(await screen.findByText(copy.toast.approved)).toBeVisible()
  })

  /**
   * **R1.** 지급 확정에는 되돌아가는 화살표가 없다. 그래서 금액이 확인 문구에 다시
   * 적히고, 아니라고 답하면 아무것도 나가지 않는다.
   */
  it('says the amount again before the payment is confirmed, and sends nothing on a no', async () => {
    api.fetchSettlement.mockResolvedValue(
      settlementDetail(settlement({ status: 'APPROVED', approvedAt: '2026-09-01T00:00:00.000Z' })),
    )

    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.actions.labels.pay }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(/₩1,551,000/u)).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: copy.actions.confirm.pay.cancel }))

    expect(api.paySettlement).not.toHaveBeenCalled()
  })

  /**
   * **F4.** 공백만 적고 넘어갈 수 있으면 「사유를 입력해야 한다」는 화면의 예의이지
   * 규칙이 아니게 된다. 계약도 DB 도 같은 것을 거절하지만, 그 왕복에서 사람이 배우는
   * 것은 아무것도 없다.
   */
  it('refuses a blank hold reason before anything leaves the browser', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.actions.labels.hold }))
    // 라벨에 필수 표시가 붙으므로 부분 일치로 찾는다 (`FormField`).
    await user.type(
      await screen.findByLabelText(copy.actions.hold.reasonLabel, { exact: false }),
      '   ',
    )
    await user.click(screen.getByRole('button', { name: copy.actions.hold.submit }))

    expect(await screen.findByText(copy.actions.hold.errors.required)).toBeVisible()
    expect(api.holdSettlement).not.toHaveBeenCalled()
  })

  it('sends a hold with the reason, trimmed', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.actions.labels.hold }))
    await user.type(
      await screen.findByLabelText(copy.actions.hold.reasonLabel, { exact: false }),
      '  반품 분쟁 확인 중  ',
    )
    await user.click(screen.getByRole('button', { name: copy.actions.hold.submit }))

    await waitFor(() => {
      expect(api.holdSettlement).toHaveBeenCalledWith(PENDING.id, '반품 분쟁 확인 중')
    })
    expect(await screen.findByText(copy.toast.held)).toBeVisible()
  })

  /**
   * 409 는 이 화면에서 실제로 일어난다 — 목록을 열어 둔 채 남이 같은 정산서를
   * 승인하면 그렇다. 그때 필요한 것은 토스트가 아니라 버튼 옆에 **남는** 문장이다.
   */
  it('leaves the refusal on screen when the status moved under us', async () => {
    api.approveSettlement.mockRejectedValue(
      new ApiClientError({
        kind: 'http',
        message: 'wrong status',
        status: 409,
        body: {
          error: {
            code: 'SETTLEMENT_WRONG_STATUS',
            message: '지금 상태(APPROVED)에서는 할 수 없는 처리예요.',
            details: [],
            requestId: '0192f0c1-4e2b-7a10-9c33-8f2b6d0a41c7',
          },
        },
      }),
    )

    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.actions.labels.approve }))

    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: copy.actions.confirm.approve.confirm }),
    )

    expect(await screen.findByText(errors.SETTLEMENT_WRONG_STATUS)).toBeVisible()
  })
})

it('lets a demo administrator approve an example but keeps payout unavailable', async () => {
  const user = await openScreen(sessionDemoAdmin)
  await user.click(screen.getByRole('button', { name: copy.actions.labels.approve }))
  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: copy.actions.confirm.approve.confirm }),
  )
  await waitFor(() => expect(api.approveSettlement).toHaveBeenCalled())
  const pay = await screen.findByRole('button', { name: copy.actions.labels.pay })
  expect(pay).toHaveAttribute('aria-disabled', 'true')
  await user.click(pay)
  expect(api.paySettlement).not.toHaveBeenCalled()
})

describe('처리 자격이 없는 계정 (F7)', () => {
  /**
   * 데모 관리자는 운영자에서 파생되고(`role-permissions.ts`), 운영자에게
   * `settlement.approve` 도 `settlement.pay` 도 없다. 거절은 조건문이 아니라 권한
   * 목록의 **빈자리**가 만든다.
   */
  it.each([['an operator', sessionAdminOperator]])(
    'shows %s the whole settlement and blocks both writes, with a reason',
    async (_n, session) => {
      await openScreen(session)

      // 계산 근거도 항목도 그대로 보인다. 볼 수 있는 자격과 처리할 수 있는 자격은
      // 다른 것이다.
      expect(screen.getByRole('region', { name: copy.detail.sections.calculation })).toBeVisible()

      for (const label of [copy.actions.labels.approve, copy.actions.labels.hold]) {
        const button = screen.getByRole('button', { name: label })

        expect(button).toHaveAttribute('aria-disabled', 'true')
        expect(button).toHaveAccessibleDescription(auth.denials.missing_permission)
      }
    },
  )

  /** 지급 확정도 같은 자리에서 막힌다 — 그쪽은 `settlement.pay` 다 (D-058). */
  it('blocks the payment for an operator, and lets nothing through the keyboard (P4)', async () => {
    api.fetchSettlement.mockResolvedValue(
      settlementDetail(settlement({ status: 'APPROVED', approvedAt: '2026-09-01T00:00:00.000Z' })),
    )

    const user = await openScreen(sessionAdminOperator)
    const pay = screen.getByRole('button', { name: copy.actions.labels.pay })

    expect(pay).toHaveAttribute('aria-disabled', 'true')
    expect(pay).toHaveAccessibleDescription(auth.denials.missing_permission)

    pay.focus()
    expect(pay).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.paySettlement).not.toHaveBeenCalled()
  })
})

describe('없는 정산서', () => {
  /** 404 는 오류가 아니라 **빈 상태**다. 「다시 시도」는 몇 번을 눌러도 같은 답이다. */
  it('is an empty state with a way back, not a retry', async () => {
    api.fetchSettlement.mockRejectedValue(
      new ApiClientError({
        kind: 'http',
        message: 'not found',
        status: 404,
        body: {
          error: {
            code: 'NOT_FOUND',
            message: '정산서를 찾을 수 없어요.',
            details: [],
            requestId: '0192f0c1-4e2b-7a10-9c33-8f2b6d0a41c8',
          },
        },
      }),
    )

    const { default: SettlementDetailPage } = await import('@/app/settlements/[id]/page')
    const page = await SettlementDetailPage({ params: Promise.resolve({ id: PENDING.id }) })

    renderWithAuth(page)

    expect(await screen.findByText(copy.detail.notFoundTitle)).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.detail.retryLabel })).toBeNull()
    expect(screen.getByRole('link', { name: copy.detail.backLabel })).toHaveAttribute(
      'href',
      '/settlements',
    )
  })
})

const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
  },
}

describe('접근성 (P2)', () => {
  it('has no violations with the breakdown, the items and a blocked write', async () => {
    api.fetchSettlement.mockResolvedValue(
      settlementDetail(PENDING, [
        settlementItem(),
        settlementItem({
          type: 'RETURN_ADJUSTMENT',
          salesAmount: -120_000,
          commissionAmount: -12_000,
          sellerCouponAmount: 0,
          payoutAmount: -108_000,
        }),
      ]),
    )

    await openScreen(sessionAdminOperator)

    const results = await axe.run(document.body, A11Y)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
