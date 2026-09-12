import { expect, type Page } from '@playwright/test'
import {
  orderResponseSchema,
  sessionResponseSchema,
  shipmentResponseSchema,
} from '@shopping/shared'

import { APPS } from './apps.js'
import { confirmDialog, discoverProduct, type PlacedOrder } from './flows.js'

/** Visible admin inspection plus authenticated reads for SKU/quantity fields absent from its summary. */
export async function inspectAdminOrder(
  page: Page,
  order: PlacedOrder,
  status: string,
): Promise<void> {
  await page.goto(`${APPS.admin}/orders`)
  await page.getByLabel('주문번호', { exact: true }).fill(order.number)
  await page.getByRole('search').getByRole('button', { name: '검색', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBe(0)
  await page.getByRole('button', { name: `${order.number} 주문 상세` }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(order.number, { exact: true }).first()).toBeVisible()
  await expect(dialog.getByText(status, { exact: true }).first()).toBeVisible()
  await expect(
    dialog.getByText(`₩${order.paid.toLocaleString('ko-KR')}`, { exact: true }).first(),
  ).toBeVisible()

  const sessionResponse = await page.request.post(`${APPS.api}/auth/refresh`, {
    headers: { 'X-App-Id': 'admin' },
  })
  expect(sessionResponse.ok()).toBeTruthy()
  const session = sessionResponseSchema.parse(await sessionResponse.json())
  const response = await page.request.get(`${APPS.api}/orders/${order.id}`, {
    headers: { 'X-App-Id': 'admin', Authorization: `Bearer ${session.accessToken}` },
  })
  expect(response.ok()).toBeTruthy()
  const actual = orderResponseSchema.parse(await response.json()).order
  expect(actual.orderNumber).toBe(order.number)
  const items = (parts: PlacedOrder['sellerOrders']) =>
    parts
      .flatMap((part) =>
        part.items.map((item) => ({
          variantId: item.variantId,
          sku: item.snapshot.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      )
      .sort((a, b) => a.variantId.localeCompare(b.variantId))
  expect(items(actual.sellerOrders)).toEqual(items(order.sellerOrders))
}

export async function adminTracking(page: Page, sellerOrderId: string): Promise<string> {
  const response = await page.request.post(`${APPS.api}/auth/refresh`, {
    headers: { 'X-App-Id': 'admin' },
  })
  const session = sessionResponseSchema.parse(await response.json())
  const shipment = await page.request.get(`${APPS.api}/seller-orders/${sellerOrderId}/shipment`, {
    headers: { 'X-App-Id': 'admin', Authorization: `Bearer ${session.accessToken}` },
  })
  expect(shipment.ok()).toBeTruthy()
  return shipmentResponseSchema.parse(await shipment.json()).shipment.trackingNumber
}

export async function moderateProduct(
  admin: Page,
  buyer: Page,
  productId: string,
  name: string,
  order: PlacedOrder,
): Promise<void> {
  await admin.goto(`${APPS.admin}/products`)
  await admin.getByLabel('상품 이름', { exact: true }).fill(name)
  await admin.getByRole('search').getByRole('button', { name: '검색', exact: true }).click()
  await expect(admin.getByRole('row').filter({ hasText: name })).toHaveCount(1)
  await admin.getByRole('button', { name: `${name} 내리기`, exact: true }).click()
  const dialog = admin.getByRole('dialog')
  await dialog.getByLabel('숨김 사유', { exact: false }).fill('E2E 데모 상품 노출 검증')
  await dialog.getByRole('button', { name: '내리기', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(admin.getByText('강제 숨김', { exact: true }).first()).toBeVisible()

  const query = new URLSearchParams({ q: name })
  await expect
    .poll(
      async () => {
        const result = await buyer.request.get(`${APPS.api}/search?${query.toString()}`)
        expect(result.ok()).toBeTruthy()
        const body = (await result.json()) as { items: { id: string }[] }
        return body.items.some((item) => item.id === productId)
      },
      { timeout: 30_000 },
    )
    .toBe(false)
  await buyer.goto(`${APPS.shop}/search?${query.toString()}`)
  await expect(buyer.locator(`a[href="/products/${productId}"]`)).toHaveCount(0)
  expect((await buyer.request.get(`${APPS.api}/products/${productId}/detail`)).status()).toBe(404)
  await buyer.goto(`${APPS.shop}/mypage/orders/${order.id}`)
  await expect(buyer.getByText(name, { exact: true }).first()).toBeVisible()

  await confirmDialog(admin, `${name} 다시 올리기`)
  await discoverProduct(buyer, productId)
}
