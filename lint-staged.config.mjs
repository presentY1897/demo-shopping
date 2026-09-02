/**
 * Commit-time checks. Only the staged files are inspected, so a commit stays
 * fast no matter how large the repository gets — the full `pnpm lint` and
 * `pnpm typecheck` runs belong to CI.
 *
 * Every command runs from the repository root. ESLint 10 resolves its config
 * from each linted file's own directory and Prettier does the same, so a single
 * invocation covers apps, packages and the root scripts with the right preset.
 *
 * @type {import('lint-staged').Configuration}
 */
export default {
  // `--fix` first, then Prettier: ESLint may rewrite code (import sorting,
  // `prefer-const`), and Prettier has the last word on layout.
  // `--no-warn-ignored` keeps a staged file that a preset ignores (generated
  // output, `next-env.d.ts`) from failing the hook.
  '*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}': [
    'eslint --fix --max-warnings 0 --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,jsonc,yml,yaml,css}': ['prettier --write'],
}
