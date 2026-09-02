/**
 * Conventional Commits, enforced on every commit by `.husky/commit-msg`.
 *
 * The allowed types are the list in CLAUDE.md section 3 and nothing else — the
 * document and this file have to stay in sync, so CI work is committed as
 * `chore` rather than the `ci` type that config-conventional would also accept.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'style', 'perf'],
    ],
    // Commit subjects are Korean (CLAUDE.md section 3). The case rules classify
    // a Korean subject by whatever Latin word happens to come first, so they
    // reject valid messages such as "docs: README 에 개발 워크플로 절 추가".
    'subject-case': [0],
  },
}
