import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // Nothing here touches the DOM: the contract specs drive `createApiClient`
    // against msw and assert on what comes back, and the apps own the rendering.
    environment: 'node',
  },
})
