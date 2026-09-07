/**
 * 폼 컨트롤을 다루는 공통 동작 (TASK-0099).
 *
 * `Select` 는 네이티브 `<select>` 가 아니라 Radix 의 조합 상자다 — 열고 고른다.
 * 시나리오가 그 사정을 알 필요는 없으므로 여기서 한 번만 안다.
 */

import { expect, type Page } from '@playwright/test'

/**
 * 이름은 **부분 일치**로 찾는다.
 *
 * 필수 표시 별표는 `aria-hidden` 이 아니라 레이블 안에 있어서, 눈으로 읽은
 * 「주 소재 *」와 접근성 이름 「주 소재」가 다르다. 정확히 맞추려 들면 별표가 붙고
 * 떨어질 때마다 검사가 깨진다.
 */
export async function chooseFromSelect(page: Page, name: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name }).first().click()

  const choice = page.getByRole('option', { name: option, exact: true })

  await expect(choice).toBeVisible()
  await choice.click()
}
