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
      },
    },
  },
})
