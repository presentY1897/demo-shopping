/**
 * 주문서 화면 (TASK-0050 F2 · F3 · F5 · F6 · F7 · F8).
 *
 * **진입이 재고를 잡지 않는다** (4.1). 잡은 것은 장바구니의 「주문하기」이고 이
 * 화면은 그 결과를 id 로 읽는다 — 그래서 새로고침은 예약을 한 벌 더 만들지 않는다.
 * 목이 그 모양을 그대로 재현한다: 스토어는 **열려 있는 채로** 시작한다.
 */

import { resetCheckoutStore, sessionBuyer, shopperCheckout } from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: CheckoutPage } = await import('@/app/checkout/[id]/page')

const copy = messagesFor().checkout
const { checkout } = shopperCheckout

/**
 * 주문서가 열린 지 1분 지난 시점.
 *
 * 고정된 시각으로 옮겨 두는 이유는 타이머 때문이다 — 벽시계로 두면 만료까지 남은
 * 시간이 실행할 때마다 달라지고, 그러면 「3분 이하 강조」를 잴 수 없다.
 */
function moveTo(msBeforeExpiry: number): void {
  vi.setSystemTime(new Date(new Date(checkout.expiresAt).getTime() - msBeforeExpiry))
}

/**
 * 앞 검사가 떠나면서 보낸 해제 신호를 흘려보내고 주문서를 다시 연다.
 *
 * 화면을 벗어나면 예약이 풀린다(F4). 그것이 이 화면의 정상 동작이라, 검사가 끝나
 * 언마운트될 때마다 목 서버의 주문서가 닫힌다 — 그 요청이 **다음 검사가 렌더한
 * 뒤에** 도착하면 다음 검사는 이유 없이 만료 화면을 본다. 매크로태스크 하나를
 * 기다려 도착시킨 다음 다시 열면 그 경합이 사라진다.
 */
async function renderCheckout(width: number = VIEWPORTS.desktop) {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  resetCheckoutStore()

  stubViewport(width)
  navigation.start(`/checkout/${checkout.id}`)

  const result = renderWithAuth(
    <DensityProvider>
      {await CheckoutPage({ params: Promise.resolve({ id: checkout.id }) })}
    </DensityProvider>,
    { session: sessionBuyer },
  )

  await screen.findByRole('region', { name: copy.itemsTitle })

  return result
}

beforeEach(() => {
  resetDensity()
  resetCheckoutStore()
  // **`Date` 만 가짜로 만든다.** `setInterval` 까지 가짜가 되면 msw 의 응답과
  // Testing Library 의 대기가 함께 멈춰서, 증상이 「타이머가 틀렸다」가 아니라
  // 「화면이 영영 안 뜬다」로 나타난다.
  vi.useFakeTimers({ toFake: ['Date'] })
  moveTo(10 * 60 * 1000)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('타이머 (F2)', () => {
  it('says how long is left, without shouting about it', async () => {
    await renderCheckout()

    // R1: 15분 타이머가 심리적 압박이다. 마지막 3분 전까지는 그냥 적혀 있다.
    expect(screen.getByText(copy.remaining.replace('{time}', '10:00'))).toBeVisible()
  })

  it('changes what it says inside the last three minutes', async () => {
    moveTo(2 * 60 * 1000)

    await renderCheckout()

    expect(screen.getByText(copy.remainingUrgent.replace('{time}', '2:00'))).toBeVisible()
  })
})

describe('만료 (F3)', () => {
  it('replaces the whole screen once the time is up', async () => {
    // 만료된 뒤에 연다. 시간이 흐르기를 기다리는 대신 이렇게 재는 이유는, 기다리는
    // 검사는 느리면서도 「1초 뒤에 정말 바뀌는가」를 더 확실히 알려 주지 않기
    // 때문이다 — 바뀌는 조건은 `remainingAt` 이 답하고 그쪽은 단위 검사가 잰다.
    moveTo(-1_000)
    stubViewport(VIEWPORTS.desktop)
    navigation.start(`/checkout/${checkout.id}`)

    renderWithAuth(
      <DensityProvider>
        {await CheckoutPage({ params: Promise.resolve({ id: checkout.id }) })}
      </DensityProvider>,
      { session: sessionBuyer },
    )

    // 화면 **전체**가 바뀐다. 일부만 회색으로 만들면 사람은 남은 것을 살 수 있다고
    // 믿는다 — 잡아 둔 재고가 풀렸으므로 금액도 수량도 더는 보장되지 않는다.
    expect(await screen.findByText(copy.expiredTitle)).toBeVisible()
    expect(screen.queryByRole('region', { name: copy.itemsTitle })).toBeNull()
    expect(screen.getByRole('link', { name: copy.backToCart })).toHaveAttribute('href', '/cart')
  })

  it('shows the same screen when the server says the checkout is gone', async () => {
    // 만료와 해제를 화면이 구분할 이유가 없다 — 둘 다 「이 주문서는 이제 없다」이고,
    // 사람이 할 일은 장바구니로 돌아가는 것 하나다.
    navigation.start('/checkout/019596d0-1f1c-7c2e-9a0e-000000000000')

    renderWithAuth(
      <DensityProvider>
        {await CheckoutPage({
          params: Promise.resolve({ id: '019596d0-1f1c-7c2e-9a0e-000000000000' }),
        })}
      </DensityProvider>,
      { session: sessionBuyer },
    )

    expect(await screen.findByText(copy.expiredTitle)).toBeVisible()
  })
})

describe('이탈 해제 (F4)', () => {
  it('lets the hold go when the screen is left', async () => {
    const { unmount } = await renderCheckout()

    unmount()

    // 떠나는 신호가 도착할 시간을 준다. `keepalive` 를 단 `fetch` 라 문서가
    // 사라지는 중에도 가지만, 여기서는 그냥 다음 매크로태스크다.
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })

    // 풀렸으므로 같은 주문서를 다시 읽으면 없다. 화면이 만료와 해제를 구분하지
    // 않는 이유가 이것이다 — 사람이 할 일은 어느 쪽이든 장바구니로 돌아가는 것이다.
    navigation.start(`/checkout/${checkout.id}`)
    renderWithAuth(
      <DensityProvider>
        {await CheckoutPage({ params: Promise.resolve({ id: checkout.id }) })}
      </DensityProvider>,
      { session: sessionBuyer },
    )

    expect(await screen.findByText(copy.expiredTitle)).toBeVisible()
  })
})

describe('금액 (F5)', () => {
  it('shows what the server priced, down to the won', async () => {
    await renderCheckout()

    const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

    // 장바구니 · 주문서 · 저장된 주문이 같은 계산 엔진을 지난다.
    expect(within(summary).getByText(/474,000/u)).toBeVisible()
    expect(within(summary).getByText(/2,500/u)).toBeVisible()
    expect(within(summary).getByText(/476,500/u)).toBeVisible()
  })

  it('groups the lines by seller, each with its own shipping', async () => {
    await renderCheckout()

    const items = screen.getByRole('region', { name: copy.itemsTitle })

    expect(within(items).getByText('루미에르')).toBeVisible()
    expect(within(items).getByText('노드스텝')).toBeVisible()
  })
})

describe('배송지와 주문 (F6 · F7)', () => {
  it('refuses to order until a recipient and the terms are settled', async () => {
    await renderCheckout()

    const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

    // 배송지는 기본값이 골라져 있고, 남은 것은 동의다. 누를 수 없는 이유가 그
    // 아래 적혀 있다 — 이유 없는 비활성 컨트롤을 보면 사람은 화면이 고장 났다고
    // 생각한다.
    expect(within(summary).getByRole('button', { name: copy.placeOrder })).toBeDisabled()
    expect(within(summary).getByText(copy.termsRequired)).toBeVisible()
  })

  it('places the order once both are settled, and says the order number (F7)', async () => {
    const user = userEvent.setup()

    await renderCheckout()

    const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

    await user.click(within(summary).getByRole('checkbox', { name: copy.termsLabel }))
    await user.click(within(summary).getByRole('button', { name: copy.placeOrder }))

    // 「결제 단계로 이동」할 곳이 아직 없다 (4.6). 없는 라우트로 보내는 대신
    // 주문서가 그 자리에서 접수 상태로 바뀐다.
    expect(await screen.findByText(copy.placedTitle)).toBeVisible()
    expect(screen.getByText(/20260905-7KQ3M2VB/u)).toBeVisible()
  })

  it('lets a recipient be chosen from the address book', async () => {
    await renderCheckout()

    const recipients = screen.getByRole('region', { name: copy.recipientTitle })

    expect(within(recipients).getAllByRole('radio').length).toBeGreaterThan(0)
    expect(within(recipients).getAllByRole('link', { name: copy.recipientAdd })[0]).toHaveAttribute(
      'href',
      '/mypage/addresses',
    )
  })
})

describe('아직 안 온 것들의 자리 (4.5)', () => {
  it('names what will go there instead of saying 준비 중', async () => {
    await renderCheckout()

    // 빈 상자는 만들다 만 화면으로 보이고, 이름이 붙은 빈 상자는 아직 안 온
    // 기능으로 보인다.
    expect(screen.getByRole('region', { name: copy.couponTitle })).toBeVisible()
    expect(screen.getByText(copy.paymentBody)).toBeVisible()
  })
})

describe('F8 아홉 조합', () => {
  it.each(
    DENSITY_LEVELS.flatMap((density) =>
      (['mobile', 'tablet', 'desktop'] as const).map((band) => ({ density, band })),
    ),
  )('draws a complete checkout at density $density on $band', async ({ density, band }) => {
    window.localStorage.setItem('shopping.density', String(density))

    await renderCheckout(VIEWPORTS[band])

    expect(screen.getByRole('region', { name: copy.itemsTitle })).toBeVisible()
    expect(screen.getByRole('region', { name: copy.recipientTitle })).toBeVisible()
    expect(screen.getByRole('complementary', { name: copy.summaryTitle })).toBeVisible()
    expect(screen.getAllByRole('button', { name: copy.placeOrder })).toHaveLength(1)
  })
})
