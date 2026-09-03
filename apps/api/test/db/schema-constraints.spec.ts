import { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'

import { useDatabase } from '../support/database.js'
import { createAddress, createSeller, createUser } from '../support/factories.js'

/**
 * Gate S5, promoted from reading files to asking the database (TASK-0106 4.8).
 *
 * Five rules cannot be written in PSL and live as hand written SQL at the bottom
 * of a migration. Until now `src/prisma/schema-guards.spec.ts` checked that the
 * SQL *string* was still in the file, which catches a deletion and nothing else:
 * changing `WHERE "isDefault"` to `WHERE NOT "isDefault"` would keep the string
 * check green while a user could no longer keep more than one address.
 *
 * So each rule is tried twice.
 *
 * - **A violation is rejected**, with the SQLSTATE and the constraint name
 *   asserted. `23505` is a unique violation, `23514` a CHECK violation.
 * - **What must be allowed is allowed.** This is the half a string check can
 *   never do, and the half that catches a predicate written backwards.
 *
 * Every attempt is raw SQL. Going through Prisma would let application level
 * validation answer first, and the entire question here is whether *the
 * database* refuses.
 */

const db = useDatabase()

/** Runs `work`, asserting it was the database that refused, and how. */
async function refusal(work: Promise<unknown>): Promise<DatabaseError> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof DatabaseError)) {
    throw new Error(
      `DB 가 거부할 것으로 기대했지만 성공했거나 다른 오류가 났습니다: ${String(error)}`,
    )
  }
  return error
}

describe('Address_userId_default_key — one default address per user', () => {
  it('refuses a second default address for the same user', async () => {
    const user = await createUser(db)

    await createAddress(db, { userId: user.id, isDefault: true })

    const error = await refusal(createAddress(db, { userId: user.id, isDefault: true }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('Address_userId_default_key')
  })

  it('allows any number of non-default addresses for one user', async () => {
    const user = await createUser(db)

    await createAddress(db, { userId: user.id, isDefault: false })
    await createAddress(db, { userId: user.id, isDefault: false })
    await createAddress(db, { userId: user.id, isDefault: true })

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Address" WHERE "userId" = $1`,
      [user.id],
    )

    expect(count).toBe('3')
  })

  it('allows two different users to each have a default', async () => {
    const [one, two] = [await createUser(db), await createUser(db)]

    await createAddress(db, { userId: one.id, isDefault: true })
    await createAddress(db, { userId: two.id, isDefault: true })

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Address" WHERE "isDefault"`,
    )

    expect(count).toBe('2')
  })
})

describe('User_googleSub_active_key — one live account per Google identity', () => {
  it('refuses a second live account with the same Google subject', async () => {
    await createUser(db, { googleSub: 'google-subject-1' })

    const error = await refusal(createUser(db, { googleSub: 'google-subject-1' }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('User_googleSub_active_key')
  })

  it('lets a withdrawn account sign up again with the same identity', async () => {
    await createUser(db, {
      googleSub: 'google-subject-2',
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const reborn = await createUser(db, { googleSub: 'google-subject-2' })

    expect(reborn.deletedAt).toBeNull()
  })

  it('lets any number of demo accounts exist without a Google identity', async () => {
    await createUser(db, { isDemo: true })
    await createUser(db, { isDemo: true })

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "User" WHERE "googleSub" IS NULL`,
    )

    expect(count).toBe('2')
  })
})

describe('User_demo_expiry_check — demo flag and expiry agree', () => {
  it('refuses a demo account without an expiry', async () => {
    const error = await refusal(createUser(db, { isDemo: true, demoExpiresAt: null }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('User_demo_expiry_check')
  })

  it('refuses a real account that carries an expiry', async () => {
    const error = await refusal(
      createUser(db, { isDemo: false, demoExpiresAt: new Date('2026-09-04T00:00:00.000Z') }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('User_demo_expiry_check')
  })

  it('allows a demo account with an expiry and a real account without one', async () => {
    const demo = await createUser(db, { isDemo: true })
    const real = await createUser(db, { isDemo: false })

    expect(demo.demoExpiresAt).not.toBeNull()
    expect(real.demoExpiresAt).toBeNull()
  })
})

describe('User_google_identity_check — a live real account has an identity', () => {
  it('refuses a live real account without a Google subject', async () => {
    const error = await refusal(createUser(db, { isDemo: false, googleSub: null }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('User_google_identity_check')
  })

  it('exempts demo accounts and withdrawn accounts', async () => {
    const demo = await createUser(db, { isDemo: true, googleSub: null })
    const withdrawn = await createUser(db, {
      isDemo: false,
      googleSub: null,
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(demo.googleSub).toBeNull()
    expect(withdrawn.googleSub).toBeNull()
  })
})

describe('Seller_commissionRateBp_check — commission is 0~10000 bp', () => {
  it('refuses a negative rate', async () => {
    const user = await createUser(db)
    const error = await refusal(createSeller(db, { userId: user.id, commissionRateBp: -1 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Seller_commissionRateBp_check')
  })

  it('refuses a rate above 100.00%', async () => {
    const user = await createUser(db)
    const error = await refusal(createSeller(db, { userId: user.id, commissionRateBp: 10_001 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Seller_commissionRateBp_check')
  })

  it.each([0, 10_000, null])('allows the boundary value %s', async (rate) => {
    const user = await createUser(db)
    const seller = await createSeller(db, { userId: user.id, commissionRateBp: rate })

    expect(seller.commissionRateBp).toBe(rate)
  })
})
