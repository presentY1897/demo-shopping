import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** Build output and vendored files that no preset should ever lint. */
export const commonIgnores = [
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/storybook-static/**',
  '**/coverage/**',
  '**/node_modules/**',
]

/**
 * Style rules that need no type information, so they apply to TypeScript and to
 * the plain ESM tooling files (`eslint.config.mjs`, `scripts/*.mjs`) alike.
 *
 * @type {import('eslint').Linter.RulesRecord}
 */
const untypedRules = {
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': 'error',
}

/** `_` prefixed bindings are an explicit "kept on purpose" marker. */
const unusedVars = {
  args: 'all',
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
  destructuredArrayIgnorePattern: '^_',
  ignoreRestSiblings: true,
}

/**
 * Rules every package shares. Type-aware rules are enabled for TypeScript only;
 * flat config files (`eslint.config.mjs`, `prettier.config.mjs`) and the
 * repository scripts are plain JS and are linted without a program.
 *
 * @param {string} rootDir Absolute path of the package being linted, used to
 *   resolve its tsconfig. Callers pass `import.meta.dirname`.
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function baseConfig(rootDir) {
  return tseslint.config(
    { ignores: commonIgnores },
    {
      files: ['**/*.{ts,tsx,mts,cts}'],
      extends: [
        js.configs.recommended,
        tseslint.configs.recommendedTypeChecked,
        tseslint.configs.stylisticTypeChecked,
      ],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: rootDir,
        },
      },
      rules: {
        ...untypedRules,
        '@typescript-eslint/no-unused-vars': ['error', unusedVars],
        // Type-only imports must be erasable so bundlers never keep a runtime import.
        // `separate-type-imports` (the default fix style) is required by
        // no-import-type-side-effects: an import whose specifiers are all inline
        // `type` would still be emitted as a side-effect import.
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-import-type-side-effects': 'error',
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
      languageOptions: {
        globals: globals.node,
        sourceType: 'module',
      },
      rules: {
        ...untypedRules,
        'no-unused-vars': ['error', unusedVars],
      },
    },
    // Must stay last: turns off everything prettier already decides.
    prettierConfig,
  )
}
