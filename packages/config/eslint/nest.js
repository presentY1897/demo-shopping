import globals from 'globals'
import tseslint from 'typescript-eslint'

import { baseConfig } from './base.js'

/**
 * NestJS preset. Nest leans on decorators and on classes that exist only to carry
 * metadata, which a few stylistic rules flag by default.
 *
 * @param {string} rootDir Absolute path of the package being linted.
 * @returns {import('typescript-eslint').ConfigArray}
 */
export function nestConfig(rootDir) {
  return tseslint.config(...baseConfig(rootDir), {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // `@Module({}) export class AppModule {}` has no members by design.
      '@typescript-eslint/no-extraneous-class': 'off',
      // Constructor parameter properties are how Nest injects dependencies.
      '@typescript-eslint/parameter-properties': 'off',
    },
  })
}
