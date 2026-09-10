/**
 * 시나리오 둘 이상이 함께 쓰는 동선 (TASK-0099).
 *
 * **판매자 시나리오와 환불 시나리오는 같은 준비가 필요하다** — 데모 판매자가 자기
 * 상품을 올리고, 데모 구매자가 **그 상품을** 산다. 시드 상품을 사면 그 주문을 볼
 * 판매자가 없고(데모 판매자는 자기 스토어만 본다), 그러면 「들어온 주문을 처리한다」를
 * 검사할 수 없다.
 */

import { expect, type Page } from '@playwright/test'

import { APPS } from './apps.js'
import { chooseFromSelect } from './forms.js'
import { issueDemo } from './fixtures.js'

/** 화면에 적힌 원화를 숫자로. `₩1,234,567` → `1234567`. */
export function won(text: string): number {
  return Number(text.replace(/[^0-9]/g, ''))
}

/**
 * **준비물은 화면이 아니라 서버에게 묻는다.**
 *
 * 「환불이 맞게 계산되는가」를 물으려면 팔 물건이 있어야 한다. 그 물건을 등록 폼으로
 * 만들면 이 시나리오는 **환불이 아니라 등록 폼을 검사하게 된다** — 폼이 바뀌는 날
 * 환불 검사가 대신 빨개진다. 등록 폼은 시나리오 2 가 화면으로 검사한다.
 *
 * 그리고 새로 만들 것도 없다: 데모 판매자는 **자기 카탈로그를 가지고 태어난다**
 * (`demo-seed.service.ts`). 그중 하나를 고르면 된다.
 *
 * 세션은 브라우저의 것을 그대로 쓴다. `page.request` 는 그 페이지의 쿠키를 함께
 * 들고 가므로 갱신 한 번이면 이 판매자의 토큰이 나온다.
 */
export async function productsOf(page: Page, count = 1): Promise<readonly string[]> {
  const session = await page.request.post(`${APPS.api}/auth/refresh`, {
    headers: { 'X-App-Id': 'seller' },
  })

  if (!session.ok()) throw new Error(`세션을 갱신하지 못했습니다: ${await session.text()}`)

  const { accessToken } = (await session.json()) as { accessToken: string }

  const listed = await page.request.get(
    `${APPS.api}/seller/products?limit=${String(count)}&status=ACTIVE`,
    {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-App-Id': 'seller' },
    },
  )

  if (!listed.ok()) throw new Error(`상품 목록을 읽지 못했습니다: ${await listed.text()}`)

  const body = (await listed.json()) as { items?: readonly { id?: string }[] }
  const ids = (body.items ?? []).map((item) => String(item.id ?? '')).filter((id) => id !== '')

  // 데모 판매자는 카탈로그와 함께 만들어진다 — 모자란다면 그 시딩이 깨진 것이고,
  // 그것은 이 시나리오가 조용히 넘어갈 일이 아니다.
  expect(ids.length).toBe(count)

  return ids
}

/**
 * 데모 판매자로 로그인해 상품 하나를 올리고 판매를 시작한다 — **화면으로**.
 *
 * id 는 **서버가 답한 것에서** 읽는다. 목록을 거치면 그쪽의 정렬과 쪽 나눔까지 이
 * 시나리오의 전제가 되고, 그것은 여기서 답할 질문이 아니다.
 */
export async function publishProduct(page: Page, name: string): Promise<string> {
  await issueDemo(page, 'seller')
  await page.goto(`${APPS.seller}/products/new`)

  await page.getByLabel('상품명', { exact: false }).fill(name)
  await chooseFromSelect(page, '카테고리', '여성 › 아우터 › 코트')

  // 카테고리가 요구하는 항목은 카테고리가 정한다 (TASK-0031). 관리자가 항목을
  // 더하면 이 줄들이 먼저 빨개진다.
  await page.getByRole('checkbox', { name: '블랙' }).click()
  await chooseFromSelect(page, '주 소재', '면')
  await chooseFromSelect(page, '핏', '레귤러')

  // 옵션을 만들지 않았으므로 조합은 한 줄이고, 일괄 입력이 그 줄을 채운다.
  await page.getByLabel('판매가', { exact: true }).fill('49000')
  await page.getByLabel('재고', { exact: true }).fill('10')
  await page.getByRole('button', { name: '모든 행에 적용' }).click()

  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/products') &&
      response.request().method() === 'POST' &&
      response.status() === 201,
  )

  await page.getByRole('button', { name: '판매 시작' }).click()

  const body = (await (await created).json()) as { product?: { id?: string } }
  const productId = String(body.product?.id ?? '')

  expect(productId).not.toBe('')
  await expect(page.getByText('판매를 시작했습니다.').first()).toBeVisible({ timeout: 30_000 })

  return productId
}

export interface PlacedOrder {
  readonly number: string
  readonly paid: number
}

/** 상세 화면에서 옵션을 고르고 담는다. */
async function addToCart(page: Page, productId: string): Promise<void> {
  await page.goto(`${APPS.shop}/products/${productId}`)

  // Counting does not wait for a streamed product panel to render.
  await expect(page.getByRole('button', { name: '장바구니 담기' })).toBeVisible()
  const groups = page.locator('fieldset').filter({ has: page.getByRole('button') })
  const count = await groups.count()

  for (let index = 0; index < count; index += 1) {
    const option = groups.nth(index).getByRole('button', { disabled: false }).first()
    await option.click()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
  }

  await page.getByRole('button', { name: '장바구니 담기' }).click()
  await expect(page.getByText('장바구니에 담았어요.')).toBeVisible()
}

/** 상품들을 사고 주문번호와 결제금액을 답한다. */
export async function buy(page: Page, productIds: readonly string[]): Promise<PlacedOrder> {
  for (const productId of productIds) await addToCart(page, productId)

  await page.goto(`${APPS.shop}/cart`)
  await page.getByRole('button', { name: /건 주문하기/ }).click()
  await page.waitForURL(/\/checkout/, { timeout: 30_000 })

  const paid = won(
    await page.getByRole('complementary', { name: '결제 금액' }).getByText(/₩/).last().innerText(),
  )

  await page.getByRole('checkbox', { name: /동의합니다/ }).click()
  await page.getByRole('button', { name: '주문하기' }).click()

  const done = page.getByText(/주문번호 \d{8}-[0-9A-Z]{8}/)

  await expect(done).toBeVisible({ timeout: 60_000 })

  const number = /주문번호 (\d{8}-[0-9A-Z]{8})/.exec(await done.innerText())?.[1]
  if (number === undefined) throw new Error('완료 화면의 주문번호를 읽지 못했습니다.')
  return { number, paid }
}

/**
 * 버튼을 누르고, 다시 묻는 창에서 확정한다.
 *
 * 되돌릴 수 없는 일은 한 번 더 묻는다. **확정 버튼의 이름은 창마다 다르므로**
 * 이름으로 찾지 않고 되돌리는 쪽이 아닌 것을 고른다 — 이름 목록을 적어 두면 문구가
 * 하나 바뀌는 날 검사가 대신 깨진다.
 */
export async function confirmDialog(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).first().click()

  const dialog = page.getByRole('dialog')

  await expect(dialog).toBeVisible()
  await dialog
    .getByRole('button')
    .filter({ hasNotText: /^(취소|닫기)$/ })
    .last()
    .click()
  await expect(dialog).toBeHidden()
}
