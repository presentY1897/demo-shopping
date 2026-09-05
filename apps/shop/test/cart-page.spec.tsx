/**
 * 장바구니 화면 (TASK-0046 F1 · F4 · F5 · F7 · F8).
 *
 * 목이 **상태를 갖는다** — 수량을 늘리면 소계가 따라 움직이고, 마지막 줄을 지우면
 * 빈 상태가 나온다. 얼어붙은 픽스처로는 그중 어느 것도 물어볼 수 없다.
 */

import { emptyCart, resetCartStore, sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CartPage from '@/app/cart/page'
import { forgetCartCount } from '@/lib/cart/cart-count'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

const copy = messagesFor().cart

async function renderCart(width: number = VIEWPORTS.desktop) {
  stubViewport(width)

  const result = renderWithAuth(
    <DensityProvider>
      <CartPage />
    </DensityProvider>,
    { session: sessionBuyer },
  )

  await screen.findByRole('heading', { level: 1, name: copy.title })

  return result
}

/** 한 줄의 「+」 버튼. 줄마다 하나씩이라 그 줄 안에서 찾는다. */
function lineOf(name: string): HTMLElement {
  const heading = screen.getByRole('link', { name })
  const row = heading.closest('li')

  if (row === null) throw new Error(`${name} 줄을 찾지 못했습니다.`)

  return row
}

beforeEach(() => {
  resetDensity()
  resetCartStore()
  forgetCartCount()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('판매자별 묶음 (F1)', () => {
  it('draws one section per seller, each with its own shipping line', async () => {
    await renderCart()

    // 마켓플레이스 구조가 눈에 보이는 첫 지점이다. 브랜드명과 배송비가 그룹 머리에
    // 붙는 이유는 그 둘이 판매자 단위이기 때문이다 (D-023).
    expect(await screen.findByRole('region', { name: '루미에르' })).toBeVisible()
    expect(screen.getByRole('region', { name: '노드스텝' })).toBeVisible()
    expect(screen.getByText(copy.freeShipping)).toBeVisible()
  })
})

describe('선택과 합계 (F2 · F4)', () => {
  it('leaves the sold-out line out of the total and says why (F5)', async () => {
    await renderCart()

    const sneakers = lineOf('러너 스니커즈')

    // 지우지 않는다 — 뭘 담았는지 기억하고 재입고를 기다릴 수 있어야 한다.
    expect(within(sneakers).getByText(copy.notices.sold_out)).toBeVisible()
    expect(within(sneakers).getByRole('checkbox')).toBeDisabled()
  })

  it('moves the total when a quantity changes', async () => {
    const user = userEvent.setup()

    await renderCart()

    const knit = lineOf('캐시미어 니트')

    await user.click(within(knit).getByRole('button', { name: copy.increase }))

    // 118,000 × 3 + 189,000 + 49,000 = 592,000. 노드스텝의 배송비 2,500 을 더해
    // 594,500 — 루미에르는 무료 기준을 넘겨 0원이다.
    const summary = screen.getByRole('complementary', { name: copy.totalLabel })

    expect(await within(summary).findByText(/592,000/u)).toBeVisible()
    expect(within(summary).getByText(/594,500/u)).toBeVisible()
  })

  it('refuses to go past the seller’s purchase cap', async () => {
    const user = userEvent.setup()

    await renderCart()

    const coat = lineOf('울 롱코트')

    // 상한 2. 한 번 늘리면 2가 되고 그다음부터 버튼이 잠긴다 — 서버가 거절할
    // 요청을 보내는 대신.
    await user.click(within(coat).getByRole('button', { name: copy.increase }))

    expect(await within(coat).findByText('2')).toBeVisible()
    expect(within(coat).getByRole('button', { name: copy.increase })).toBeDisabled()
  })
})

describe('삭제와 빈 상태 (F7)', () => {
  it('removes one line and keeps the rest', async () => {
    const user = userEvent.setup()

    await renderCart()

    await user.click(
      within(lineOf('울 머플러')).getByRole('button', {
        name: copy.removeItem.replace('{name}', '울 머플러'),
      }),
    )

    expect(await screen.findByRole('region', { name: '루미에르' })).toBeVisible()
    expect(screen.queryByRole('link', { name: '울 머플러' })).toBeNull()
  })

  it('shows the empty state once nothing is left', async () => {
    resetCartStore(emptyCart)

    await renderCart()

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()
    // 막다른 길이 아니다 — 쇼핑을 계속할 수 있어야 한다.
    expect(screen.getByRole('link', { name: copy.emptyAction })).toHaveAttribute('href', '/')
  })
})

describe('주문하기', () => {
  it('links to the checkout with the number of chosen lines', async () => {
    await renderCart()

    // 품절 하나를 뺀 셋.
    const order = await screen.findByRole('link', {
      name: copy.checkout.replace('{count}', '3'),
    })

    expect(order).toHaveAttribute('href', '/checkout')
  })

  it('refuses and says why when nothing is chosen', async () => {
    const user = userEvent.setup()

    await renderCart()

    await user.click(screen.getByRole('checkbox', { name: copy.selectAll.replace('{count}', '3') }))

    expect(await screen.findByText(copy.nothingSelected)).toBeVisible()
    expect(screen.queryByRole('link', { name: /주문하기/u })).toBeNull()
  })
})

describe('F8 아홉 조합', () => {
  /**
   * 밀도 3 × 뷰포트 3. jsdom 은 아무것도 칠하지 않으므로 「깨짐 0건」을 픽셀로 잴
   * 수 없다 — 잴 수 있는 것은 **완전한 화면인가**이다: 제목, 두 그룹, 합계, 그리고
   * 주문 버튼이 정확히 하나.
   */
  it.each(
    DENSITY_LEVELS.flatMap((density) =>
      (['mobile', 'tablet', 'desktop'] as const).map((band) => ({ density, band })),
    ),
  )('draws a complete cart at density $density on $band', async ({ density, band }) => {
    window.localStorage.setItem('shopping.density', String(density))

    await renderCart(VIEWPORTS[band])

    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
    expect(await screen.findByRole('region', { name: '루미에르' })).toBeVisible()
    expect(screen.getByRole('region', { name: '노드스텝' })).toBeVisible()
    expect(screen.getAllByRole('link', { name: /주문하기/u })).toHaveLength(1)
  })
})
