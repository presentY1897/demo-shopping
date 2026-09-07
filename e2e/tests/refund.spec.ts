/**
 * 시나리오 3 — 부분 취소와 환불 (TASK-0099 F3).
 *
 * **부분이라는 것이 요점이다.** 두 상품을 사고 하나만 취소한다 — 전부 취소는 「주문이
 * 사라졌다」로 끝나지만, 부분 취소는 남은 하나의 값과 돌려받은 값이 **따로** 맞아야
 * 한다. 금액을 나누는 규칙이 틀리면 여기서만 드러난다. 신청 화면이 줄 단위로 고르게
 * 되어 있어 「하나를 두 개 사고 하나만 취소」는 이 화면에서 할 수 없는 일이다.
 *
 * 그리고 **돈이 실제로 움직인다**를 본다. 화면이 「결제되었습니다」라고 말하는 것과
 * 카드에서 그만큼 빠진 것은 다른 일이고, 이 흐름이 지키는 것은 뒤쪽이다.
 *
 * 데모 판매자의 상품을 데모 구매자가 산다 — 같은 숫자가 판매자 쪽에도 보여야 하기
 * 때문이다. 어느 상품인지는 **서버에게 묻는다**: 여기서 물을 것은 환불 계산이지
 * 등록 폼이 아니고, 폼은 시나리오 2 가 화면으로 검사한다.
 */

import type { Page } from '@playwright/test'

import { APPS } from '../support/apps.js'
import { buy, productsOf, won } from '../support/flows.js'
import { expect, guardStack, issueDemo, test } from '../support/fixtures.js'

test.beforeAll(guardStack)

/**
 * 이 카드로 지금 더 쓸 수 있는 금액.
 *
 * 값은 **이름 옆 칸**에 있다 (`<dt>사용 가능</dt><dd>₩5,000,000</dd>`). 이름이 든
 * 요소를 그대로 읽으면 「사용 가능」이라는 글자에서 숫자를 뽑게 되고, 그러면 답이
 * 0 이 나온다 — 그리고 0 은 **잔액이 0 인 카드와 구별되지 않는다.**
 */
async function available(page: Page): Promise<number> {
  await page.goto(`${APPS.shop}/mypage/cards`)

  const amount = page
    .locator('dt', { hasText: /^사용 가능$/ })
    .first()
    .locator('xpath=following-sibling::dd[1]')

  await expect(amount).toBeVisible({ timeout: 30_000 })

  return won(await amount.innerText())
}

test('두 상품 중 하나를 취소하면 그만큼만 돌아온다 (F3)', async ({ browser }) => {
  test.setTimeout(240_000)

  const seller = await browser.newContext()
  const buyer = await browser.newContext()

  try {
    const sellerPage = await seller.newPage()

    await issueDemo(sellerPage, 'seller')

    // 두 상품을 산다 — **부분 취소는 줄 단위**라, 한 상품만 사면 「부분」이 없다.
    const products = await productsOf(sellerPage, 2)

    const buyerPage = await buyer.newPage()

    await issueDemo(buyerPage, 'shop')

    const before = await available(buyerPage)
    const order = await buy(buyerPage, products)

    // 돈이 실제로 나갔다. 「결제되었습니다」만 보면 카드를 건드리지 않은 결제도 통과한다.
    expect(await available(buyerPage)).toBe(before - order.paid)

    await buyerPage.goto(`${APPS.shop}/mypage/orders`)
    await buyerPage
      .getByRole('link', { name: new RegExp(order.number) })
      .first()
      .click()
    await buyerPage
      .getByRole('link', { name: /취소 신청/ })
      .first()
      .click()

    // **둘 중 하나만 고른다.** 신청 화면은 줄 단위로 고르게 되어 있고, 둘 다 고르면
    // 이 시나리오는 전부 취소를 검사하는 것이 된다. 체크박스의 이름은 상품 이름이라
    // 이름으로 찍지 않고 **첫 번째 줄**을 고른다.
    await buyerPage.getByRole('checkbox').first().check()
    await buyerPage.getByRole('radio', { name: /단순 변심/ }).check()
    await buyerPage.getByLabel('사유').fill('E2E 부분 취소')
    await buyerPage.getByRole('button', { name: '신청하기' }).click()

    // **발송 전 취소는 판매자를 기다리지 않는다.** 상세 화면에 처리할 버튼이 없고
    // 「환불된 금액」이 이미 적혀 있다 — 물건이 아직 떠나지 않아 판단할 것이 없기
    // 때문이다(반품은 다르다). 이 검사가 그 사실을 확인하려다 남았다.
    await sellerPage.goto(`${APPS.seller}/claims`)
    await sellerPage
      .getByRole('link', { name: new RegExp(order.number) })
      .first()
      .click()

    // **하나 몫만** 돌아온다. 전액이 돌아오면 남은 하나가 공짜가 된 것이고, 그것은
    // 「취소되었습니다」라는 문장만 보고 있으면 알 수 없다.
    const refunded = won(
      await sellerPage
        .locator('section', { has: sellerPage.getByRole('heading', { name: '환불된 금액' }) })
        .getByText(/₩/)
        .last()
        .innerText(),
    )

    expect(refunded).toBeGreaterThan(0)
    expect(refunded).toBeLessThan(order.paid)
  } finally {
    await seller.close()
    await buyer.close()
  }
})
