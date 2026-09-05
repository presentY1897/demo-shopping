/**
 * 주문서의 결제 (TASK-0054 F1 · F2 · F3).
 *
 * **거절이 값으로 온다** (TASK-0052 4.3). 승인 요청은 200 으로 돌아오고 `FAILED` 인
 * 결제가 몸통에 담겨 오므로, 이 파일이 재는 것의 절반은 「실패했을 때 화면이
 * 오류가 아니라 **다음 행동**을 보여 주는가」다 — 예약이 유지되는 이유가 정확히
 * 그것이고(4.3), 유지된 예약으로 할 수 있는 일은 다른 카드로 다시 결제하는 것이다.
 *
 * 목이 **상태를 갖는다.** 승인은 시작된 결제에만 걸리고, 거절된 결제는 다시 승인되지
 * 않는다. 얼어붙은 픽스처로는 「다시 걸었더니 이번엔 됐다」를 물어볼 수 없다.
 */

import {
  mockPaths,
  noCards,
  resetCheckoutStore,
  resetPaymentStore,
  sessionBuyer,
  shopperCards,
  shopperCheckout,
  httpFailureOn,
  neverAnswersOn,
} from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: CheckoutPage } = await import('@/app/checkout/[id]/page')
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { resetDensity } from './support/mypage'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const copy = messagesFor().checkout
const pay = copy.payment
const { checkout } = shopperCheckout

/**
 * 씨앗 카드 세 장. 사용 가능액은 각각 70만 · 5만 · (정지) 50만이다.
 *
 * 브랜드 이름을 여기 적지 않고 픽스처에서 꺼내는 이유는, 이 검사가 재려는 것이
 * 「누리카드가 보인다」가 아니라 **「서버가 준 카드가 보인다」**이기 때문이다.
 * 없으면 그 자리에서 멈춘다 — 픽스처가 바뀌었다는 뜻이고, 조용히 통과하면 아래
 * 정규식들이 전부 아무것이나 맞히게 된다.
 */
function seedCard(index: number): (typeof shopperCards.cards)[number] {
  const card = shopperCards.cards[index]

  if (card === undefined) throw new Error(`shopperCards 에 ${String(index)}번 카드가 없다`)

  return card
}

const ROOMY = seedCard(0)
const TIGHT = seedCard(1)
const SUSPENDED = seedCard(2)

/** 이 주문서의 결제예정금액. 첫 카드는 덮고 둘째 카드는 덮지 못한다. */
const TOTAL = checkout.paidAmount

/** 보낸 요청. 「주문을 두 번 만들지 않았다」를 세는 데 쓴다 (4.3). */
let sent: string[] = []

/**
 * 앞 검사가 떠나면서 보낸 해제 신호를 흘려보내고 주문서를 다시 연다.
 *
 * `checkout-page.spec.tsx` 와 같은 이유다 — 언마운트마다 목의 주문서가 닫히고, 그
 * 요청이 다음 검사의 렌더 뒤에 도착하면 이유 없이 만료 화면을 본다.
 */
async function renderCheckout(cards: typeof shopperCards = shopperCards) {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  resetCheckoutStore()
  resetPaymentStore(cards)

  stubViewport(VIEWPORTS.desktop)
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

/** 카드까지 도착한 결제수단 영역. */
async function paymentSection(): Promise<HTMLElement> {
  const section = await screen.findByRole('region', { name: pay.title })

  await within(section).findByRole('group', { name: pay.chooseCard })

  return section
}

/** 약관에 동의하고 주문하기를 누른다 — 그 하나가 주문과 결제를 다 한다. */
async function order(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

  await user.click(within(summary).getByRole('checkbox', { name: copy.termsLabel }))
  await user.click(within(summary).getByRole('button', { name: copy.placeOrder }))
}

function ordersCreated(): number {
  return sent.filter((each) => each === 'POST /orders').length
}

beforeEach(() => {
  resetDensity()
  resetCheckoutStore()
  resetPaymentStore()
  sent = []
  testServer.server.events.on('request:start', ({ request }) => {
    sent.push(`${request.method} ${new URL(request.url).pathname.replace('/api/v1', '')}`)
  })
  // **`Date` 만 가짜로 만든다** — `checkout-page.spec.tsx` 가 그 이유를 적는다.
  // 여기서는 타이머보다 승인의 `approvedAt` 이 고정된 시각이 되는 것이 이득이다.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(new Date(checkout.expiresAt).getTime() - 10 * 60 * 1000))
})

afterEach(() => {
  testServer.server.events.removeAllListeners('request:start')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('카드 고르기 (F1)', () => {
  it('lists the cards with what is left on each', async () => {
    await renderCheckout()

    const section = await paymentSection()

    // 한도가 아니라 **사용 가능액**이다. 한도만 보여 주면 이미 쓴 카드를 고른
    // 사람은 왜 거절당했는지 알 수 없다.
    expect(
      within(section).getByText(
        pay.cardLabel.replace('{brand}', ROOMY.brand).replace('{number}', ROOMY.maskedNumber),
      ),
    ).toBeVisible()
    expect(within(section).getByText(/사용 가능.*700,000/u)).toBeVisible()
    expect(within(section).getByText(/사용 가능.*50,000/u)).toBeVisible()
  })

  it('picks the first usable card so that ordering is one press away', async () => {
    await renderCheckout()

    const section = await paymentSection()

    expect(within(section).getByRole('radio', { name: new RegExp(ROOMY.brand, 'u') })).toBeChecked()
  })

  it('shows the suspended card, refuses to choose it, and says why (F3)', async () => {
    await renderCheckout()

    const section = await paymentSection()

    // 숨기지 않는다 (TASK-0023 4장). 목록에서 빼면 카드를 정지시킨 사람은 자기
    // 카드가 사라졌다고 믿는다 — 보여 주되 고를 수 없고, 이유가 그 옆에 있다.
    expect(within(section).getAllByRole('radio')).toHaveLength(shopperCards.cards.length)
    expect(
      within(section).getByRole('radio', { name: new RegExp(SUSPENDED.brand, 'u') }),
    ).toBeDisabled()
    expect(within(section).getByText(pay.blocked.SUSPENDED)).toBeVisible()
  })

  it('leaves a card that cannot cover the total choosable', async () => {
    await renderCheckout()

    const section = await paymentSection()

    // 한도가 모자란 것은 **고를 수 없는 이유가 아니다.** 미리 막으면 이 TASK 의
    // 핵심 시연인 「한도 초과」가 화면에서 사라지고, 승인을 정하는 것은 우리가
    // 읽어 둔 숫자가 아니라 서버의 원장이다.
    expect(within(section).getByRole('radio', { name: new RegExp(TIGHT.brand, 'u') })).toBeEnabled()
  })
})

describe('카드가 없는 사람', () => {
  it('says so and points at where a card is made', async () => {
    await renderCheckout(noCards)

    expect(await screen.findByText(pay.noneTitle)).toBeVisible()
    expect(screen.getByRole('link', { name: pay.noneAction })).toHaveAttribute('href', '/mypage')
  })

  it('cannot order, and the reason is under the button', async () => {
    await renderCheckout(noCards)

    await screen.findByText(pay.noneTitle)

    const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

    expect(within(summary).getByRole('button', { name: copy.placeOrder })).toBeDisabled()
    expect(within(summary).getByText(pay.cardRequired)).toBeVisible()
  })
})

describe('승인 (F1)', () => {
  it('orders, authorizes and captures on one press', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await paymentSection()
    await order(user)

    expect(await screen.findByText(pay.paidTitle)).toBeVisible()
    expect(screen.getByText(/20260905-7KQ3M2VB/u)).toBeVisible()

    // 승인과 매입이 **두 요청**인 것은 가상 카드의 사정이 아니라 계약이다 (D-031).
    // 화면이 프로바이더에 따라 다른 순서를 밟으면 추상화가 아무 일도 하지 않는다.
    expect(sent).toContain('POST /payments')
    expect(sent.some((each) => each.endsWith('/authorize'))).toBe(true)
    expect(sent.some((each) => each.endsWith('/capture'))).toBe(true)
  })

  it('shows where the payment is while it runs', async () => {
    const user = userEvent.setup()

    testServer.server.use(neverAnswersOn('post', mockPaths.paymentAuthorize))

    await renderCheckout()
    await paymentSection()
    await order(user)

    expect(await screen.findByText(pay.progress.authorizing)).toBeVisible()

    const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

    // 도는 동안 같은 버튼을 또 누를 수 없다. 두 번 누르면 주문이 두 벌 생긴다.
    expect(within(summary).getByRole('button', { name: copy.placing })).toBeDisabled()
  })
})

describe('거절 (F2)', () => {
  it('says how much the card was short, and that the hold is still there', async () => {
    const user = userEvent.setup()

    await renderCheckout()

    const section = await paymentSection()

    await user.click(within(section).getByRole('radio', { name: new RegExp(TIGHT.brand, 'u') }))
    await order(user)

    // 「결제할 수 없습니다」가 아니다. 모자란 금액이 문장에 있어야 다음에 할 일이
    // 정해진다 — 476,500 − 50,000 = 426,500.
    const short = TOTAL - (TIGHT.creditLimit - TIGHT.usedAmount)

    expect(await screen.findByText(/카드 한도가.*426,500.*모자라요/u)).toBeVisible()
    expect(short).toBe(426_500)
    expect(screen.getByText(pay.holdKept)).toBeVisible()
  })

  it('is not the end of the checkout — the screen is still a checkout', async () => {
    const user = userEvent.setup()

    await renderCheckout()

    const section = await paymentSection()

    await user.click(within(section).getByRole('radio', { name: new RegExp(TIGHT.brand, 'u') }))
    await order(user)
    await screen.findByText(pay.holdKept)

    // 실패가 곧 포기는 아니다 (4.3). 오류 화면으로 갈아 끼우면 사람은 주문이
    // 사라졌다고 믿고, 잡아 둔 재고는 15분 동안 아무에게도 가지 않는다.
    expect(screen.getByRole('region', { name: copy.itemsTitle })).toBeVisible()
    expect(screen.getByRole('region', { name: pay.title })).toBeVisible()
    expect(screen.queryByText(pay.paidTitle)).toBeNull()
  })

  it('lets another card finish the same order, without ordering twice', async () => {
    const user = userEvent.setup()

    await renderCheckout()

    const section = await paymentSection()

    await user.click(within(section).getByRole('radio', { name: new RegExp(TIGHT.brand, 'u') }))
    await order(user)
    await screen.findByText(pay.holdKept)

    await user.click(within(section).getByRole('radio', { name: new RegExp(ROOMY.brand, 'u') }))
    await user.click(screen.getByRole('button', { name: pay.retry }))

    expect(await screen.findByText(pay.paidTitle)).toBeVisible()

    // **주문은 한 번만 만들어졌다.** 두 번 만들면 한 사람이 같은 물건을 두 몫
    // 잠그고, 그 두 번째 주문은 아무도 결제하지 않는다.
    expect(ordersCreated()).toBe(1)
  })

  it('tells a lost request apart from a refusal', async () => {
    const user = userEvent.setup()

    testServer.server.use(
      httpFailureOn('post', mockPaths.paymentAuthorize, 500, 'INTERNAL_ERROR', '승인에 실패했어요'),
    )

    await renderCheckout()
    await paymentSection()
    await order(user)

    // 카드가 거절한 것과 우리가 결과를 못 받은 것은 다음에 할 일이 다르다 — 뒤의
    // 것은 결제가 됐는지 안 됐는지를 **우리도 모른다.**
    expect(await screen.findByText(pay.refusals.unreachable)).toBeVisible()
    expect(screen.queryByText(pay.refusals.declined)).toBeNull()
  })
})
