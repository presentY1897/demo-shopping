import type { Page } from '@playwright/test'
import { claimResponseSchema } from '@shopping/shared'

import { APPS } from './apps.js'
import { expect, issueDemo } from './fixtures.js'
import { confirmDialog, type PlacedOrder } from './flows.js'

/** Follow a rejected return across three independent UI sessions. */
export async function returnWithIntervention(
  buyer: Page,
  seller: Page,
  admin: Page,
  order: PlacedOrder,
): Promise<void> {
  await seller.goto(`${APPS.seller}/orders/${order.sellerOrders[0]!.id}`)
  await confirmDialog(seller, '주문 확인')
  await confirmDialog(seller, '발송 처리')
  await confirmDialog(seller, '배송완료 처리')
  await buyer.goto(`${APPS.shop}/mypage/orders/${order.id}`)
  await buyer.getByRole('link', { name: /반품 신청/ }).click()
  await buyer.getByRole('checkbox').filter({ visible: true }).first().check()
  await buyer.getByRole('radio', { name: /단순 변심/ }).check()
  await buyer.getByLabel('사유', { exact: true }).fill('E2E 배송 후 반품')
  const requested = buyer.waitForResponse(
    (response) =>
      response.url().endsWith('/claims') && response.request().method() === 'POST' && response.ok(),
  )
  await buyer.getByRole('button', { name: '신청하기' }).click()
  const { claim } = claimResponseSchema.parse(await (await requested).json())
  await seller.goto(`${APPS.seller}/claims`)
  await seller.locator(`a[href="/claims/${claim.id}"]`).first().click()
  await seller.getByRole('button', { name: '반품 거절', exact: true }).click()
  const rejection = seller.getByRole('dialog')
  await rejection.getByLabel('거절 사유', { exact: false }).fill('E2E 관리자 재검토를 위한 거절')
  await rejection.getByRole('button', { name: '처리하기', exact: true }).click()
  await expect(rejection).toBeHidden()
  await issueDemo(admin, 'admin')
  await admin.goto(`${APPS.admin}/claims/${claim.id}`)
  await admin.getByRole('button', { name: '강제 처리', exact: true }).click()
  const force = admin.getByRole('dialog')
  await force.getByRole('combobox', { name: /반품 사유/ }).click()
  await admin.getByRole('option', { name: '단순 변심', exact: true }).click()
  await force.getByLabel('개입 사유', { exact: false }).fill('E2E 반품 조건 재검토 후 승인')
  const intervened = admin.waitForResponse(
    (response) =>
      response.url().endsWith('/admin/claims') &&
      response.request().method() === 'POST' &&
      response.ok(),
  )
  await force.getByRole('button', { name: '강제 처리하기', exact: true }).click()
  const replacement = claimResponseSchema.parse(await (await intervened).json()).claim
  expect(replacement.overturnsClaimId).toBe(claim.id)
  expect(replacement.status).toBe('RETURN_APPROVED')
  await expect(force).toBeHidden()
  await admin.getByRole('link', { name: '개입 1 열기' }).click()
  await expect(admin.getByText('반품 승인', { exact: true }).first()).toBeVisible()
  await seller.goto(`${APPS.seller}/claims/${replacement.id}`)
  await confirmDialog(seller, '회수 처리')
  await confirmDialog(seller, '입고 처리')
  await confirmDialog(seller, '검수 합격')
  await expect(seller.getByText('환불 완료', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  })
  await buyer.goto(`${APPS.shop}/mypage/orders/${order.id}`)
  await expect(buyer.getByText('반품됨', { exact: true }).first()).toBeVisible()
  await admin.goto(`${APPS.admin}/claims/${replacement.id}`)
  await expect(admin.getByText('환불 완료', { exact: true }).first()).toBeVisible()
}
