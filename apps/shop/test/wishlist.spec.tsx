/**
 * 찜 (TASK-0086 F1 · F2 · F3 · F4 · F5 · F6).
 *
 * **API 대역이 이 저장소의 msw 가 아니다.** `packages/api-mocks` 에 찜 라우트의
 * 핸들러가 아직 없고 그것을 더하는 일은 이 갈래의 소유가 아니라서, `globalThis.fetch`
 * 를 감싸 그 경로만 가로챈다 — 대역이 내보내는 답은 **계약 스키마를 지나므로** 서버가
 * 보낼 수 없는 모양에 화면과 함께 합의하는 일은 생기지 않는다
 * (`test/support/community.ts` 의 머리말이 그 이음매를 적고 있다).
 *
 * **이 파일이 확인하는 것 다섯으로 줄이면**:
 *
 * ① **버튼이 즉시 반영되고, 새로고침 뒤에도 그대로다** (F1). 「그대로」는 `GET
 *    /me/wishlist/ids` 한 번으로 이뤄지고, 그 답에 **페이지가 없다는 것**이 요점이다 —
 *    목록으로 하면 101개를 담은 사람의 화면만 조용히 틀린다 (4.5).
 * ② **실패하면 되돌린다** (F2). 낙관적으로 바꾼 것이 원래 값으로 돌아오고 줄이 하나 붙는다.
 * ③ **로그인하지 않은 사람은 401 을 만나지 않는다** (F6). 그 자리는 버튼이 아니라 링크다.
 * ④ **품절 줄에 재입고 알림이 붙는다** (F4). 신청은 찜한 것에만 걸 수 있다.
 * ⑤ **가격 변동을 문장으로 말한다** (F5). 두 숫자를 나란히 놓고 빼기를 시키지 않는다.
 */

import { SEARCH_CATALOGUE, sessionBuyer } from '@shopping/api-mocks'
import type { WishlistItem } from '@shopping/shared'
import { WISHLIST_MAX_LIMIT } from '@shopping/shared'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WishlistButton } from '@/components/collections/wishlist-button'
import { WishlistScreen } from '@/components/collections/wishlist-screen'
import { ProductSection } from '@/components/home/product-section'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import type { CommunityApiStub } from './support/community'
import {
  MOCK_DETAIL_PRODUCT_ID,
  MOCK_SOLD_OUT_PRODUCT_ID,
  MOCK_WISHLIST,
  resetCommunityStores,
  stubCommunityApi,
} from './support/community'
import { renderAccountScreen, resetDensity } from './support/mypage'
import { navigation } from './support/navigation'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const messages = messagesFor()
const button = messages.collections.wishlist
const screenCopy = messages.mypage.wishlist

/** 홈 섹션이 그리는 첫 카드. 대역의 정렬은 안정적이라 언제나 이 상품이다. */
const FIRST_CARD = SEARCH_CATALOGUE[0]!.hit

/** 찜 `count` 줄. **한 쪽에 안 들어가는 수**를 만들기 위한 것이다 (4.5). */
function bulkWishlist(count: number): WishlistItem[] {
  return Array.from({ length: count }, (_unused, index) => ({
    productId: `019596d0-1f1c-7c2e-9a0e-90${String(index).padStart(10, '0')}`,
    productName: `상품 ${String(index)}`,
    brandName: '루미크',
    thumbnailUrl: null,
    price: 10_000,
    addedPrice: 10_000,
    soldOut: false,
    notifyRestock: false,
    addedAt: '2026-09-01T00:00:00.000Z',
  }))
}

let stub: CommunityApiStub

beforeEach(() => {
  localStorage.clear()
  resetDensity()
  resetCommunityStores()
  stub = stubCommunityApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F1 · F6 찜 버튼', () => {
  it('sends somebody signed out to sign-in rather than to a 401 (F6)', async () => {
    renderWithAuth(<WishlistButton copy={button} productId={MOCK_DETAIL_PRODUCT_ID} />)

    // 비로그인 찜을 로컬에 담지 않는 것은 R1 의 판단이다 — 장바구니와 달리 구매
    // 흐름을 막지 않는다.
    const link = await screen.findByRole('link', { name: button.signIn })

    expect(link).toHaveAttribute('href', expect.stringContaining('/login'))
    expect(screen.queryByRole('button', { name: button.add })).toBeNull()
  })

  it('asks once for the ids, so a reload keeps the state (F1)', async () => {
    renderWithAuth(<WishlistButton copy={button} productId={MOCK_DETAIL_PRODUCT_ID} />, {
      session: sessionBuyer,
    })

    // 상품 하나를 묻는 문이 계약에 없다. 「무엇을 담았나」를 한 번에 받아 두는 것이
    // 그 물음에 답하는 방법이고, 그래서 새 창에서 열어도 하트가 눌린 채로 그려진다.
    const pressed = await screen.findByRole('button', { name: button.added })

    expect(pressed).toHaveAttribute('aria-pressed', 'true')
  })

  it('flips at once and keeps the answer, not its own guess (F1)', async () => {
    const user = userEvent.setup()

    renderWithAuth(<WishlistButton copy={button} productId={MOCK_DETAIL_PRODUCT_ID} />, {
      session: sessionBuyer,
    })

    await user.click(await screen.findByRole('button', { name: button.added }))

    // 답이 곧 지금 상태다 — 화면이 세면 다른 탭에서 이미 뺀 것이 반영되지 않는다.
    const released = await screen.findByRole('button', { name: button.add })

    expect(released).toHaveAttribute('aria-pressed', 'false')
  })

  it('knows a product past the list’s first page, which is where this broke (F1)', async () => {
    // 목록은 한 쪽이 100개까지다. 이 사람은 150개를 담았고, 묻는 상품은 **101번째
    // 뒤**에 있다 — 표를 목록으로 채우던 시절 이 하트는 새로고침할 때마다 빈 채로
    // 그려졌고 오류는 한 줄도 뜨지 않았다 (4.5).
    const items = bulkWishlist(WISHLIST_MAX_LIMIT + 50)
    const beyond = items.at(-1)!.productId

    stub = stubCommunityApi({ wishlist: items })
    renderWithAuth(<WishlistButton copy={button} productId={beyond} />, { session: sessionBuyer })

    expect(await screen.findByRole('button', { name: button.added })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // 그리고 그 답은 **페이지가 없는 문**에서 왔다. 목록을 읽었다면 커서가 필요했을
    // 것이고, 그 커서가 바로 틀림의 출처였다.
    expect(stub.requests.some((one) => one.url.pathname.endsWith('/me/wishlist/ids'))).toBe(true)
    expect(stub.requests.some((one) => one.url.pathname.endsWith('/me/wishlist'))).toBe(false)
  })

  it('rolls back and says so when the toggle is refused (F2)', async () => {
    const user = userEvent.setup()

    renderWithAuth(<WishlistButton copy={button} productId={MOCK_DETAIL_PRODUCT_ID} />, {
      session: sessionBuyer,
    })

    await screen.findByRole('button', { name: button.added })
    stub.state.refuseNextWrite = { status: 500, code: 'INTERNAL_ERROR', message: '서버 오류' }

    await user.click(screen.getByRole('button', { name: button.added }))

    // 되돌린 것만으로는 아무 일도 없었던 것처럼 보이고, 사람은 자기가 잘못 눌렀다고
    // 읽는다. 그래서 줄이 하나 붙는다.
    expect(await screen.findByText(button.failedNotice)).toBeVisible()
    expect(screen.getByRole('button', { name: button.added })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

describe('F3 · F4 · F5 위시리스트 화면', () => {
  async function openScreen() {
    renderAccountScreen(<WishlistScreen messages={messages.mypage} />, { session: sessionBuyer })

    return screen.findByRole('list', { name: screenCopy.listLabel })
  }

  function row(list: HTMLElement, name: string): HTMLElement {
    const found = within(list)
      .getAllByRole('listitem')
      .find((item) => within(item).queryByText(name) !== null)

    if (found === undefined) throw new Error(`${name} 줄을 찾지 못했습니다.`)

    return found
  }

  it('lists what was put aside (F3)', async () => {
    const list = await openScreen()

    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('says how much the price moved, in won (F5)', async () => {
    const list = await openScreen()
    const coat = row(list, '울 블렌드 코트')

    // 담을 때 99,000 이던 것이 89,000 이다. 두 숫자를 나란히 그려 놓고 사람에게
    // 빼기를 시키지 않는다.
    expect(within(coat).getByText(/10,000/)).toBeVisible()
  })

  it('marks the sold-out row and offers the restock alert there (F4)', async () => {
    const user = userEvent.setup()
    const list = await openScreen()
    const scarf = row(list, '캐시미어 머플러')

    expect(within(scarf).getByText(screenCopy.soldOut)).toBeVisible()
    expect(within(scarf).getByText(screenCopy.noPrice)).toBeVisible()

    await user.click(within(scarf).getByRole('button', { name: screenCopy.restockOn }))

    // 답이 곧 지금 상태다. 버튼 이름이 바뀌고, 그 아래에 무엇이 일어나는지가 붙는다.
    expect(await within(scarf).findByRole('button', { name: screenCopy.restockOff })).toBeVisible()
    expect(within(scarf).getByText(screenCopy.restockNotice)).toBeVisible()
  })

  it('does not offer the restock alert on a row that is in stock', async () => {
    const list = await openScreen()
    const coat = row(list, '울 블렌드 코트')

    // 신청은 품절 화면에만 있다 — 살 수 있는 상품에 재입고 알림은 할 일이 아니다.
    expect(within(coat).queryByRole('button', { name: screenCopy.restockOn })).toBeNull()
    expect(within(coat).getByRole('link', { name: screenCopy.openProduct })).toHaveAttribute(
      'href',
      `/products/${MOCK_DETAIL_PRODUCT_ID}`,
    )
  })

  it('takes the row out when the toggle answers 「해제됨」', async () => {
    const user = userEvent.setup()
    const list = await openScreen()
    const coat = row(list, '울 블렌드 코트')

    await user.click(
      within(coat).getByRole('button', {
        name: screenCopy.removeLabel.replace('{name}', '울 블렌드 코트'),
      }),
    )

    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    })
    expect(stub.state.wishlist.map((item) => item.productId)).toEqual([MOCK_SOLD_OUT_PRODUCT_ID])
  })

  it('says the cart needs an option rather than choosing one for you', async () => {
    const list = await openScreen()

    // 장바구니는 조합을 받는데(`variantId`) 찜 목록의 줄은 상품이라 조합이 없다.
    expect(within(list).getAllByText(screenCopy.openProductHint).length).toBeGreaterThan(0)
  })
})

describe('목록 카드의 하트 (4.6)', () => {
  /**
   * 홈의 한 섹션. 카드의 하트는 **셋**을 말한다 — 담김 · 안 담김 · 아직 모름 — 이고,
   * 셋째를 둘째와 같이 그리면 담아 둔 카드가 새로고침마다 한 번씩 비었다가 찬다.
   */
  function renderSection(signedIn: boolean) {
    return renderWithAuth(
      <DensityProvider>
        <ProductSection
          href="/search?sort=newest"
          messages={messages.home}
          sort="newest"
          title={messages.home.newTitle}
        />
      </DensityProvider>,
      { session: signedIn ? sessionBuyer : null },
    )
  }

  async function grid(): Promise<HTMLElement> {
    return screen.findByRole('list', {
      name: messages.home.gridLabel.replace('{title}', messages.home.newTitle),
    })
  }

  /** 첫 카드의 하트를, 지금 그 하트가 불리는 이름으로. */
  async function heart(label: string): Promise<HTMLElement> {
    await grid()

    return screen.findByRole('button', { name: label.replace('{name}', FIRST_CARD.name) })
  }

  it('names each heart after its own product, so twenty of them are not one name', async () => {
    renderSection(true)
    await grid()

    // 그리드에 스무 개가 있다. 이름이 전부 같으면 음성 제어도 스크린 리더도 어느
    // 것인지 말할 수 없다.
    const [first] = screen.getAllByRole('button', { name: /찜하기$/ })

    expect(first).toHaveAccessibleName(expect.stringMatching(/.+ 찜하기$/))
  })

  it('draws a card already put aside as pressed (F1)', async () => {
    stub = stubCommunityApi({
      wishlist: [{ ...MOCK_WISHLIST[0]!, productId: FIRST_CARD.id, productName: FIRST_CARD.name }],
    })
    renderSection(true)

    // 이 카드가 「찜하기」로 그려지면 새로고침한 사람은 담아 둔 것을 다시 담으려
    // 누르고, 그것은 빼는 일이 된다.
    expect(await heart(messages.home.card.wishlistOn)).toHaveAttribute('aria-pressed', 'true')
  })

  it('says nothing about pressed state when it cannot know (4.6)', async () => {
    navigation.start('/')
    renderSection(false)

    // 로그인하지 않은 사람의 찜은 물어볼 수조차 없다. `aria-pressed="false"` 를
    // 적으면 「누르지 않은 버튼」이라고 **말하는** 것이고, 말하지 않는 편이 참이다.
    expect(await heart(messages.home.card.wishlist)).not.toHaveAttribute('aria-pressed')
  })

  it('flips the heart at once and keeps the answer, not its own guess (F1)', async () => {
    const user = userEvent.setup()

    stub = stubCommunityApi({ wishlist: [] })
    renderSection(true)

    await user.click(await heart(messages.home.card.wishlist))

    expect(await heart(messages.home.card.wishlistOn)).toHaveAttribute('aria-pressed', 'true')
    expect(
      stub.requests.some(
        (one) => one.method === 'POST' && one.url.pathname.includes('/me/wishlist/'),
      ),
    ).toBe(true)
  })

  it('rolls the heart back and says so when the toggle is refused (F2)', async () => {
    const user = userEvent.setup()

    stub = stubCommunityApi({ wishlist: [] })
    renderSection(true)

    await heart(messages.home.card.wishlist)
    stub.state.refuseNextWrite = { status: 500, code: 'INTERNAL_ERROR', message: '서버 오류' }

    await user.click(await heart(messages.home.card.wishlist))

    // 되돌아간 하트는 「원래 그랬던 것」과 구별되지 않는다 — `aria-pressed` 가 실패를
    // 말할 수 없는 자리이고, 그래서 이 줄 하나만 남았다.
    expect(await screen.findByText(button.failedNotice)).toBeVisible()
    expect(await heart(messages.home.card.wishlist)).toHaveAttribute('aria-pressed', 'false')
  })

  it('takes a visitor to sign-in rather than to a 401 (F6)', async () => {
    const user = userEvent.setup()

    navigation.start('/')
    renderSection(false)

    await user.click(await heart(messages.home.card.wishlist))

    // 카드의 하트는 버튼이라 링크로 바꿀 수 없다. 그래서 이동은 여기서 일어나고,
    // 지금 보던 주소가 `next` 로 따라간다.
    expect(navigation.push).toHaveBeenCalledWith('/login?next=%2F')
    expect(stub.requests.some((one) => one.method === 'POST')).toBe(false)
  })
})
