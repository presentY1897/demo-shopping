import { APPS } from '../support/apps.js'
import { inspectAdminOrder, adminTracking, moderateProduct } from '../support/cross-role.js'
import { buy, confirmDialog, publishProduct } from '../support/flows.js'
import { expect, guardStack, issueDemo, test } from '../support/fixtures.js'

test.beforeAll(guardStack)

test('올린 상품이 팔리고, 그 주문을 발송한다 (F2)', async ({ browser }) => {
  test.setTimeout(180_000)

  const seller = await browser.newContext()
  const buyer = await browser.newContext()
  const admin = await browser.newContext()

  try {
    const sellerPage = await seller.newPage()
    const name = `E2E 코트 ${String(Date.now())}`
    const productId = await publishProduct(sellerPage, name)

    const buyerPage = await buyer.newPage()

    await issueDemo(buyerPage, 'shop')

    const order = await buy(buyerPage, [productId])
    const adminPage = await admin.newPage()
    await issueDemo(adminPage, 'admin')
    await inspectAdminOrder(adminPage, order, '결제완료')

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
    await inspectAdminOrder(adminPage, order, '배송중')
    const tracking = await adminTracking(adminPage, order.sellerOrders[0]!.id)
    await expect(sellerPage.getByText(tracking, { exact: true }).first()).toBeVisible()
    await buyerPage.goto(`${APPS.shop}/mypage/orders/${order.id}`)
    await buyerPage.getByRole('button', { name: /배송조회$/ }).click()
    await expect(buyerPage.getByText(tracking, { exact: true }).first()).toBeVisible()
    await moderateProduct(adminPage, buyerPage, productId, name, order)
  } finally {
    await seller.close()
    await buyer.close()
    await admin.close()
  }
})
