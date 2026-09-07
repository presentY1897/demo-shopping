import { expect, guardStack, issueDemo, test } from '../support/fixtures.js'

test.beforeAll(guardStack)

test('probe', async ({ page }) => {
  await issueDemo(page, 'shop')
  await page.goto('/search?q=코트')
  const grid = page.getByRole('list', { name: '검색 결과 목록' })
  await grid.getByRole('listitem').first().getByRole('link').first().click()
  await page.waitForURL(/\/products\//)
  const groups = page.locator('fieldset').filter({ has: page.getByRole('button') })
  for (let i = 0; i < (await groups.count()); i += 1) {
    await groups
      .nth(i)
      .getByRole('button')
      .filter({ hasNot: page.locator('[aria-disabled="true"]') })
      .first()
      .click()
  }
  await page.getByRole('button', { name: '장바구니 담기' }).click()
  await expect(page.getByText('장바구니에 담았어요.')).toBeVisible()
  await page.goto('/cart')
  await page.getByRole('button', { name: /건 주문하기/ }).click()
  await page.waitForURL(/\/checkout/, { timeout: 30_000 })
  await page.waitForTimeout(2500)
  console.log('CHECKOUT >>>', (await page.getByRole('main').innerText()).slice(0, 1200))
})
