import { defineConfig } from 'vitest/config'

/**
 * Number of worker processes, and therefore of test databases.
 *
 * Fixed rather than derived from the core count so that the set of databases
 * `test/setup/global-setup.ts` creates is the same on every machine and in CI:
 * a run that sizes itself to the runner would leave a different number of
 * `shopping_test_w<n>` databases behind each time, and `VITEST_POOL_ID` — which
 * is what picks a worker's database — is only ever `1..maxWorkers`.
 *
 * Published on the environment because the global setup runs in this same
 * process and must agree with this number exactly; reading it back from here is
 * what keeps the two from drifting.
 */
const maxWorkers = Number(process.env.VITEST_MAX_WORKERS ?? '') || 4

process.env.VITEST_MAX_WORKERS = String(maxWorkers)

export default defineConfig({
  test: {
    // `dist` holds a compiled copy of every spec-free source file; restricting
    // the glob to `src` and `test` keeps the suite from ever running build output.
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // The global setup builds the template database and clones it once per
    // worker; the setup file points each worker at its own clone.
    globalSetup: ['./test/setup/global-setup.ts'],
    setupFiles: ['./vitest.setup.mjs', './test/setup/worker-database.mts'],
    environment: 'node',
    maxWorkers,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts'],
      /**
       * The coverage gate, switched on by the first M05 task (TASK-0028).
       *
       * QUALITY-GATES Q5 asks for two different numbers, so there are two kinds
       * of entry here.
       *
       * - **Backend services and API — line coverage 80%.** A global floor, not
       *   a per-file one: a small module that is exercised entirely through the
       *   endpoint above it would otherwise have to grow tests of its own that
       *   assert nothing new.
       * - **Pure logic — branch coverage 100%.** Named file by file, because
       *   "is this pure logic?" is a judgement and a glob would quietly answer
       *   it for code nobody looked at. Every path decision and every move
       *   refusal is decided in these two modules, and a branch nothing reaches
       *   is a rule nothing checks.
       *
       * Statements and branches are deliberately left without a global floor:
       * Q5 states line coverage for this layer, and adding numbers the gate
       * does not ask for is how a suite starts collecting tests that exist to
       * move a percentage.
       */
      thresholds: {
        lines: 80,
        'src/catalog/category-path.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/catalog/category-tree.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // TASK-0011. The signature is the reason this floor is here: a branch
        // nothing reaches is a canonicalisation rule nothing checks, and the
        // symptom of getting one wrong is a 403 from the storage on some
        // subset of filenames rather than a failing test. The upload rules and
        // the environment reader are the other two pieces that decide something
        // without asking anybody — QUALITY-GATES Q5's 순수 로직 row.
        'src/storage/sigv4.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/storage/upload-rules.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/config/storage-config.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
})
