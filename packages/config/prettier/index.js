/**
 * Single formatting source of truth. Every package re-exports this from its own
 * `prettier.config.mjs` so editors and the CLI agree.
 *
 * @type {import('prettier').Config}
 */
const config = {
  semi: false,
  singleQuote: true,
  jsxSingleQuote: false,
  quoteProps: 'as-needed',
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  bracketSpacing: true,
  endOfLine: 'lf',
  overrides: [
    {
      // tsconfig presets carry comments, which the plain json parser rejects.
      files: ['**/tsconfig.json', '**/tsconfig.*.json', '**/tsconfig/*.json', '**/*.jsonc'],
      // Trailing commas are legal in jsonc but break tools that parse tsconfig
      // with a plain JSON parser, so they stay off here.
      options: { parser: 'jsonc', trailingComma: 'none' },
    },
  ],
}

export default config
