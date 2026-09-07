/**
 * 시나리오 4 — 밀도 3단계 전환 (TASK-0099 F4).
 *
 * **이 저장소가 무엇을 만들고 있는지를 한 화면으로 보여 주는 검사다** (DECISIONS
 * 1장: 상품 표현 3단계를 사용자가 토글).
 *
 * 세는 것은 **한 줄에 몇 개가 놓이는가**다. 「토글이 눌린다」만 재면 눌리기만 하고
 * 아무것도 안 바뀌어도 통과하고, 「카드가 몇 개 보이는가」를 재면 검색 화면에서는
 * 답이 늘 24개다 — 한 쪽의 크기는 밀도가 아니라 페이지 크기가 정한다.
 */

import type { Locator } from '@playwright/test'

import { chooseDensity, DENSITY_NAMES } from '../support/density.js'
import { expect, guardStack, test } from '../support/fixtures.js'

test.beforeAll(guardStack)

/** 격자의 열 수. CSS 가 실제로 깔아 놓은 트랙을 센다. */
async function columnsOf(grid: Locator): Promise<number> {
  const tracks = await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns)

  return tracks.split(' ').filter((track: string) => track !== '').length
}

test.describe('넓은 화면', () => {
  // 세 단계의 열 수가 **모두 다른** 너비다 (`DENSITY_GRID_COLUMNS` 의 `xl`: 3 · 4 · 6).
  // 좁은 화면에서는 표준과 맥시멀이 둘 다 2열이라 여기서는 구분이 안 된다.
  test.use({ viewport: { width: 1440, height: 900 } })

  test('단계마다 한 줄에 놓이는 개수가 달라진다 (F4)', async ({ page }) => {
    await page.goto('/search?q=코트')

    const grid = page.getByRole('list', { name: '검색 결과 목록' })

    await expect(grid).toBeVisible()

    const columns: number[] = []

    for (const step of DENSITY_NAMES) {
      await chooseDensity(page, step)
      columns.push(await columnsOf(grid))
    }

    // 값 자체가 아니라 **순서**를 검사한다 — 열 수는 디자인이 바뀌면 바뀌지만
    // 「조밀할수록 한 줄에 많이 놓인다」는 이 기능의 정의다.
    expect(columns[0]).toBeLessThan(columns[1] ?? 0)
    expect(columns[1]).toBeLessThan(columns[2] ?? 0)
  })
})

test('좁은 화면에서도 세 단계를 모두 고를 수 있다 (F4)', async ({ page }) => {
  await page.goto('/search?q=코트')

  await expect(page.getByRole('list', { name: '검색 결과 목록' })).toBeVisible()

  // 좁은 화면에서 이 컨트롤은 팝오버 안으로 접힌다 (D-055). 접힌 쪽에서 고를 수
  // 없으면 이 기능은 전화기에서 **없는 기능**이다.
  for (const step of DENSITY_NAMES) {
    await chooseDensity(page, step)
  }

  // 고른 값은 다음 방문에도 유지된다 — 그것이 안내가 약속하는 것이다.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-density', '3')
})
