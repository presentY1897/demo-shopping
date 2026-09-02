import { baseConfig } from '@shopping/config/eslint/base'

/**
 * Root lint pass. `pnpm -r` skips the root project, so without this config the
 * repository scripts and the root tooling files would never be linted.
 *
 * Workspace packages are excluded here on purpose: each one owns an
 * `eslint.config.mjs` with its framework preset and its own type-aware program,
 * and `pnpm -r lint` runs them. ESLint 10 resolves the config from the linted
 * file's directory, so lint-staged can pass any path from the repository root
 * and still get the right preset.
 */
export default [{ ignores: ['apps/**', 'packages/**'] }, ...baseConfig(import.meta.dirname)]
