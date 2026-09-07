/**
 * 밀도 단계를 바꾼다 — **좁은 화면에서는 팝오버 안에 있다** (D-055).
 *
 * `DensityControl` 은 768px 위에서는 라디오 세 개를 그대로 놓고, 그 아래에서는
 * 버튼 하나로 접어 팝오버 안에 넣는다. 시나리오가 그 사정을 알 필요는 없으므로
 * 여기서 한 번만 안다.
 */

import { expect, type Page } from '@playwright/test'

export const DENSITY_NAMES = ['미니멀', '표준', '맥시멀'] as const
export type DensityName = (typeof DENSITY_NAMES)[number]

export async function chooseDensity(page: Page, name: DensityName): Promise<void> {
  const radio = page.getByRole('radio', { name, exact: true })

  if ((await radio.count()) === 0) {
    await page.getByRole('button', { name: /표시 밀도 바꾸기/ }).click()
  }

  await radio.first().click()

  const step = String(DENSITY_NAMES.indexOf(name) + 1)

  // 단계는 `<html>` 에 적힌다 — 그것이 CSS 가 읽는 값이고, 화면이 실제로 그
  // 단계로 그려졌다는 유일한 증거다.
  await expect(page.locator('html')).toHaveAttribute('data-density', step)
}
