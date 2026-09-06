/**
 * `/mypage` 머리의 두 숫자 — 적립금 잔액과 쿠폰 수 (TASK-0077).
 *
 * **요약이 하는 일은 「있다」를 말하는 것이다.** 그래서 이 파일이 묻는 것도 그것 하나다:
 * 두 숫자가 서버가 말한 값인가, 그 화면으로 가는 길이 있는가, 그리고 **한쪽이 실패했을
 * 때 다른 쪽이 살아 있는가.**
 *
 * 마지막 것이 이 화면의 진짜 위험이다. 하나로 묶인 상태였다면 적립금을 못 읽은 순간
 * 쿠폰 수까지 사라지고, 그 사람은 자기 쿠폰이 없어졌다고 읽는다.
 */

import {
  httpFailureOn,
  mockPaths,
  resetCouponBoxStore,
  resetPointStore,
  sessionBuyer,
  shopperCouponBox,
  shopperPointSummary,
} from '@shopping/api-mocks'
import { formatMoney } from '@shopping/ui/format'
import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MyPage from '@/app/mypage/page'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage' }))

const messages = messagesFor()
const copy = messages.mypage.summary

const won = (amount: number): string => formatMoney({ amount, currency: 'KRW' })

function openSummary(): void {
  resetCouponBoxStore()
  resetPointStore()
  renderAccountScreen(<MyPage />, { session: sessionBuyer })
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('두 숫자', () => {
  it('shows the balance the server reported', async () => {
    openSummary()

    expect(await screen.findByText(won(shopperPointSummary.account.balance))).toBeVisible()
  })

  it('counts only the coupons that can still be used', async () => {
    openSummary()

    // 만료·사용한 장까지 세면 그 수는 「쓸 수 있는 것」의 수가 아니게 되고, 쿠폰함에
    // 들어간 사람은 자기 쿠폰이 줄었다고 읽는다.
    expect(
      await screen.findByText(
        copy.couponCount.replace('{count}', String(shopperCouponBox.counts.ISSUED)),
      ),
    ).toBeVisible()
  })

  it('says what is still coming, so the balance is not read as the whole story (F6)', async () => {
    openSummary()

    expect(
      await screen.findByText(
        copy.pendingLabel.replace('{amount}', won(shopperPointSummary.pendingEarn)),
      ),
    ).toBeVisible()
  })

  it('offers a way into each screen', async () => {
    openSummary()

    // 요약 안에서 찾는다. 아래 내비게이션에도 같은 이름의 링크가 있고, 그것이 정상이다 —
    // 둘은 같은 곳으로 가는 두 개의 문이지 하나의 오타가 아니다.
    const summary = within(await screen.findByRole('region', { name: copy.title }))

    expect(summary.getByRole('link', { name: copy.pointsLink })).toHaveAttribute(
      'href',
      '/mypage/points',
    )
    expect(summary.getByRole('link', { name: copy.couponsLink })).toHaveAttribute(
      'href',
      '/mypage/coupons',
    )
  })
})

describe('한쪽이 실패했을 때', () => {
  it('keeps the coupon count when the balance could not be read', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.mePoints, 500, 'INTERNAL_ERROR', '문제가 생겼어요.'),
    )
    openSummary()

    expect(
      await screen.findByText(
        copy.couponCount.replace('{count}', String(shopperCouponBox.counts.ISSUED)),
      ),
    ).toBeVisible()
    expect(screen.getByText(copy.unavailable)).toBeVisible()
    // 0을 그리면 그것은 거짓말이다 — 0은 **아는 사실**이고 못 읽은 것은 모르는 것이다.
    expect(screen.queryByText(won(0))).toBeNull()
  })

  it('keeps the balance when the coupon count could not be read', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.meCoupons, 500, 'INTERNAL_ERROR', '문제가 생겼어요.'),
    )
    openSummary()

    expect(await screen.findByText(won(shopperPointSummary.account.balance))).toBeVisible()
    expect(screen.getByText(copy.unavailable)).toBeVisible()
    expect(screen.queryByText(copy.couponCount.replace('{count}', '0'))).toBeNull()
  })
})
