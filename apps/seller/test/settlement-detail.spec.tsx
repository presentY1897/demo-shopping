/**
 * `/settlements/[id]` — 계산 근거 (TASK-0082 4장 · F2 · F3).
 *
 * TASK 의 4장은 한 문장이다: **정산액만 던지면 「왜 이 금액이냐」는 문의가 생긴다.**
 * 그래서 이 파일이 재는 것은 「표가 그려지는가」가 아니라 **그 물음에 답이 되는가**다.
 *
 * - 수수료와 판매자 부담 쿠폰이 **각각 한 줄**인가 (3장 요구사항 5)
 * - 지급액이 서버가 보낸 값 그대로인가 — 화면이 네 줄을 더해 만든 값이 아니라 (F3)
 * - 플랫폼 쿠폰이 차감되지 않는다는 사실이 화면에 적혀 있는가
 */

import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SettlementDetailWorkspace } from '@/components/settlements/settlement-detail-workspace'
import { money } from '@/lib/orders/format'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import {
  answerFailure,
  answerJson,
  lastRequestTo,
  resetApiStub,
  stubApiClient,
} from './support/api-stub'
import { PAID_SETTLEMENT_ID, settlementDetail } from './support/settlement-fixtures'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const copy = messagesFor().settlementDetail

const DETAIL_PATH = `/settlements/${PAID_SETTLEMENT_ID}`

beforeEach(() => {
  resetApiStub()
  stubApiClient()
})

async function openDetail(): Promise<HTMLElement> {
  renderWithAuth(<SettlementDetailWorkspace settlementId={PAID_SETTLEMENT_ID} />)

  return screen.findByRole('table', { name: copy.calculation.caption })
}

describe('the settlement detail', () => {
  it('reads the same route the admin console reads (F3)', async () => {
    answerJson(DETAIL_PATH, settlementDetail)
    await openDetail()

    // 판매자용 사본이 아니다. 두 콘솔이 다른 문을 쓰면 같은 정산서를 다른 숫자로
    // 그리게 되는 날이 오고, 그때 이의 제기는 「누가 맞나」로 시작한다.
    expect(lastRequestTo(DETAIL_PATH)).not.toBeNull()
  })

  describe('the five lines of pricing.md', () => {
    it('keeps commission and the seller coupon apart', async () => {
      const table = await openDetailWith()

      expect(within(table).getByText(copy.calculation.lines.commission)).toBeVisible()
      expect(within(table).getByText(money(-189_000))).toBeVisible()
      expect(within(table).getByText(copy.calculation.lines.sellerCoupon)).toBeVisible()
      expect(within(table).getByText(money(-30_000))).toBeVisible()
      // 「차감 219,000원」 한 줄로 합쳐져 있지 않다는 것까지 잰다.
      expect(within(table).queryByText(money(-219_000))).toBeNull()
    })

    it('shows the return deduction on its own line', async () => {
      const table = await openDetailWith()

      expect(within(table).getByText(copy.calculation.lines.returnAdjustment)).toBeVisible()
      expect(within(table).getByText(money(-120_000))).toBeVisible()
    })

    it('prints the payout the server sent', async () => {
      const table = await openDetailWith()

      expect(within(table).getByText(money(1_551_000))).toBeVisible()
    })

    it('prints the payout the server sent even when the four do not add up', async () => {
      // F3 를 실제로 재는 자리. 화면이 네 줄을 더해 그렸다면 여기서 1,551,000원이
      // 나오고 검사가 빨개진다 — 옳은 것은 언제나 서버 쪽이다.
      answerJson(DETAIL_PATH, {
        ...settlementDetail,
        settlement: { ...settlementDetail.settlement, payoutAmount: 999 },
      })
      renderWithAuth(<SettlementDetailWorkspace settlementId={PAID_SETTLEMENT_ID} />)

      const table = await screen.findByRole('table', { name: copy.calculation.caption })

      expect(within(table).getByText(money(999))).toBeVisible()
      expect(within(table).queryByText(money(1_551_000))).toBeNull()
    })
  })

  it('says that platform coupons and points are not deducted', async () => {
    // 이 한 줄이 「구매자는 45,000원 냈는데 왜 판매액이 50,000원이죠」를 없앤다.
    await openDetailWith()

    expect(screen.getByText(copy.calculation.platformNote)).toBeVisible()
  })

  describe('the item lines', () => {
    it('lists the orders behind the total, by order number', async () => {
      await openDetailWith()

      const items = screen.getByRole('table', { name: copy.items.caption })

      expect(within(items).getByText('ORD-20260825-0001')).toBeVisible()
      expect(within(items).getByText('ORD-20260818-0007')).toBeVisible()
    })

    it('marks the return adjustment as one, with negative amounts', async () => {
      await openDetailWith()

      const items = screen.getByRole('table', { name: copy.items.caption })

      expect(
        within(items).getByText(messagesFor().settlements.itemTypeLabels.RETURN_ADJUSTMENT),
      ).toBeVisible()
      expect(within(items).getByText(money(-132_000))).toBeVisible()
    })
  })

  describe('a round on hold', () => {
    it('shows the reason, because the seller asks after the fact', async () => {
      answerJson(DETAIL_PATH, {
        ...settlementDetail,
        settlement: {
          ...settlementDetail.settlement,
          heldAt: '2026-09-01T03:00:00.000Z',
          holdReason: '반품 분쟁 확인 중',
          status: 'HOLD',
        },
      })
      renderWithAuth(<SettlementDetailWorkspace settlementId={PAID_SETTLEMENT_ID} />)
      await screen.findByRole('table', { name: copy.calculation.caption })

      const notice = screen.getByText(copy.summary.holdTitle, { exact: false })

      expect(notice).toHaveTextContent('반품 분쟁 확인 중')
      expect(notice).toHaveAttribute('role', 'status')
    })
  })

  describe('before payment', () => {
    it('says so rather than leaving the field blank', async () => {
      // 금액 칸 옆의 빈 칸은 「0원 지급」으로 읽힌다.
      answerJson(DETAIL_PATH, {
        ...settlementDetail,
        settlement: { ...settlementDetail.settlement, paidAt: null, status: 'APPROVED' },
      })
      renderWithAuth(<SettlementDetailWorkspace settlementId={PAID_SETTLEMENT_ID} />)

      expect(await screen.findByText(copy.summary.notPaid)).toBeVisible()
    })
  })

  it("offers no approve, hold or pay button — those are the admin's", async () => {
    await openDetailWith()

    // 누를 수 없는 버튼을 두면 그것을 설명하는 문장이 따라붙고, 그 문장은 판매자가
    // 알 필요가 없다. 남는 버튼은 없다 — 뒤로 가는 링크뿐이다.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  describe("when the settlement is somebody else's", () => {
    it('shows the refusal and a retry, not an empty page', async () => {
      answerFailure(DETAIL_PATH, 403, 'AUTH_REQUIRED', '권한이 없습니다.')
      renderWithAuth(<SettlementDetailWorkspace settlementId={PAID_SETTLEMENT_ID} />)

      expect(await screen.findByText(copy.errorTitle)).toBeVisible()
      expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
    })
  })
})

async function openDetailWith(): Promise<HTMLElement> {
  answerJson(DETAIL_PATH, settlementDetail)

  return openDetail()
}
