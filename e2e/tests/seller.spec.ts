/**
 * 시나리오 2 — 판매자가 상품을 올리고, 들어온 주문을 발송한다 (TASK-0099 F2).
 *
 * **두 앱을 오간다.** 판매자 데모로 상품을 올리고, 구매자 데모로 그 상품을 사고,
 * 다시 판매자 콘솔에서 그 주문을 본다. 셋의 세션이 독립이라 가능한 일이고(D-028),
 * 그것이 이 서비스의 데모 동선이기도 하다.
 *
 * **방금 올린 상품을 산다.** 시드 상품을 사면 그 주문을 볼 판매자가 없다 — 데모
 * 판매자는 자기 스토어만 본다. 그리고 검색을 거치지 않고 상세 주소로 곧장 간다:
 * 검색 색인은 비동기라 방금 올린 상품이 언제 검색에 나타날지는 이 검사가 답할
 * 질문이 아니다.
 */

import { APPS } from '../support/apps.js'
import { buy, confirmDialog, publishProduct } from '../support/flows.js'
import { expect, guardStack, issueDemo, test } from '../support/fixtures.js'

test.beforeAll(guardStack)

test('올린 상품이 팔리고, 그 주문을 발송한다 (F2)', async ({ browser }) => {
  test.setTimeout(180_000)

  const seller = await browser.newContext()
  const buyer = await browser.newContext()

  try {
    const sellerPage = await seller.newPage()
    const productId = await publishProduct(sellerPage, `E2E 코트 ${String(Date.now())}`)

    const buyerPage = await buyer.newPage()

    await issueDemo(buyerPage, 'shop')

    const order = await buy(buyerPage, [productId])

    // 판매자 콘솔에 **그 주문번호가** 있다. 「주문이 하나 늘었다」가 아니라
    // 「내가 만든 그 주문이 왔다」를 본다.
    await sellerPage.goto(`${APPS.seller}/orders`)
    await expect(sellerPage.getByText(order.number)).toBeVisible({ timeout: 30_000 })

    await sellerPage
      .getByRole('link', { name: new RegExp(order.number) })
      .first()
      .click()

    // **확인이 먼저다.** 결제만 끝난 주문은 아직 보낼 수 없다 — 판매자가 「받았다」고
    // 말한 뒤에야 발송이 열린다.
    await confirmDialog(sellerPage, '주문 확인')
    await confirmDialog(sellerPage, '발송 처리')

    await expect(sellerPage.getByText('배송중').first()).toBeVisible({ timeout: 30_000 })
  } finally {
    await seller.close()
    await buyer.close()
  }
})
