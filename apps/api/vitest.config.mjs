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
      // Deliberately no thresholds: the coverage gate (QUALITY-GATES Q5) starts
      // at M05. Turning it on here would only reward tests written to raise a
      // number before there is domain code worth covering.
    },
  },
})
