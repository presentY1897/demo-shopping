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
 * **The two modules below are the 순수 로직 row of that same table** (TASK-0117
 * Q5). They take a failure and return what the screen says and where it puts it:
 * which sentence a code maps to, whether a placeholder could be filled, whether
 * a reference is worth showing. A branch nothing reaches in them is a failure
 * rendered wrongly — and the symptom is never a red test, because the error is
 * still *shown*. That is the exact defect this task exists to remove.
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
        'src/lib/errors.ts': complete,
        'src/lib/api-failure.ts': complete,
      },
    },
  },
}
