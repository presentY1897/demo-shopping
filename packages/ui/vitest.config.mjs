import { defineConfig } from 'vitest/config'

/** Everything a `100` in `thresholds` means. */
const complete = { branches: 100, functions: 100, lines: 100, statements: 100 }

export default defineConfig({
  test: {
    // `src/**` holds the unit tests next to what they test; `test/**` holds the
    // checks that read the stylesheet out of `@shopping/config`, which is a
    // different package and so does not belong beside a source file.
    include: ['src/**/*.spec.{ts,tsx}', 'test/**/*.spec.{ts,tsx}'],
    // The provider and the boot script both touch `document` and `localStorage`.
    environment: 'jsdom',
    // Registers the DOM matchers and the browser APIs jsdom is missing; see the
    // file for why Radix needs each one.
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.{ts,tsx}'],
      /**
       * No global floor. QUALITY-GATES Q5 gives the front-end layer an
       * interaction list rather than a number, on the grounds that a coverage
       * target on UI code buys tests that render and assert nothing — so adding
       * one here would be inventing a gate the project deliberately does not
       * have.
       *
       * The 순수 로직 row is a different matter, and TASK-0017 puts the form
       * system's decision-making squarely in it: the four modules below take
       * input and return output, decide what every generated form *is*, and are
       * the only client-side statement of rules that `apps/api` enforces on the
       * other side. A branch nothing reaches in them is a rule nothing checks.
       * `apps/api/vitest.config.mjs` names its pure modules the same way and for
       * the same reason.
       */
      thresholds: {
        'src/form/field-def.ts': complete,
        'src/form/field-errors.ts': complete,
        'src/form/field-ids.ts': complete,
        'src/form/server-errors.ts': complete,
      },
    },
  },
})
