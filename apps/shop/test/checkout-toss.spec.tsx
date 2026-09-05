/**
 * 주문서의 토스 갈래 (TASK-0055 4.1 · 4.3 · 4.5 · F7).
 *
 * **이 저장소에는 키가 없다**(4.1). 그래서 이 파일이 재는 것의 절반은 **키가 없는
 * 상태**이고 — 그것이 기본 상태다 — 나머지 절반은 키를 넣었을 때 우리가 토스에
 * 무엇을 넘기는가다. 진짜 결제창은 사람이 키를 넣고 눌러 보는 것이고, 검사가 대신할
 * 수 있는 종류가 아니다.
 *
 * **결제창은 모듈 경계에서 갈아 끼운다.** `js.tosspayments.com` 에 닿는 검사는 하나도
 * 없다 — 목 서버가 처리되지 않은 요청을 거부하고 프로세스가 바깥으로 나가는 소켓을
 * 센다(TASK-0107 4.8). `mypage-addresses.spec.tsx` 가 우편번호 위젯에 하는 것과 같은
 * 모양이고, `tossClientKey` 는 진짜를 그대로 둔다 — 키의 있고 없음이 이 파일의
 * 주제라서 그것까지 가짜로 만들면 잴 것이 사라진다.
 */

import {
  resetCheckoutStore,
  resetPaymentStore,
  sessionBuyer,
  shopperCards,
  shopperCheckout,
  shopperOrder,
} from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as TossModule from '@/lib/payment/toss'
import type { TossCheckout, TossCheckoutRequest } from '@/lib/payment/toss'
import { openTossCheckout, TOSS_TEST_GUIDE_URL } from '@/lib/payment/toss'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { resetDensity } from './support/mypage'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

/**
 * 결제창만 갈아 끼운다.
 *
 * `tossClientKey` 를 원본 그대로 두는 것이 핵심이다 — 이 파일이 묻는 첫 질문이
 * 「키가 없으면 토스가 목록에 없는가」이고, 그 답을 `vi.stubEnv` 로 바꿔 가며 잰다.
 */
vi.mock('@/lib/payment/toss', async (importOriginal) => ({
  ...(await importOriginal<typeof TossModule>()),
  openTossCheckout: vi.fn<TossCheckout>(),
}))

const { default: CheckoutPage } = await import('@/app/checkout/[id]/page')

const copy = messagesFor().checkout
const pay = copy.payment
const { checkout } = shopperCheckout

/**
 * 결제창 클라이언트 키의 자리.
 *
 * 진짜 값이 아니고 진짜일 필요도 없다 — 이 검사가 재는 것은 「키가 있을 때」와
 * 「없을 때」의 갈림이지 키의 내용이 아니다. 승인 키는 여기에도 서버에만 있고,
 * 이 앱은 그 이름조차 모른다 (4.4).
 */
const CLIENT_KEY = 'test_ck_0000000000000000000000000000'

/** 씨앗 카드 세 장 중 첫 장 — 사용 가능액이 넉넉해 기본으로 골라진다. */
function roomyCard(): (typeof shopperCards.cards)[number] {
  const card = shopperCards.cards[0]

  if (card === undefined) throw new Error('shopperCards 가 비어 있다')

  return card
}

/** 보낸 요청과 그 몸통. 「무엇을 어떤 모양으로 보냈나」를 세는 데 쓴다. */
let sent: { readonly path: string; readonly body: unknown }[] = []
/** 서버가 연 결제. 결제창에 넘긴 `orderId` 를 이것과 맞춘다 (4.3). */
let opened: { readonly id: string; readonly authorizedAmount: number } | null = null

async function renderCheckout() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  resetCheckoutStore()
  resetPaymentStore()

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

  await within(section).findByRole('group', { name: pay.chooseMethod })

  return section
}

async function chooseToss(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  const section = await paymentSection()

  await user.click(within(section).getByRole('radio', { name: pay.toss.label }))

  return section
}

/** 약관에 동의하고 주문하기를 누른다 — 그 하나가 주문과 결제를 다 한다. */
async function order(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

  await user.click(within(summary).getByRole('checkbox', { name: copy.termsLabel }))
  await user.click(within(summary).getByRole('button', { name: copy.placeOrder }))
}

/** 결제창에 넘어간 것. 아직 안 열렸으면 기다린다. */
async function windowRequest(): Promise<TossCheckoutRequest> {
  await waitFor(() => {
    expect(vi.mocked(openTossCheckout)).toHaveBeenCalled()
  })

  const request = vi.mocked(openTossCheckout).mock.calls[0]?.[0]

  if (request === undefined) throw new Error('결제창이 열리지 않았다')

  return request
}

beforeEach(() => {
  resetDensity()
  resetCheckoutStore()
  resetPaymentStore()
  sent = []
  opened = null
  vi.mocked(openTossCheckout).mockReset()
  vi.mocked(openTossCheckout).mockResolvedValue(undefined)

  testServer.server.events.on('request:start', ({ request }) => {
    const path = new URL(request.url).pathname.replace('/api/v1', '')

    if (request.method === 'GET') return

    void request
      .clone()
      .json()
      .then((body: unknown) => {
        sent.push({ body, path })
      })
      .catch(() => {
        sent.push({ body: null, path })
      })
  })

  // 결제창에 넘긴 `orderId` 를 **서버가 방금 연 결제**와 맞추기 위해 응답을 읽는다.
  // 목의 id 형식을 검사가 다시 적으면 그 형식이 바뀌는 날 통과하는 거짓말이 된다.
  testServer.server.events.on('response:mocked', ({ request, response }) => {
    if (new URL(request.url).pathname !== '/api/v1/payments') return

    void response
      .clone()
      .json()
      .then((body: unknown) => {
        const { payment } = body as { payment: { id: string; authorizedAmount: number } }

        opened = { authorizedAmount: payment.authorizedAmount, id: payment.id }
      })
  })

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(new Date(checkout.expiresAt).getTime() - 10 * 60 * 1000))
})

afterEach(() => {
  testServer.server.events.removeAllListeners('request:start')
  testServer.server.events.removeAllListeners('response:mocked')
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('키가 없으면 토스가 없다 (4.1)', () => {
  it('offers no Toss option at all — not even a disabled one', async () => {
    await renderCheckout()

    const section = await paymentSection()

    // 「지금은 쓸 수 없어요」로도 없다. 정지된 카드와 달리 이것은 방문자가 어찌할 수
    // 없는 우리 설정이고, 알려 줘 봐야 할 수 있는 일이 없다.
    expect(within(section).getAllByRole('radio')).toHaveLength(shopperCards.cards.length)
    expect(within(section).queryByRole('radio', { name: pay.toss.label })).toBeNull()
  })

  it('shows no test-environment notice either', async () => {
    await renderCheckout()
    await paymentSection()

    expect(screen.queryByText(pay.toss.noticeTitle)).toBeNull()
    expect(screen.queryByRole('link', { name: pay.toss.noticeAction })).toBeNull()
  })

  it('leaves the virtual card chosen, so ordering is still one press away', async () => {
    await renderCheckout()

    const section = await paymentSection()

    expect(
      within(section).getByRole('radio', { name: new RegExp(roomyCard().brand, 'u') }),
    ).toBeChecked()
  })
})

describe('키가 있으면 선택지가 하나 는다 (R3)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', CLIENT_KEY)
  })

  it('puts Toss last and still starts on a virtual card', async () => {
    await renderCheckout()

    const section = await paymentSection()
    const radios = within(section).getAllByRole('radio')

    // 가상 카드가 기본이고 토스가 선택지다. 순서가 그 판단을 그대로 옮긴 것이다.
    expect(radios).toHaveLength(shopperCards.cards.length + 1)
    expect(radios.at(-1)).toHaveAccessibleName(pay.toss.label)
    expect(
      within(section).getByRole('radio', { name: new RegExp(roomyCard().brand, 'u') }),
    ).toBeChecked()
  })

  it('shows the notice only to whoever chose Toss (4.5)', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await paymentSection()

    // 처음부터 보여 주면 무엇을 골라야 하는지가 더 헷갈린다.
    expect(screen.queryByText(pay.toss.noticeTitle)).toBeNull()

    await chooseToss(user)

    expect(screen.getByText(pay.toss.noticeTitle)).toBeVisible()
  })

  it('links to the documentation instead of inventing a card number (F7 · 4.7)', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)

    expect(screen.getByRole('link', { name: pay.toss.noticeAction })).toHaveAttribute(
      'href',
      TOSS_TEST_GUIDE_URL,
    )
    // **번호를 짓지 않았다.** 토스는 테스트용 카드번호를 주지 않으므로 여기 적을 수
    // 있는 값이 애초에 없고, 지어낸 번호로 세 번 실패한 사람은 우리 결제가 고장 났다고
    // 결론 내린다. 카드번호 모양이 문장에 하나도 없다는 것으로 그것을 잰다.
    expect(screen.getByText(pay.toss.noticeBody).textContent).not.toMatch(/\d{4}\D?\d{4}/u)
  })

  it('is reachable with the arrow keys alone (P4 · U5)', async () => {
    const user = userEvent.setup()

    await renderCheckout()

    const section = await paymentSection()
    const radios = within(section).getAllByRole('radio')

    radios[0]?.focus()
    // 라디오 그룹은 화살표로 옮겨 다닌다. 정지된 카드는 건너뛰므로 두 번이면
    // 마지막 줄인 토스에 닿는다 — 마우스 없이도 결제수단을 바꿀 수 있어야 한다.
    await user.keyboard('{ArrowDown}{ArrowDown}')

    expect(within(section).getByRole('radio', { name: pay.toss.label })).toBeChecked()
    expect(screen.getByText(pay.toss.noticeTitle)).toBeVisible()
  })

  it('takes the notice away again when a card is chosen back', async () => {
    const user = userEvent.setup()

    await renderCheckout()

    const section = await chooseToss(user)

    await user.click(
      within(section).getByRole('radio', { name: new RegExp(roomyCard().brand, 'u') }),
    )

    expect(screen.queryByText(pay.toss.noticeTitle)).toBeNull()
  })
})

describe('결제창으로 넘어간다 (4.2 · 4.3)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', CLIENT_KEY)
  })

  it('opens the payment with TOSS and no card id', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)
    await order(user)
    await windowRequest()

    const started = sent.find((each) => each.path === '/payments')

    // 어느 카드로 낼지는 결제창 안에서 정해진다. 여기서 카드 id 를 보내면 그것은
    // 우리가 정할 수 없는 것을 정한 척하는 값이다.
    expect(started?.body).toEqual({ orderId: shopperOrder.order.id, provider: 'TOSS' })
  })

  it('hands Toss our payment id as its orderId, not the order id (4.3)', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)
    await order(user)

    const request = await windowRequest()

    // **여기가 이 검사의 핵심이다.** 주문 id 를 주면 토스가 그것으로 멱등을 판단해
    // 한 주문에 결제를 두 번 시도할 수 없고, 첫 시도가 실패해 다시 결제하는 것이
    // 정확히 그 경우다.
    expect(opened).not.toBeNull()
    expect(request.paymentId).toBe(opened?.id)
    expect(request.paymentId).not.toBe(shopperOrder.order.id)
    expect(request.paymentId).not.toBe(checkout.id)
  })

  it('pays the amount the server opened the payment with, not the one on screen', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)
    await order(user)

    const request = await windowRequest()

    expect(request.amount).toBe(opened?.authorizedAmount)
    expect(request.amount).toBe(checkout.paidAmount)
  })

  it('names the order after what is in it, and carries the client key', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)
    await order(user)

    const request = await windowRequest()

    // 세는 것은 줄 수다 — 이 주문서에는 세 줄이 있다.
    expect(request.orderName).toBe('울 롱코트 외 2건')
    expect(request.clientKey).toBe(CLIENT_KEY)
  })

  it('sends the shopper back to this very checkout (F3)', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)
    await order(user)

    const request = await windowRequest()

    // 토스가 돌려주는 셋 중 어느 것도 주문서를 가리키지 않는다. 그래서 우리가
    // 미리 실어 보낸다 — 실패한 사람에게 줄 길이 정확히 그 주문서다.
    const { origin } = window.location

    expect(request.successUrl).toBe(`${origin}/checkout/toss/success?checkout=${checkout.id}`)
    expect(request.failUrl).toBe(`${origin}/checkout/toss/fail?checkout=${checkout.id}`)
  })

  it('says the page is leaving, and does not call it done', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)
    await order(user)

    expect(await screen.findByText(pay.toss.leaving)).toBeVisible()
    // 결제창의 성공은 승인이 아니다 (4.2). 여기서 완료를 그리면 창을 닫고 돌아온
    // 사람이 「결제 완료」를 본 채로 결제되지 않은 주문을 갖는다.
    expect(screen.queryByText(pay.paidTitle)).toBeNull()
    expect(screen.getByRole('region', { name: copy.itemsTitle })).toBeVisible()
  })

  it('refuses a second press while the browser is on its way out', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)
    await order(user)
    await screen.findByText(pay.toss.leaving)

    const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

    expect(within(summary).getByRole('button', { name: copy.placing })).toBeDisabled()
  })

  it('never captures anything by itself — the return screen does that', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await chooseToss(user)
    await order(user)
    await screen.findByText(pay.toss.leaving)

    expect(sent.map((each) => each.path)).not.toContain(`/payments/${opened?.id ?? ''}/capture`)
    expect(sent.some((each) => each.path.endsWith('/capture'))).toBe(false)
    expect(sent.some((each) => each.path.endsWith('/authorize'))).toBe(false)
  })
})

describe('결제창이 열리지 않았을 때', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', CLIENT_KEY)
  })

  it('says so, keeps the hold, and offers another go', async () => {
    const user = userEvent.setup()

    vi.mocked(openTossCheckout).mockRejectedValue(new Error('blocked'))

    await renderCheckout()
    await chooseToss(user)
    await order(user)

    expect(await screen.findByText(pay.refusals.toss_unavailable)).toBeVisible()
    // 아직 아무 돈도 움직이지 않았다. 예약이 남아 있다는 것을 먼저 말한다 (4.3).
    expect(screen.getByText(pay.holdKept)).toBeVisible()
    expect(screen.getByRole('button', { name: pay.retry })).toBeVisible()
  })

  it('lets a virtual card finish the same order, without ordering twice', async () => {
    const user = userEvent.setup()

    vi.mocked(openTossCheckout).mockRejectedValue(new Error('blocked'))

    await renderCheckout()

    const section = await chooseToss(user)

    await order(user)
    await screen.findByText(pay.holdKept)

    await user.click(
      within(section).getByRole('radio', { name: new RegExp(roomyCard().brand, 'u') }),
    )
    await user.click(screen.getByRole('button', { name: pay.retry }))

    expect(await screen.findByText(pay.paidTitle)).toBeVisible()
    expect(sent.filter((each) => each.path === '/orders')).toHaveLength(1)
  })
})

describe('아무 요청도 나가지 않는 경우', () => {
  it('does not open a payment when there is no client key, even if asked', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await paymentSection()
    await order(user)

    await screen.findByText(pay.paidTitle)

    // 키가 없으면 토스는 고를 수조차 없으므로 결제창도 열리지 않는다 — 가상 카드로
    // 전체 흐름이 완결된다는 것이 4.1 이 약속하는 기본 상태다.
    expect(vi.mocked(openTossCheckout)).not.toHaveBeenCalled()
    expect(
      sent.filter((each) => each.path === '/payments').map((each) => each.body),
    ).not.toContainEqual(expect.objectContaining({ provider: 'TOSS' }))
  })
})
