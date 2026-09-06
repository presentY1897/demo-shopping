/**
 * 주문서의 쿠폰 (TASK-0075).
 *
 * **금액은 화면이 세지 않는다.** 쿠폰을 고르는 일이 곧 주문서를 다시 읽는 일이고,
 * 합계는 서버가 답한 값이다 — 그래서 이 파일이 재는 것의 절반은 「고른 것이 쿼리에
 * 실려 나가고, 돌아온 금액이 그려지는가」다. 화면에서 계산했다면 목 서버를 아무 값도
 * 주지 않게 해도 이 검사들이 통과했을 것이고, 그것이 이 TASK 가 막으려는 상태다.
 *
 * **못 쓰는 쿠폰이 화면에 남는다** (F2). 여섯 가지 사유에 여섯 문장이 붙는지를
 * 하나씩 확인하는 이유는, 다섯만 붙어 있어도 화면은 멀쩡해 보이기 때문이다 —
 * 빠진 하나를 가진 사람만 아무 설명 없는 회색 줄을 본다.
 *
 * **경합 둘이 여기 있다.** 고르는 순간의 400 과 주문하는 순간의 409 는 사람이
 * 아무것도 잘못하지 않은 실패이고, 목이 그 둘을 **한 사실**에서 만들어 낸다
 * (`spendCouponElsewhere`).
 */

import {
  emptyCheckoutCoupons,
  httpFailure,
  mockPaths,
  resetCheckoutStore,
  resetPaymentStore,
  seedCheckoutCoupons,
  sessionBuyer,
  shopperCheckout,
  shopperCheckoutCoupons,
  spendCouponElsewhere,
} from '@shopping/api-mocks'
import type { CouponApplicabilityFault } from '@shopping/shared'
import { DensityProvider } from '@shopping/ui/density'
import { formatMoney } from '@shopping/ui/format'
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
const coupon = copy.coupon
const { checkout } = shopperCheckout

/**
 * 씨앗 쿠폰을 이름으로 집는다.
 *
 * 이름을 여기 다시 적지 않고 픽스처에서 꺼내는 이유는 `checkout-payment.spec.tsx`
 * 가 카드에서 하는 것과 같다 — 이 검사가 재려는 것은 「첫 주문 10% 할인이
 * 보인다」가 아니라 **「서버가 준 쿠폰이 보인다」**이다.
 */
function seed(name: string) {
  const found = shopperCheckoutCoupons.coupons.find(
    (entry) => entry.userCoupon.coupon.name === name,
  )

  if (found === undefined) throw new Error(`픽스처에 「${name}」 쿠폰이 없다`)

  return found
}

const WELCOME = seed('첫 주문 10% 할인')
const AUTUMN = seed('가을 맞이 5천원')
const LUMIERE = seed('루미에르 10% 할인')
const NODESTEP = seed('노드스텝 3천원')

/** 쿠폰 없는 결제예정금액. 픽스처에서 온다 — 여기 숫자를 적으면 두 벌이 된다. */
const TOTAL = checkout.paidAmount

/** 보낸 요청. 「고른 것이 쿼리에 실렸나」를 세는 데 쓴다. */
let sent: string[] = []

/** 원. 화면이 `Intl` 로 그리므로 검사도 같은 함수로 기대값을 만든다. */
function won(amount: number): string {
  return formatMoney({ amount, currency: 'KRW' })
}

/**
 * 앞 검사의 해제 신호를 흘려보내고 주문서를 다시 연다.
 *
 * 쿠폰함을 **렌더 전에** 갈아 끼운다. `resetCheckoutStore` 가 씨앗으로 되돌리므로
 * 그 뒤여야 하고, 첫 조회가 나가기 전이어야 한다 — 렌더 뒤에 끼우면 어느 쪽이
 * 먼저 도착했는지에 따라 검사가 갈린다.
 */
async function renderCheckout(coupons?: typeof shopperCheckoutCoupons) {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  resetCheckoutStore()
  resetPaymentStore()
  if (coupons !== undefined) seedCheckoutCoupons(coupons)

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

/** 쿠폰이 도착한 영역. 목록은 주문서와 **따로** 오므로 기다린다. */
async function couponSection(): Promise<HTMLElement> {
  const section = await screen.findByRole('region', { name: coupon.title })

  await within(section).findByRole('group', { name: coupon.choose })

  return section
}

function summary(): HTMLElement {
  return screen.getByRole('complementary', { name: copy.summaryTitle })
}

/** 쿠폰 한 장을 누른다. 체크박스의 이름은 쿠폰 이름으로 시작한다. */
async function choose(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const section = await couponSection()

  await user.click(within(section).getByRole('checkbox', { name: new RegExp(name, 'u') }))
}

/** 「고른 것이 실린 주문서 조회」가 몇 번 나갔나. */
function pricedWith(ids: readonly string[]): number {
  return sent.filter(
    (each) => each === `GET /checkouts/${checkout.id}?userCouponIds=${ids.join(',')}`,
  ).length
}

beforeEach(() => {
  resetDensity()
  resetCheckoutStore()
  resetPaymentStore()
  sent = []
  testServer.server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url)

    sent.push(`${request.method} ${url.pathname.replace('/api/v1', '')}${url.search}`)
  })
  // **`Date` 만 가짜로 만든다** — `checkout-page.spec.tsx` 가 그 이유를 적는다.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(new Date(checkout.expiresAt).getTime() - 10 * 60 * 1000))
})

afterEach(() => {
  testServer.server.events.removeAllListeners('request:start')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('쿠폰함 (F2)', () => {
  it('lists what can be used, with what it takes off and when it ends', async () => {
    await renderCheckout()

    const section = await couponSection()

    // 할인액은 「이 장 하나만 썼을 때」다 (계약). 정률 쿠폰의 상한이 실제로 걸린
    // 값이라 47,400원이 아니라 20,000원이다.
    expect(within(section).getByText(/20,000 할인/u)).toBeVisible()
    expect(within(section).getByText(/30,000 할인/u)).toBeVisible()
    expect(
      within(section).getByRole('checkbox', {
        name: new RegExp(WELCOME.userCoupon.coupon.name, 'u'),
      }),
    ).toBeEnabled()
  })

  it('shows the coupons that cannot be used rather than hiding them', async () => {
    await renderCheckout()

    const section = await couponSection()

    // 열 장 전부가 화면에 있다. 목록에서 빼면 「분명히 쿠폰이 있었는데
    // 없어졌다」가 되고, 그 사람이 다음에 할 일을 화면이 말해 줄 수 없다.
    expect(within(section).getAllByRole('checkbox')).toHaveLength(
      shopperCheckoutCoupons.coupons.length,
    )
    expect(within(section).getByText(coupon.unusableTitle)).toBeVisible()
  })

  /**
   * 사유 여섯에 문장 여섯.
   *
   * 하나로 뭉치면 「사용할 수 없는 쿠폰입니다」가 되고, 그 문장은 더 담으면 되는
   * 사람과 다음 달을 기다리면 되는 사람 모두에게 틀린 말을 한다.
   */
  it.each([
    ['already_used', '이미 쓴 1만원'],
    ['expired', '여름 마감 5% 할인'],
    ['not_started', '10월 오픈 2만원'],
    ['out_of_scope', '아틀리에케이 15% 할인'],
    ['below_minimum', '100만원 이상 5만원'],
    ['no_discount', '노드스텝 1% 할인'],
  ] as const satisfies readonly (readonly [CouponApplicabilityFault, string])[])(
    'says why a %s coupon cannot be used, and refuses to choose it',
    async (fault, name) => {
      await renderCheckout()

      const section = await couponSection()

      expect(within(section).getByRole('checkbox', { name: new RegExp(name, 'u') })).toBeDisabled()
      expect(within(section).getByText(coupon.faults[fault])).toBeVisible()
    },
  )

  it('says so when there is not a single coupon to use', async () => {
    await renderCheckout(emptyCheckoutCoupons)

    const section = await screen.findByRole('region', { name: coupon.title })

    // 「불러오지 못했다」와 다른 말이어야 한다 — 한쪽은 다시 시도할 일이고 다른
    // 쪽은 아무것도 할 일이 없다.
    expect(await within(section).findByText(coupon.none)).toBeVisible()
  })

  it('keeps the order possible when the coupon list cannot be read', async () => {
    testServer.server.use(httpFailure(mockPaths.checkoutCoupons, 500, 'INTERNAL_ERROR', 'nope'))

    await renderCheckout()

    const section = await screen.findByRole('region', { name: coupon.title })

    // 쿠폰을 못 읽었다고 주문서를 오류 화면으로 바꾸지 않는다 — 그러면 살 수
    // 있었던 사람이 아무것도 못 하게 된다. 배송지·카드와 같은 판단이고, 문장이
    // 「쿠폰 없이 주문할 수 있어요」로 끝나는 것이 그 판단의 사용자 쪽 얼굴이다.
    expect(await within(section).findByText(coupon.failed)).toBeVisible()
    expect(within(summary()).getByRole('button', { name: copy.placeOrder })).toBeVisible()
  })
})

describe('고르면 금액이 다시 온다', () => {
  it('sends the choice as a query and draws what the server priced', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await choose(user, WELCOME.userCoupon.coupon.name)

    // 20,000원이 빠진 금액이 화면에 있고, 그 숫자를 만든 것은 이 요청이다.
    expect(await within(summary()).findByText(/456,500/u)).toBeVisible()
    expect(pricedWith([WELCOME.userCoupon.id])).toBe(1)
  })

  it('names each applied coupon beside the total', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await choose(user, LUMIERE.userCoupon.coupon.name)

    // 장별로 적는 이유는 계약이 `appliedCoupons` 를 장별로 싣는 이유와 같다 —
    // 두 장이 겹쳐 덮여 뒤엣것이 잘린 사정이 드러나는 자리가 여기뿐이다.
    const panel = summary()

    expect(await within(panel).findByText(LUMIERE.userCoupon.coupon.name)).toBeVisible()
    expect(
      within(panel).getByText(copy.appliedCouponAmount.replace('{amount}', won(30_000))),
    ).toBeVisible()
  })

  it('says how many coupons are on and what they took off', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await choose(user, AUTUMN.userCoupon.coupon.name)

    const section = await couponSection()

    expect(
      await within(section).findByText(
        coupon.applied.replace('{count}', '1').replace('{amount}', won(5_000)),
      ),
    ).toBeVisible()
  })

  it('takes a coupon back off and returns to the full price', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await choose(user, WELCOME.userCoupon.coupon.name)
    await within(summary()).findByText(/456,500/u)

    await choose(user, WELCOME.userCoupon.coupon.name)

    expect(await within(summary()).findByText(/476,500/u)).toBeVisible()
    expect(TOTAL).toBe(476_500)
  })
})

describe('중복 규칙이 화면에서 보인다', () => {
  it('swaps one platform coupon for the other', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await choose(user, WELCOME.userCoupon.coupon.name)
    await within(summary()).findByText(/456,500/u)

    await choose(user, AUTUMN.userCoupon.coupon.name)

    // 막지 않고 밀어낸다. 어느 장이 빠졌는지는 체크가 그대로 보여 준다.
    const section = await couponSection()

    expect(
      within(section).getByRole('checkbox', {
        name: new RegExp(AUTUMN.userCoupon.coupon.name, 'u'),
      }),
    ).toBeChecked()
    expect(
      within(section).getByRole('checkbox', {
        name: new RegExp(WELCOME.userCoupon.coupon.name, 'u'),
      }),
    ).not.toBeChecked()
    expect(await within(summary()).findByText(/471,500/u)).toBeVisible()
  })

  it('keeps a platform coupon and a seller coupon together', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await choose(user, WELCOME.userCoupon.coupon.name)
    await within(summary()).findByText(/456,500/u)

    await choose(user, NODESTEP.userCoupon.coupon.name)

    // 20,000 + 3,000 = 23,000. 서로 다른 자리라 함께 산다.
    expect(await within(summary()).findByText(/453,500/u)).toBeVisible()
  })
})

describe('최대 할인 적용 (F7)', () => {
  it('takes the combination the server worked out', async () => {
    const user = userEvent.setup()

    await renderCheckout()

    const section = await couponSection()

    expect(
      within(section).getByText(coupon.recommendAmount.replace('{amount}', won(53_000))),
    ).toBeVisible()

    await user.click(within(section).getByRole('button', { name: coupon.recommend }))

    // 조합을 화면이 고르지 않는다 — `recommendation.userCouponIds` 를 그대로
    // 넘긴다. 그래서 나가는 쿼리가 추천의 순서 그대로여야 한다.
    expect(await within(summary()).findByText(/423,500/u)).toBeVisible()
    expect(pricedWith(shopperCheckoutCoupons.recommendation.userCouponIds)).toBe(1)
  })

  it('offers no such button when there is nothing to recommend', async () => {
    await renderCheckout(emptyCheckoutCoupons)

    const section = await screen.findByRole('region', { name: coupon.title })

    await within(section).findByText(coupon.none)

    // 눌러도 아무 일이 없는 버튼은, 쓸 쿠폰이 없다는 사실을 가장 알아보기 어렵게
    // 말하는 방법이다.
    expect(within(section).queryByRole('button', { name: coupon.recommend })).toBeNull()
  })
})

describe('경합 — 목록을 읽은 뒤에 그 쿠폰이 쓰였다', () => {
  it('reverts the choice and keeps the order possible (400)', async () => {
    const user = userEvent.setup()

    await renderCheckout()

    // 화면에서는 만들 수 없는 상태다. 목록이 「쓸 수 있다」고 말한 장만 고를 수
    // 있으므로, 그 사이에 다른 주문이 태웠다는 사실은 밖에서 넣는다.
    spendCouponElsewhere(LUMIERE.userCoupon.id)

    await choose(user, LUMIERE.userCoupon.coupon.name)

    const section = await couponSection()

    expect(await within(section).findByText(coupon.rejected)).toBeVisible()
    // **빈 화면이 되지 않는다.** 쿠폰 한 장 때문에 살 수 있었던 주문서가 통째로
    // 오류 화면이 되면, 그 사람은 아무것도 할 수 없다.
    expect(within(summary()).getByRole('button', { name: copy.placeOrder })).toBeVisible()
    expect(within(summary()).getByText(/476,500/u)).toBeVisible()
  })

  it('re-reads the list so the same choice is not offered again', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    spendCouponElsewhere(LUMIERE.userCoupon.id)

    await choose(user, LUMIERE.userCoupon.coupon.name)

    const section = await couponSection()

    await within(section).findByText(coupon.rejected)

    // 되돌리기만 하고 두면 같은 사람이 같은 장을 한 번 더 골라 같은 거절을 받는다.
    expect(
      await within(section).findByRole('checkbox', {
        name: new RegExp(LUMIERE.userCoupon.coupon.name, 'u'),
      }),
    ).toBeDisabled()
  })

  it('says which coupon lost the race when the order itself is refused (409)', async () => {
    const user = userEvent.setup()

    await renderCheckout()
    await choose(user, NODESTEP.userCoupon.coupon.name)
    await within(summary()).findByText(/473,500/u)

    // 주문서를 읽을 때는 멀쩡했고, 주문하는 사이에 태워졌다.
    spendCouponElsewhere(NODESTEP.userCoupon.id)

    await user.click(within(summary()).getByRole('checkbox', { name: copy.termsLabel }))
    await user.click(within(summary()).getByRole('button', { name: copy.placeOrder }))

    // 「주문하지 못했어요」가 아니다 — 그 문장을 읽은 사람은 장바구니부터 다시
    // 하지만, 이 사람이 할 일은 그 한 장을 빼는 것뿐이다.
    expect(await screen.findByText(copy.placeFailures.coupon_already_used)).toBeVisible()
    expect(screen.queryByText(copy.payment.paidTitle)).toBeNull()
  })
})
