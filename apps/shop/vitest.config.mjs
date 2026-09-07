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
        // M13 이 더한 일곱. 성질이 위의 넷과 같다 — **틀려도 조용하다.**
        //
        // 담을 때 가격과 지금 가격을 거꾸로 빼면 인하가 인상으로 그려지고(F5),
        // 로컬 이력의 순서를 잘못 세우면 로그인 직후의 「최근 본 상품」이 실제
        // 순서를 잃으며(TASK-0087 F6), 밀도별 노출이 어긋나면 미니멀 상품 페이지에
        // 문의 목록이 붙는다(TASK-0088 F6). 폴링이 멈추지 않아도 화면은 멀쩡하고
        // (TASK-0090 R1), 판매자 알림을 거르지 않아도 링크를 눌러 보기 전까지는
        // 아무 일도 없으며, 신고 폼의 검증이 빠져도 서버가 대신 거절해 준다.
        // 어느 것도 빨간 검사를 만들지 않는다.
        'src/lib/collections/price-change.ts': complete,
        'src/lib/collections/local-history.ts': complete,
        'src/lib/questions/qna-exposure.ts': complete,
        'src/lib/questions/question-draft.ts': complete,
        'src/lib/notifications/polling.ts': complete,
        'src/lib/notifications/notification-scope.ts': complete,
        'src/lib/reports/report-draft.ts': complete,
        // 같은 성질의 하나가 더 늘었다 (TASK-0089 4.6). **가게 목록을 잘못 다듬으면
        // 조용하다** — 계약 상한을 넘겨 보내면 서버가 400 으로 거절하고 그 거절은
        // 홈에 **빈 줄**로만 나타나며(「아직 신상품이 없나 보다」로 읽힌다), 읽을 수
        // 없는 id 를 그대로 넘기면 공유된 링크가 「다시 시도」밖에 없는 오류 화면이
        // 된다. 어느 쪽도 빨간 검사를 만들지 않는다.
        'src/lib/search/seller-ids.ts': complete,
      },
    },
  },
}
