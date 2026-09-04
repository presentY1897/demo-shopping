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
      },
    },
  },
}
