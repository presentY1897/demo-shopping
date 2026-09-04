import { DisplayDensity as PrismaDisplayDensity } from '@prisma/client'
import type { DisplayDensity } from '@shopping/shared'
import { displayDensities } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

/**
 * `@shopping/shared` restates the `DisplayDensity` enum so `apps/shop` can name
 * a density without depending on the API's database layer — the same reason
 * `roles` is restated, and the same failure if the two drift: a toggle that
 * offers a value the column refuses, rejected at the very last moment with a
 * database error instead of a validation one.
 *
 * Both directions are pinned, at compile time and at run time, exactly as
 * `src/auth/role-parity.spec.ts` does it.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** Fails `pnpm typecheck` the moment either list gains or loses a member. */
const _densityUnionsAgree: Exact<DisplayDensity, PrismaDisplayDensity> = true

describe('display density catalogue', () => {
  it('matches the Prisma enum exactly', () => {
    expect([...displayDensities].sort()).toEqual(Object.values(PrismaDisplayDensity).sort())
  })

  it('holds no duplicates', () => {
    expect(new Set(displayDensities).size).toBe(displayDensities.length)
  })
})
