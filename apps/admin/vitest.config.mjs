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
 *
 * `src/lib/errors.ts` and `src/lib/api-failure.ts` used to be on this list and
 * are no longer here: they moved to `packages/shared/src/api/` (D-219) and the
 * threshold went with them — `packages/shared/vitest.config.mjs` holds both to
 * the same 100%. `test/errors.spec.ts` stays, because what it checks now is this
 * console's own catalog against those functions, and it is the only catalog with
 * a placeholder to interpolate.
 */
export default {
  ...base,
  test: {
    ...base.test,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.{ts,tsx}'],
      thresholds: {
        // TASK-0031's decisions, taken before anything is drawn: which category
        // is offered, which order a generated form asks in, whether a choice
        // list is acceptable, what a move exchanges. A missed branch in any of
        // them renders a wrong form rather than failing a test.
        'src/lib/attributes/categories.ts': complete,
        'src/lib/attributes/options.ts': complete,
        'src/lib/attributes/order.ts': complete,
        'src/lib/attributes/preview.ts': complete,
        'src/lib/attributes/text.ts': complete,
        // TASK-0110's one decision taken before anything is drawn: which
        // actions a status offers, which permission each needs, whether a
        // reason is required. It is a **mirror** of the transition table in
        // `apps/api` (see the file), so a branch nothing reaches is a row of
        // the review queue offering the wrong buttons — and the symptom is
        // never a red test, because the buttons still render.
        'src/lib/sellers/decisions.ts': complete,
        // TASK-0071's decisions, taken before anything is drawn: which
        // rejections can be overturned, what a return reason records as fault,
        // what an intervention actually sends, and which instants a chosen day
        // covers. Two of those tables are **mirrors** of `apps/api` (see the
        // file), and a branch nothing reaches is a screen offering the wrong
        // button or a request built against the wrong order — neither of which
        // fails a test, because the screen still renders.
        'src/lib/claims/claim-console.ts': complete,
        // TASK-0071 F4's decisions, taken before anything is drawn: what may be
        // typed into the lookup (and which of those the repository has no route
        // for), which order states this intervention can begin from, which
        // reasons a confirmed order may be reversed for, and what the request
        // that reverses it carries. A missed branch offers a return form on an
        // order the server will refuse, or hides one it would accept — and the
        // screen renders either way.
        'src/lib/claims/defect-return.ts': complete,
        // TASK-0073 의 판단들. 「발급 수량 × 최대 할인액」은 **틀려도 조용하다** —
        // 화면은 그럴듯한 숫자를 하나 그리고, 발행자는 그것을 보고 버튼을 누른다.
        // 특히 상한 없는 정률 쿠폰의 최대 비용은 무한대이므로, 닿지 않은 분기 하나가
        // 「퍼센트 × 장수」라는 뜻 없는 곱셈을 화면에 남긴다. 사용률의 0 나눗셈과
        // 사람이 친 숫자의 파싱도 같은 성질이다.
        'src/lib/coupons/platform-coupons.ts': complete,
        // The photo gate in front of `POST /uploads/presign`. A missed branch
        // spends a round trip on a file the API refuses, and answers with a 400
        // that cannot say which file was at fault.
        'src/lib/claims/return-photos.ts': complete,
      },
    },
  },
}
