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
 * `apps/seller/vitest.config.mjs` and `apps/admin/vitest.config.mjs` hold their
 * own lists for the same reason and in the same shape.
 *
 * 이 패키지의 `test:coverage` 도 오랫동안 `vitest run` 이었다 — `--coverage` 도
 * `@vitest/coverage-v8` 도 없어서 **여기 적힌 문턱이 아무것도 재지 않았다.** 목록만
 * 있고 재는 사람이 없는 게이트는 게이트가 아니라 주석이다. `apps/seller` 와 같은 두
 * 줄로 함께 고쳤다.
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
        // TASK-0084 의 판단, 화면이 그려지기 전에 내려진 것. **100배 정수를 사람이
        // 읽는 값으로 옮기는 일**이 여기 있고, 그것이 틀리면 조용하다 — 화면은 멀쩡한
        // 숫자를 하나 그리고 사람은 그것을 보고 상품을 고른다. 실제로
        // `(435 / 100).toFixed(1)` 은 「4.3」이며, 그 갈래를 지나는 검사가 없으면
        // 아무도 모른다.
        'src/lib/reviews/rating.ts': complete,
        // 같은 성질의 판단 둘이 더 있다. 남은 기간을 하루 어긋나게 세면 목록이
        // **서버가 곧 거절할 일**을 권하고, 밀도별 노출 수가 어긋나면 맥시멀에서 3건이
        // 보인다 — 둘 다 빨간 검사를 만들지 않는다 (TASK-0083 F7 · TASK-0084 F5).
        'src/lib/reviews/writable-window.ts': complete,
        'src/lib/reviews/exposure.ts': complete,
        // 보내기 전에 걸리는 넷. 하나를 놓치면 화면이 **서버가 거절할 요청**을 그대로
        // 보내고, 사람은 「필드 오류」라는 이름 없는 모양으로 그것을 받는다 (F6).
        'src/lib/reviews/review-draft.ts': complete,
      },
    },
  },
}
