import { defineConfig } from 'vitest/config'

/** Everything a `100` in `thresholds` means. */
const complete = { branches: 100, functions: 100, lines: 100, statements: 100 }

/**
 * The first tests in this package.
 *
 * Most of what lives here is zod schemas — a contract, checked by every caller
 * that parses a response, and a spec asserting that `z.string()` rejects a
 * number would test zod. The two modules below are different: they **decide**
 * something. Given a failure and a catalog they choose which sentence a person
 * reads, whether a placeholder could be filled, and whether a reference is worth
 * showing. A branch nothing reaches in them is an error rendered with the wrong
 * words — and the symptom is never a red test, because the error is still shown.
 *
 * That is QUALITY-GATES Q5's 순수 로직 row, and the threshold was already on
 * these two modules when they lived in `apps/admin` (TASK-0117 Q5). It moved
 * with the code (D-219) rather than being dropped.
 */
export default defineConfig({
  test: {
    // `test/`, not beside the source: `tsconfig.build.json` builds `src` into
    // `dist`, and a spec is not something this package publishes.
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      thresholds: {
        'src/api/api-failure.ts': complete,
        'src/api/error-messages.ts': complete,
        /**
         * TASK-0103 6.2 raises Q5 for this one: 「한글 처리는 경계 케이스가 많다」.
         *
         * A branch nothing reaches here is an input for which search silently
         * returns nothing — and the person who typed it does not report that,
         * they conclude the shop has no coats.
         */
        'src/hangul.ts': complete,
        /**
         * TASK-0047 6.2 raises Q5 for the calculator: 「금액이 틀리면 실제 돈이
         * 틀어진다」.
         *
         * And the틀어짐 does not fail — the screen draws whatever number it is
         * given, and a won that went missing follows the order all the way into
         * settlement. A branch nothing reaches here is a case where that happens.
         */
        'src/pricing/allocate.ts': complete,
        'src/pricing/calculate.ts': complete,
        'src/pricing/refund.ts': complete,
      },
    },
  },
})
