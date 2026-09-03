import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `src/**` holds the unit tests next to what they test; `test/**` holds the
    // checks that read the stylesheet out of `@shopping/config`, which is a
    // different package and so does not belong beside a source file.
    include: ['src/**/*.spec.{ts,tsx}', 'test/**/*.spec.{ts,tsx}'],
    // The provider and the boot script both touch `document` and `localStorage`.
    environment: 'jsdom',
    // Registers the DOM matchers and the browser APIs jsdom is missing; see the
    // file for why Radix needs each one.
    setupFiles: ['./test/setup.ts'],
  },
})
