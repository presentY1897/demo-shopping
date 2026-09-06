import { nextAppVitestConfig } from '@shopping/config/vitest/next-app'

/** Everything a `100` in `thresholds` means. */
const complete = { branches: 100, functions: 100, lines: 100, statements: 100 }

const base = nextAppVitestConfig(import.meta.dirname)

/**
 * The shared preset, plus this app's coverage gate.
 *
 * **No global floor.** QUALITY-GATES Q5 gives the front-end layer an interaction
 * list rather than a number, on the grounds that a coverage target on UI code
 * buys tests that render and assert nothing.
 *
 * **The modules below are the 순수 로직 row of that same table.** A branch
 * nothing reaches in them renders the wrong thing rather than failing a test.
 * `apps/admin/vitest.config.mjs` holds its own list for the same reason and in
 * the same shape.
 *
 * 이 패키지의 `test:coverage` 가 오랫동안 `vitest run` 이었다 — `--coverage` 도
 * `@vitest/coverage-v8` 도 없어서 **여기 적힌 문턱이 아무것도 재지 않았다.** 목록만
 * 있고 재는 사람이 없는 게이트는 게이트가 아니라 주석이다. TASK-0082 에서 그 두
 * 줄을 채웠다.
 */
export default {
  ...base,
  test: {
    ...base.test,
    coverage: {
      exclude: ['src/**/*.spec.{ts,tsx}'],
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        // TASK-0082 의 판단들, 화면이 그려지기 전에 내려진 것. **매출 추이 선의
        // 좌표**가 여기 있고, 그것이 틀리면 조용하다 — 화면은 멀쩡한 선을 하나 그리고
        // 판매자는 그 모양을 보고 지난주와 비교한다. 특히 나눗셈의 분모가 0이 되는 두
        // 자리(칸이 하나뿐인 기간 · 한 건도 못 판 기간)는 좌표를 `NaN` 으로 만들어
        // **선을 통째로 지우는데**, 그때도 오류는 나지 않는다.
        'src/lib/revenue/chart.ts': complete,
        // 같은 성질의 판단 둘이 더 있다. 기간을 하루 어긋나게 잡으면 그래프가 조용히
        // 다른 구간을 그리고, 증감률의 분모가 0인 갈래를 놓치면 화면에 `Infinity%`
        // 또는 — 더 나쁘게 — 「100% 늘었다」가 뜬다 (F6).
        'src/lib/revenue/revenue-console.ts': complete,
        // 정산서의 계산 근거와 목록 질의. 부호를 하나 뒤집으면 **합이 맞지 않는 표**가
        // 그려지고, `sellerId` 를 빠뜨린 질의는 403 으로 돌아와 「내 정산서가 안
        // 보인다」가 된다 (F1 · F2). 둘 다 빨간 검사를 만들지 않는다.
        'src/lib/settlements/settlement-console.ts': complete,
      },
    },
  },
}
