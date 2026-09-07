import { defineConfig, devices } from '@playwright/test'

import { APPS, isCi } from './support/apps.js'

/**
 * E2E 설정 (TASK-0099).
 *
 * ## 서버는 여기서 띄우지 않는다
 *
 * 이 흐름은 **세 앱과 API 와 데이터베이스와 검색 엔진**이 함께 있어야 성립한다.
 * 그것을 Playwright 의 `webServer` 로 세우면 마이그레이션과 시드와 색인이 설정
 * 파일 안으로 들어오고, 그러면 CI 워크플로와 **같은 일을 하는 두 번째 정의**가
 * 생긴다. 그래서 스택은 밖에서 세우고(`e2e.yml`, 로컬은 `pnpm dev`), 여기서는
 * 살아 있는지만 확인한다 — 없으면 `support/apps.ts` 가 무엇을 띄우라고 말한다.
 *
 * ## 재시도는 CI 에서만 한 번
 *
 * R1 이 정한 값이다. 로컬에서 재시도하면 **불안정한 검사가 초록으로 보이고**,
 * 그것을 고칠 사람은 로컬에 있다. CI 에서의 한 번은 공유 러너의 변동을 넘기기
 * 위한 것이고, 두 번 넘게 필요하면 그 시나리오는 격리 대상이다.
 */
export default defineConfig({
  testDir: './tests',
  /**
   * **한 번에 하나씩 돈다.**
   *
   * 데모 계정 발급이 한 주소에서 1분에 다섯 개로 묶여 있고(`DEMO_ISSUE_LIMIT`),
   * 시나리오 넷이 합쳐 딱 다섯 개를 받는다. 동시에 돌리면 그 다섯이 같은 몇 초에
   * 몰려 뒤쪽이 거절당한다 — 코드가 아니라 순서 때문에 빨개지는 검사가 된다.
   *
   * 한도를 검사용으로 낮추거나 끄지 않는 이유는, 그러면 이 흐름이 실제로 열리는
   * 문과 다른 문을 지나게 되기 때문이다. 시나리오 하나가 5초 남짓이라 직렬로도
   * F8 의 10분 안에 넉넉히 들어온다.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  // F8 은 10분이다. 넉넉해 보이지만 **넘으면 실패로 만든다** — 예산이 없으면
  // 시나리오는 조용히 길어지고, 길어진 뒤에는 아무도 줄이지 않는다.
  globalTimeout: 10 * 60 * 1000,
  timeout: 90 * 1000,
  expect: { timeout: 10 * 1000 },
  reporter: isCi ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: APPS.shop,
    // 실패한 것만 남긴다. 통과한 시나리오의 트레이스는 아무도 보지 않고 용량만 든다.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      // 데모 동선은 **전화기에서 보는 사람**을 상정한다 (`pages.md` 는 360px 에서
      // 검증한다). 데스크톱에서만 통과하는 흐름은 그 사람에게 없는 흐름이다.
      use: { ...devices['Pixel 7'] },
    },
  ],
})
