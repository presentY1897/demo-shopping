import { describe, expect, it } from 'vitest'

import { deriveEnvFromPortOffset } from './derived-env.js'
import { findRepoRoot } from './workspace.js'

/**
 * Derivation exists so that several worktrees can run at once: every port, and
 * the connection strings built from them, come from one `PORT_OFFSET`.
 *
 * It must not run in production. Render executes a Node service on the
 * repository checkout, so `scripts/ports.mjs` is present there and derivation
 * would succeed — turning a forgotten `DATABASE_URL` into a silent
 * `localhost:5432`, and a forgotten `CORS_ORIGINS` into six allowed localhost
 * origins on a live API that sends credentials.
 */
describe('deriveEnvFromPortOffset', () => {
  const repoRoot = findRepoRoot()

  it('derives connection strings outside production', async () => {
    const derived = await deriveEnvFromPortOffset(repoRoot, { PORT_OFFSET: '10' })

    expect(derived.values.DATABASE_URL).toContain(':5442/')
    expect(derived.values.MEILI_HOST).toBe('http://localhost:7710')
    expect(derived.values.CORS_ORIGINS).toContain('http://localhost:3010')
  })

  it('derives nothing when NODE_ENV is production', async () => {
    const derived = await deriveEnvFromPortOffset(repoRoot, {
      NODE_ENV: 'production',
      PORT_OFFSET: '10',
    })

    expect(derived.values).toEqual({})
    expect(derived.issues).toEqual([])
    expect(derived.offset).toBeNull()
  })

  it('refuses to derive in production even when the workspace is right there', async () => {
    // The failure this guards is precisely "the checkout is present, so it worked".
    expect(repoRoot).not.toBeNull()

    const derived = await deriveEnvFromPortOffset(repoRoot, { NODE_ENV: 'production' })

    expect(derived.values.DATABASE_URL).toBeUndefined()
    expect(derived.values.CORS_ORIGINS).toBeUndefined()
  })
})
