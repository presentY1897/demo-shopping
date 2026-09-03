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
