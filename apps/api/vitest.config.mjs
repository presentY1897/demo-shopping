import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `dist` holds a compiled copy of every spec-free source file; restricting
    // the glob to `src` keeps the suite from ever running build output.
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./vitest.setup.mjs'],
    environment: 'node',
  },
})
