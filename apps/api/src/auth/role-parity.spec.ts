import { Role as PrismaRole } from '@prisma/client'
import type { Role } from '@shopping/shared'
import { roles } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

/**
 * `@shopping/shared` restates the `Role` enum so the front-ends can name a role
 * without depending on the API's database layer. Two lists of the same thing
 * drift, so both directions are pinned here — at compile time and at run time.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** Fails `pnpm typecheck` the moment either list gains or loses a member. */
const _roleUnionsAgree: Exact<Role, PrismaRole> = true

describe('role catalogue', () => {
  it('matches the Prisma enum exactly', () => {
    expect([...roles].sort()).toEqual(Object.values(PrismaRole).sort())
  })

  it('holds no duplicates', () => {
    expect(new Set(roles).size).toBe(roles.length)
  })
})
