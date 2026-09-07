/**
 * 시나리오가 공유하는 것들 (TASK-0099).
 *
 * **데모 계정은 시나리오마다 새로 받는다.** 하나를 나눠 쓰면 병렬로 도는 두
 * 시나리오가 같은 장바구니와 같은 주문 목록을 보게 되고, 그때부터 실패는 서로의
 * 탓이 된다 — 그리고 그 실패는 재현되지 않는다.
 */

import { expect, test, type Page } from '@playwright/test'

import { APPS, requireStack } from './apps.js'

export { expect, test }

/**
 * 한 주소에서 1분에 다섯 개까지 (`DEMO_ISSUE_LIMIT`).
 *
 * 시나리오 넷이 합쳐 다섯 개를 받으므로 **한 번 돌리면 딱 한도**다. 연달아 돌리면
 * 걸린다 — 그때는 창이 지나가기를 기다렸다가 한 번 더 누른다. 한도를 검사용으로
 * 낮추거나 끄지 않는 이유는, 그러면 이 흐름이 실제로 열리는 문과 다른 문을 지나게
 * 되기 때문이다.
 */
const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * 데모 계정을 받는다 — **화면에서** 받는다.
 *
 * API 를 직접 불러 쿠키를 심는 편이 빠르지만, 그러면 「방문자가 데모를 받을 수
 * 있는가」는 아무도 검사하지 않게 된다. 그 버튼은 이 서비스의 첫 문이다.
 */
export async function issueDemo(page: Page, app: 'shop' | 'seller' | 'admin'): Promise<void> {
  await page.goto(`${APPS[app]}/login`)

  for (const attempt of [0, 1]) {
    const button = page.getByRole('button', { name: /데모 계정 받기/ })

    await expect(button).toBeEnabled()
    await button.click()

    // 발급이 끝나면 로그인 화면을 벗어난다. 「버튼이 사라졌다」가 아니라 **다음
    // 화면에 도착했다**를 기다린다 — 전자는 실패했을 때도 참이 될 수 있다.
    const left = await page
      .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)

    if (left) return

    const limited = await page.getByText('조금 전에 여러 번 발급했습니다').isVisible()

    if (!limited || attempt === 1) {
      throw new Error(`데모 계정을 받지 못했습니다 (${app}).`)
    }

    await page.waitForTimeout(RATE_LIMIT_WINDOW_MS)
  }
}

/** 스택이 없으면 타임아웃 대신 「무엇을 띄우라」는 말을 듣는다. */
export async function guardStack(): Promise<void> {
  await requireStack()
}
