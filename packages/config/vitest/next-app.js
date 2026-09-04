import { join } from 'node:path'

/**
 * Vitest preset for the three Next.js apps.
 *
 * One preset rather than three configs: the apps differ only in their `AppId`,
 * and a test setup that is copied is a test setup that drifts (TASK-0107 4.3).
 * Each app's `vitest.config.mjs` is the import of this function and nothing else.
 *
 * The returned object is a plain Vite config. `defineConfig` is only a typing
 * helper, and calling it here would make `@shopping/config` — which `apps/api`
 * also depends on — carry vitest.
 *
 * @param {string} rootDir Absolute path of the app. Callers pass `import.meta.dirname`.
 */
export function nextAppVitestConfig(rootDir) {
  return {
    resolve: {
      // Matches the `@/*` path mapping in each app's tsconfig. Anchored so that
      // `@shopping/...` is left to node resolution.
      alias: [{ find: /^@\//, replacement: `${join(rootDir, 'src')}/` }],
    },
    // The apps' tsconfig says `jsx: preserve` because Next compiles their JSX;
    // vitest has no Next behind it, so its own transform (oxc, via Vite 8) has
    // to emit the automatic runtime instead of passing the JSX through.
    oxc: { jsx: 'react-jsx' },
    test: {
      // Specs live in `test/`, not beside the source: `packages/ui`'s hardcoded
      // value checks walk `apps/*/src` and a spec is not style bearing code.
      include: ['test/**/*.spec.{ts,tsx}'],
      /**
       * 20 seconds, not vitest's 5 — headroom, not the fix.
       *
       * What actually cut these suites short was Testing Library's own
       * `asyncUtilTimeout`, which is **one second** and which vitest's budget
       * has no say over (see each app's `test/setup.ts`). Raising only this
       * changed nothing, which is how that was found.
       *
       * It still has to move. A spec here renders a console, drives dozens of
       * user events through React and often runs axe over the result — the
       * slowest single test in `apps/admin` measures **1.96s** warm and local,
       * with four more above a second. `pnpm -r test:coverage` runs the
       * workspaces **in parallel** and CI's runner is roughly 5.6x slower than
       * a warm local one, so a test that waits twice at the new five-second
       * ceiling would hit vitest's five-second one first.
       *
       * **A hung test still fails**, fifteen seconds later than it used to.
       */
      testTimeout: 20_000,
      // Server Components are called as functions and their result is rendered,
      // so one environment has to hold both a DOM and Node's fetch (4.2).
      environment: 'jsdom',
      setupFiles: [join(rootDir, 'test', 'setup.ts')],
      env: {
        // Layer two of the network isolation (4.8): `.invalid` is reserved and
        // unroutable, so a request that somehow escapes msw fails at the
        // resolver instead of reaching whatever is on localhost:4000.
        NEXT_PUBLIC_API_URL: 'http://api.test.invalid',
      },
    },
  }
}
