/**
 * 시나리오 1 — 데모 발급부터 주문 확인까지 (TASK-0099 F1).
 *
 * **마우스를 쓰지 않는다** (TASK-0098 F2). 개별 컴포넌트가 접근 가능해도 흐름이
 * 한 곳에서 끊기면 그 사람은 살 수 없고, 끊긴 자리는 컴포넌트 검사로는 보이지
 * 않는다 — 그래서 구매 흐름 자체를 키보드로 완주한다.
 *
 * `focus()` 로 옮겨 붙이지 않고 **Tab 으로 도달한다.** 전자는 「눌리는가」만
 * 답하고, 마우스 없이 쓰는 사람이 실제로 겪는 것은 「거기까지 갈 수 있는가」다.
 */

import type { Locator, Page } from '@playwright/test'

import { expect, guardStack, issueDemo, test } from '../support/fixtures.js'

test.beforeAll(guardStack)

/** Tab 을 눌러 그 요소에 **도달한다.** 못 가면 실패한다. */
async function tabTo(page: Page, target: Locator, limit = 200): Promise<void> {
  await expect(target).toBeVisible()

  for (let step = 0; step < limit; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return

    await page.keyboard.press('Tab')
  }

  throw new Error(
    `Tab 을 ${String(limit)}번 눌러도 도달하지 못했습니다: ${await target.innerText()}`,
  )
}

/**
 * 옵션을 하나씩 고른다 — 조합이 정해져야 담을 수 있다.
 *
 * 어떤 옵션이 몇 개인지는 상품마다 다르므로 **화면이 그린 만큼** 고른다. 값 하나를
 * 이름으로 찍으면 시드가 바뀌는 날 조용히 못 찾는다.
 */
async function chooseEveryOption(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: '장바구니 담기' })).toBeVisible()
  const groups = page.locator('fieldset').filter({ has: page.getByRole('button') })

  for (let index = 0; index < (await groups.count()); index += 1) {
    const choice = groups.nth(index).getByRole('button', { disabled: false }).first()

    await tabAndPress(page, choice)
    await expect(choice).toHaveAttribute('aria-pressed', 'true')
  }
}

/** 도달해서 누른다. */
async function tabAndPress(page: Page, target: Locator, key = 'Enter'): Promise<void> {
  await tabTo(page, target)
  await page.keyboard.press(key)
}

test('마우스 없이 데모 발급부터 주문 확인까지 간다 (F1 · TASK-0098 F2)', async ({ page }) => {
  await issueDemo(page, 'shop')

  await page.goto('/search?q=코트')

  const grid = page.getByRole('list', { name: '검색 결과 목록' })

  await expect(grid).toBeVisible()

  const firstProduct = grid.getByRole('listitem').first().getByRole('link').first()

  await tabAndPress(page, firstProduct)
  await page.waitForURL(/\/products\//)

  // **옵션을 고르기 전에는 담을 수 없다.** 담기 버튼은 그때도 탭 순서에 남아 있고
  // (`aria-disabled`, 이유를 읽을 수 있어야 하므로), 그래서 눌러도 아무 일이
  // 없다 — 결과를 확인하지 않으면 이 검사는 조용히 통과한다.
  await chooseEveryOption(page)

  const addToCart = page.getByRole('button', { name: '장바구니 담기' })

  await tabAndPress(page, addToCart)

  // 담겼다는 것을 **화면이 말로 옮긴 것**으로 확인한다 (`aria-live`). 마우스 없이
  // 쓰는 사람이 받는 것도 이 문장이다.
  await expect(page.getByText('장바구니에 담았어요.')).toBeVisible()

  // **주소로 곧장 연다.** 앱 안에서 눌러 들어가면 세션이 이미 메모리에 있어 통과하고,
  // 새로고침·즐겨찾기·밖에서 온 링크만 깨진다 — 이 줄이 그 결함을 찾았다
  // (`use-cart.ts`: 부팅 갱신이 끝나기 전에 물어 401 을 받고 있었다).
  await page.goto('/cart')

  // 담아 둔 것이 실제로 거기 있다. 「화면이 떴다」가 아니라 **줄이 있다**를 본다.
  await expect(page.getByRole('button', { name: /건 주문하기/ })).toBeVisible()

  // 링크가 아니라 **버튼**이다 — 주문서를 여는 일이 곧 재고를 잡는 일이라
  // (TASK-0050 4.1) 이동이 아니라 요청이고, 링크였다면 새 탭마다 예약이 한 벌씩
  // 잡힌다.
  const checkout = page.getByRole('button', { name: /건 주문하기/ })

  await tabAndPress(page, checkout)
  await page.waitForURL(/\/checkout/, { timeout: 30_000 })

  // **동의 먼저.** 이 체크박스를 켜기 전에는 주문 버튼이 `aria-disabled` 이고,
  // 탭 순서에는 남아 있어 그 이유를 읽을 수 있다 (TASK-0023 4장). 이 줄이 그
  // 자리에서 진짜 `disabled` 를 찾아냈다 — 그때는 버튼에 닿을 수조차 없었다.
  const agree = page.getByRole('checkbox', { name: /동의합니다/ })

  await tabAndPress(page, agree, 'Space')

  const placeOrder = page.getByRole('button', { name: '주문하기' })

  await expect(placeOrder).toHaveAttribute('aria-disabled', 'false')
  await tabAndPress(page, placeOrder)

  // 주문서는 자리를 옮기지 않는다 — 결제가 끝나면 **그 자리에서** 끝난 것을 말한다.
  // 주문번호까지 확인한다: 「완료됐어요」만 보면 번호 없는 완료도 통과한다.
  const done = page.getByText(/주문번호 \d{8}-[0-9A-Z]{8}/)

  await expect(done).toBeVisible({ timeout: 60_000 })

  // 그리고 **주문 내역에 실제로 있다.** 화면이 완료를 말하는 것과 서버에 주문이
  // 남은 것은 다른 일이고, 이 흐름이 지키는 것은 뒤쪽이다.
  const number = /주문번호 (\d{8}-[0-9A-Z]{8})/.exec(await done.innerText())?.[1]
  if (number === undefined) throw new Error('완료 화면의 주문번호를 읽지 못했습니다.')

  await page.goto('/mypage/orders')
  await expect(page.getByText(number)).toBeVisible({ timeout: 30_000 })
  await page.goto('/cart')
  await expect(
    page.getByRole('status').getByText('장바구니가 비어 있어요', { exact: true }),
  ).toBeVisible()
})
