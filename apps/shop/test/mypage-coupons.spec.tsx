/**
 * `/mypage/coupons` — 쿠폰함 (TASK-0077 F1 · F2 · F3 · F7).
 *
 * **이 파일이 재는 것의 중심은 F3 이다.** 서버는 코드 등록의 거절을 일곱으로 갈라
 * 답하는데, 화면이 그것을 하나로 덮으면 계약이 나눈 일이 화면에서 없던 일이 된다 —
 * 기다리면 되는 사람과 포기해야 하는 사람이 같은 문장을 받는다. 그래서 일곱을 하나씩
 * 물어본다.
 *
 * 목이 **상태를 갖는다.** 코드를 넣으면 목록이 한 장 늘고 배지의 수가 함께 오른다.
 * 얼어붙은 픽스처로는 그중 어느 것도 물어볼 수 없다: 「받고 나면 무엇이 달라지는가」가
 * F3 이 실제로 묻는 것이다.
 *
 * **화면이 로딩을 지나온 뒤에 단언한다.** 제목은 불러오는 동안에도 그려지는 값이라
 * 그것만 기다린 헬퍼는 아무것도 기다리지 않는다 (`cart-page.spec.tsx` 가 그 함정을 이미
 * 적어 두었다).
 */

import {
  httpFailureOn,
  MOCK_CLAIM_OUTCOMES,
  MOCK_CLAIMABLE_COUPON_CODE,
  MOCK_COUPON_BOX_NOW,
  MOCK_COUPON_BOX_PAGE_SIZE,
  mockCouponBoxSeedAt,
  mockPaths,
  resetCouponBoxStore,
  sessionBuyer,
} from '@shopping/api-mocks'
import { http } from 'msw'
import { COUPON_EXPIRING_SOON_DAYS, COUPON_CODE_INPUT_MAX_LENGTH } from '@shopping/shared'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { formatMoney } from '@shopping/ui/format'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CouponsPage from '@/app/mypage/coupons/page'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/coupons' }))

const messages = messagesFor()
const copy = messages.mypage.coupons
const claimCopy = copy.claim

const won = (amount: number): string => formatMoney({ amount, currency: 'KRW' })

/** 만료 임박 한 장, 정률 한 장, 코드가 붙은 한 장, 쓴 장, 만료된 장. */
const EXPIRING = mockCouponBoxSeedAt(0)
const PERCENT = mockCouponBoxSeedAt(1)
const WELCOME = mockCouponBoxSeedAt(2)
const SPENT = mockCouponBoxSeedAt(3)
const EXPIRED = mockCouponBoxSeedAt(4)

/**
 * 쿠폰함을 연다.
 *
 * **목록이 도착할 때까지 기다린다.** 빈 씨앗이면 목록 대신 빈 상태가 오므로 그쪽을
 * 기다린다 — 제목을 기다리는 헬퍼는 화면이 아직 「불러오는 중」인 상태에서 돌아오고,
 * 그 뒤의 동기 조회는 러너가 붐비는 날에만 실패한다.
 */
async function openBox(seeds: readonly (typeof EXPIRING)[] | null = null): Promise<UserEvent> {
  resetCouponBoxStore(seeds ?? undefined)

  const user = userEvent.setup()

  renderAccountScreen(<CouponsPage />, { session: sessionBuyer })
  await screen.findByRole('heading', { level: 1, name: copy.title })

  if (seeds !== null && seeds.length === 0) await screen.findByText(copy.empty.ISSUED.title)
  else await screen.findByRole('list', { name: copy.listLabel })

  return user
}

/** 이 쿠폰의 `li`. 장마다 같은 모양의 줄이 있으므로 이름으로 집는다. */
function couponRow(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name })
  const row = heading.closest('li')

  if (row === null) throw new Error(`${name} 줄을 찾지 못했습니다.`)

  return row
}

/** 탭 하나. 이름에 배지의 수가 붙으므로 정규식으로 앞부분만 본다. */
function tab(name: string): HTMLElement {
  return screen.getByRole('tab', { name: new RegExp(`^${name}`, 'u') })
}

/**
 * 코드 칸.
 *
 * `getByLabelText` 로 찾지 않는다 — 폼의 접근성 이름이 「쿠폰 코드 등록」이라 같은
 * 글자로 두 요소가 걸린다. 역할로 좁히면 그 모호함이 사라진다.
 */
function codeField(): HTMLElement {
  return screen.getByRole('textbox', { name: new RegExp(`^${claimCopy.codeLabel}`, 'u') })
}

/** 코드를 넣고 「쿠폰 받기」를 누른다. */
async function claim(user: UserEvent, code: string): Promise<void> {
  const input = codeField()

  await user.clear(input)
  await user.type(input, code)
  await user.click(screen.getByRole('button', { name: claimCopy.submit }))
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
  // 만료 임박(F2)이 시간의 함수라 「지금」을 대역의 그것에 맞춘다. 그러지 않으면 이
  // 검사는 실행하는 날에 따라 강조를 보기도 하고 못 보기도 한다.
  vi.setSystemTime(new Date(MOCK_COUPON_BOX_NOW))
})

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('탭 셋 (F1)', () => {
  it('starts on 사용 가능 and shows only the cards that can be used', async () => {
    await openBox()

    expect(tab(copy.tabs.ISSUED)).toHaveAttribute('aria-selected', 'true')

    const list = within(screen.getByRole('list', { name: copy.listLabel }))

    expect(list.getByRole('heading', { level: 3, name: EXPIRING.coupon.name })).toBeVisible()
    expect(list.queryByRole('heading', { level: 3, name: SPENT.coupon.name })).toBeNull()
    expect(list.queryByRole('heading', { level: 3, name: EXPIRED.coupon.name })).toBeNull()
  })

  it('asks the server again for the tab that was chosen', async () => {
    const user = await openBox()

    await user.click(tab(copy.tabs.USED))

    expect(await screen.findByRole('heading', { level: 3, name: SPENT.coupon.name })).toBeVisible()
    // 받은 것 위에서 거른 화면이었다면 이 장은 첫 응답에 들어 있었어야 한다. 서버가
    // 걸러 주므로 「사용 가능」 탭에는 애초에 오지 않았다.
    expect(screen.queryByRole('heading', { level: 3, name: EXPIRING.coupon.name })).toBeNull()
  })

  it('separates the expired ones into their own tab', async () => {
    const user = await openBox()

    await user.click(tab(copy.tabs.EXPIRED))

    expect(
      await screen.findByRole('heading', { level: 3, name: EXPIRED.coupon.name }),
    ).toBeVisible()
  })

  it('badges every tab with a count that does not change when a tab is chosen', async () => {
    const user = await openBox()

    const counted = (name: string): string => tab(name).textContent ?? ''

    expect(counted(copy.tabs.ISSUED)).toContain(copy.tabBadge.replace('{count}', '3'))
    expect(counted(copy.tabs.USED)).toContain(copy.tabBadge.replace('{count}', '1'))
    expect(counted(copy.tabs.EXPIRED)).toContain(copy.tabBadge.replace('{count}', '1'))

    await user.click(tab(copy.tabs.USED))
    await screen.findByRole('heading', { level: 3, name: SPENT.coupon.name })

    // **좁혀도 같다** (계약). 좁혀서 세는 서버였다면 여기서 「사용 가능 0장」이 된다.
    expect(counted(copy.tabs.ISSUED)).toContain(copy.tabBadge.replace('{count}', '3'))
  })

  it('says something different in each empty tab', async () => {
    const user = await openBox([])

    expect(screen.getByText(copy.empty.ISSUED.title)).toBeVisible()
    // 쓸 쿠폰이 없는 사람에게만 갈 곳을 권한다. 「사용함」이 비었다고 상품을 보러
    // 보내는 것은 아무 답도 아니다.
    expect(screen.getByRole('link', { name: copy.emptyAction })).toBeVisible()

    await user.click(tab(copy.tabs.EXPIRED))

    expect(await screen.findByText(copy.empty.EXPIRED.title)).toBeVisible()
    expect(screen.queryByRole('link', { name: copy.emptyAction })).toBeNull()
  })

  it('walks a keyboard through the tabs (U5)', async () => {
    const user = await openBox()

    tab(copy.tabs.ISSUED).focus()
    await user.keyboard('{ArrowRight}{Enter}')

    expect(await screen.findByRole('heading', { level: 3, name: SPENT.coupon.name })).toBeVisible()
  })
})

describe('한 장이 말하는 것', () => {
  it('draws the policy without a second request', async () => {
    await openBox()

    const row = within(couponRow(PERCENT.coupon.name))

    // 정률과 그 상한. 「10% 할인 · 최대 30,000원」이 한 줄에 있다.
    expect(
      row.getByText(new RegExp(copy.discountPercent.replace('{percent}', '10'), 'u')),
    ).toBeVisible()
    expect(
      row.getByText(
        new RegExp(
          copy.maxDiscount.replace('{amount}', won(PERCENT.coupon.maxDiscountAmount ?? 0)),
          'u',
        ),
      ),
    ).toBeVisible()
    expect(
      row.getByText(
        new RegExp(copy.minOrder.replace('{amount}', won(PERCENT.coupon.minOrderAmount)), 'u'),
      ),
    ).toBeVisible()
  })

  it('writes a fixed discount in money, not as a bare number', async () => {
    const user = await openBox()

    // 정액 쿠폰은 둘째 쪽에 있다 — 한 쪽이 두 장이므로.
    await user.click(screen.getByRole('button', { name: copy.loadMore }))
    await screen.findByRole('heading', { level: 3, name: WELCOME.coupon.name })

    const row = within(couponRow(WELCOME.coupon.name))

    expect(
      row.getByText(copy.discountFixed.replace('{amount}', won(WELCOME.coupon.discountValue))),
    ).toBeVisible()
  })

  it('links a used coupon to the order it was spent on', async () => {
    const user = await openBox()

    await user.click(tab(copy.tabs.USED))
    await screen.findByRole('heading', { level: 3, name: SPENT.coupon.name })

    const link = within(couponRow(SPENT.coupon.name)).getByRole('link', {
      name: copy.usedOrderLink.replace('{name}', SPENT.coupon.name),
    })

    expect(link).toHaveAttribute('href', `/mypage/orders/${String(SPENT.orderId)}`)
  })
})

describe('만료 임박 (F2)', () => {
  it('marks the card that dies inside the window, with the days on it', async () => {
    await openBox()

    const remaining = Math.ceil(
      (new Date(EXPIRING.expiresAt).getTime() - new Date(MOCK_COUPON_BOX_NOW).getTime()) /
        (24 * 60 * 60 * 1_000),
    )

    expect(remaining).toBeLessThanOrEqual(COUPON_EXPIRING_SOON_DAYS)
    expect(
      within(couponRow(EXPIRING.coupon.name)).getByText(
        copy.expiringBadge.replace('{days}', String(remaining)),
      ),
    ).toBeVisible()
  })

  it('leaves the others alone, so the mark means something', async () => {
    await openBox()

    // 전부에 붙으면 아무것도 구분하지 못한다 — 경계를 7일로 좁게 잡은 이유가 그것이다.
    const marked = screen.getAllByText(
      new RegExp(copy.expiringBadge.replace('{days}', '\\d+'), 'u'),
    )

    expect(marked).toHaveLength(1)
    expect(
      within(couponRow(PERCENT.coupon.name)).queryByText(
        new RegExp(copy.expiringBadge.replace('{days}', '\\d+'), 'u'),
      ),
    ).toBeNull()
  })

  it('never marks an expired card', async () => {
    const user = await openBox()

    await user.click(tab(copy.tabs.EXPIRED))
    await screen.findByRole('heading', { level: 3, name: EXPIRED.coupon.name })

    expect(
      screen.queryByText(new RegExp(copy.expiringBadge.replace('{days}', '\\d+'), 'u')),
    ).toBeNull()
  })
})

describe('코드 등록 (F3)', () => {
  it('takes the code the way a banner prints it and puts the card in the box', async () => {
    const user = await openBox()

    // 하이픈이 붙은 채, 소문자로. 서버가 정규화하므로 화면은 친 값을 그대로 보낸다.
    await claim(user, MOCK_CLAIMABLE_COUPON_CODE.toLowerCase())

    const notice = await screen.findByText(
      claimCopy.claimedNotice.replace('{name}', '신규 가입 감사 10%'),
    )

    expect(notice).toBeVisible()
    expect(
      await screen.findByRole('heading', { level: 3, name: '신규 가입 감사 10%' }),
    ).toBeVisible()
  })

  it('moves the badge, because the box really changed', async () => {
    const user = await openBox()

    await claim(user, MOCK_CLAIMABLE_COUPON_CODE)
    await screen.findByRole('heading', { level: 3, name: '신규 가입 감사 10%' })

    await waitFor(() => {
      expect(tab(copy.tabs.ISSUED).textContent).toContain(copy.tabBadge.replace('{count}', '4'))
    })
  })

  it.each([
    ['WE1C0MEB2X', 'COUPON_ALREADY_ISSUED'],
    ['S00N4K2M9P', 'COUPON_NOT_STARTED'],
    ['PAST5R3T7Q', 'COUPON_ENDED'],
    ['G0NE8H4J2V', 'COUPON_ISSUE_EXHAUSTED'],
    ['H0PD6N3P5W', 'COUPON_SUSPENDED'],
    ['DEM0Y2K4M8', 'COUPON_DEMO_ONLY'],
    ['ZZZZZZZZZZ', 'COUPON_CODE_UNKNOWN'],
  ] as const)('says why %s was refused', async (code, reason) => {
    const user = await openBox()

    await claim(user, code)

    // 일곱이 서로 다른 문장이라는 것이 F3 이다. 하나로 덮으면 계약이 나눈 일이
    // 화면에서 없던 일이 된다.
    expect(await screen.findByText(messages.mypage.errors[reason])).toBeVisible()
  })

  it('keeps the typed code in the field after a refusal (U6)', async () => {
    const user = await openBox()

    await claim(user, 'ZZZZZZZZZZ')
    await screen.findByText(messages.mypage.errors.COUPON_CODE_UNKNOWN)

    // 거절당한 사람에게 코드를 다시 치게 만드는 것은 실패에 대한 벌이다.
    expect(codeField()).toHaveValue('ZZZZZZZZZZ')
  })

  it('refuses an empty field without asking the server (U2)', async () => {
    const posted = countRequests('POST', '/coupons/claims')
    const user = await openBox()

    await user.click(screen.getByRole('button', { name: claimCopy.submit }))

    expect(await screen.findByText(claimCopy.errors.required)).toBeVisible()
    expect(posted()).toBe(0)
  })

  it('refuses something longer than the contract allows, without asking (U2)', async () => {
    const posted = countRequests('POST', '/coupons/claims')
    const user = await openBox()

    await claim(user, 'A'.repeat(COUPON_CODE_INPUT_MAX_LENGTH + 1))

    expect(
      await screen.findByText(
        claimCopy.errors.tooLong.replace('{max}', String(COUPON_CODE_INPUT_MAX_LENGTH)),
      ),
    ).toBeVisible()
    expect(posted()).toBe(0)
  })

  it('has a sentence of its own for every refusal the API can answer with', () => {
    // 위의 표를 손으로 적는 대신 **대역이 만들 수 있는 것 전부**와 맞춰 본다. 거절이
    // 하나 늘었는데 문장이 없으면 그 사람은 서버가 발행자에게 하는 말을 읽게 된다.
    const answerable = Object.values(MOCK_CLAIM_OUTCOMES).flatMap((outcome) =>
      outcome === null ? [] : [outcome.code],
    )

    expect(answerable.filter((code) => !(code in messages.mypage.errors))).toEqual([])
  })

  it('sends one request even if the button is pressed twice (U3)', async () => {
    const posted = countRequests('POST', '/coupons/claims')
    const user = await openBox()

    await user.type(codeField(), MOCK_CLAIMABLE_COUPON_CODE)

    const submit = screen.getByRole('button', { name: claimCopy.submit })

    let release = () => undefined as void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    testServer.server.use(
      http.post(mockPaths.couponClaims, async () => {
        await pending
      }),
    )
    try {
      await user.click(submit)
      await waitFor(() => expect(posted()).toBe(1))
      await user.click(submit)
      expect(posted()).toBe(1)
    } finally {
      release()
    }
    await screen.findByRole('heading', { level: 3, name: '신규 가입 감사 10%' })
    expect(posted()).toBe(1)
  })
})

describe('더 보기', () => {
  it('keeps the first page when the next one arrives', async () => {
    const user = await openBox()

    const first = within(screen.getByRole('list', { name: copy.listLabel })).getAllByRole(
      'listitem',
    )

    expect(first).toHaveLength(MOCK_COUPON_BOX_PAGE_SIZE)

    await user.click(screen.getByRole('button', { name: copy.loadMore }))

    await waitFor(() => {
      expect(
        within(screen.getByRole('list', { name: copy.listLabel })).getAllByRole('listitem'),
      ).toHaveLength(3)
    })
    // 갈아치우면 「더 보기」가 목록을 지우는 버튼이 된다.
    expect(screen.getByRole('heading', { level: 3, name: EXPIRING.coupon.name })).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.loadMore })).toBeNull()
  })

  it('is gone in a tab that has one page', async () => {
    const user = await openBox()

    await user.click(tab(copy.tabs.USED))
    await screen.findByRole('heading', { level: 3, name: SPENT.coupon.name })

    expect(screen.queryByRole('button', { name: copy.loadMore })).toBeNull()
  })
})

describe('불러오지 못했을 때 (U1 · U6)', () => {
  it('offers a retry rather than an empty box', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.meCoupons, 500, 'INTERNAL_ERROR', '문제가 생겼어요.'),
    )

    renderAccountScreen(<CouponsPage />, { session: sessionBuyer })

    expect(await screen.findByText(messages.mypage.loadErrorTitle)).toBeVisible()
    expect(screen.getByText(messages.mypage.errors.INTERNAL_ERROR)).toBeVisible()
    expect(screen.getByRole('button', { name: messages.mypage.retryLabel })).toBeVisible()
    // 빈 쿠폰함으로 보이면 사람은 자기 쿠폰이 사라졌다고 읽는다.
    expect(screen.queryByText(copy.empty.ISSUED.title)).toBeNull()
  })
})

describe('F7 아홉 조합', () => {
  /**
   * 밀도 3 × 뷰포트 3. jsdom 은 아무것도 칠하지 않으므로 「깨짐 0건」을 픽셀로 잴 수
   * 없다 — 잴 수 있는 것은 **완전한 화면인가**이다: 제목, 코드 등록 폼, 탭 셋, 그리고
   * 한 쪽만큼의 쿠폰.
   */
  it.each(
    DENSITY_LEVELS.flatMap((density) =>
      (['mobile', 'tablet', 'desktop'] as const).map((band) => ({ density, band })),
    ),
  )('draws a complete coupon box at density $density on $band', async ({ density, band }) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
    document.documentElement.setAttribute('data-density', String(density))
    stubViewport(VIEWPORTS[band])

    await openBox()

    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
    expect(screen.getByRole('form', { name: claimCopy.title })).toBeVisible()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(
      within(screen.getByRole('list', { name: copy.listLabel })).getAllByRole('listitem'),
    ).toHaveLength(MOCK_COUPON_BOX_PAGE_SIZE)
    expect(
      within(couponRow(EXPIRING.coupon.name)).getByText(
        new RegExp(copy.expiringBadge.replace('{days}', '\\d+'), 'u'),
      ),
    ).toBeVisible()
  })
})

/** 이 경로로 나간 요청의 수. 「보내지 않았다」를 물으려면 세어야 한다. */
function countRequests(method: string, endsWith: string): () => number {
  let seen = 0

  testServer.server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(endsWith)) seen += 1
  })

  return () => seen
}

afterEach(() => {
  testServer.server.events.removeAllListeners()
})
