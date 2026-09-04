import { randomUUID } from 'node:crypto'

import { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'

import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'

/**
 * Gate S5 for the three unique indexes onboarding depends on.
 *
 * TASK-0108 4장 applies S5 voluntarily even though the task changes no schema:
 * this is the first task that actually *uses* `Seller_brandName_key` and
 * `Seller_slug_key`, and D-207's complaint was that a migration was only ever
 * checked by looking for its SQL string in a file. A string check cannot tell a
 * unique index from one that was written on the wrong column.
 *
 * So each rule is tried twice — a violation is refused with the SQLSTATE and
 * the constraint named, and what must be allowed is allowed. Every attempt is
 * raw SQL: going through Prisma would let `SellerService` answer first, and the
 * whole question here is whether **the database** refuses.
 */

const db = useDatabase()

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'

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

/** One store, stated field by field, with nothing in the way. */
function insert(options: {
  readonly userId: string
  readonly brandName: string
  readonly slug: string
  readonly status?: string
}): Promise<unknown> {
  return db.one(
    `INSERT INTO "Seller" ("id", "userId", "brandName", "slug", "status", "updatedAt")
     VALUES ($1, $2, $3, $4, $5::"SellerStatus", now())
     RETURNING "id"`,
    [randomUUID(), options.userId, options.brandName, options.slug, options.status ?? 'PENDING'],
  )
}

describe('Seller_brandName_key — 브랜드명은 플랫폼에서 하나뿐이다', () => {
  it('refuses a second store with the same brand name', async () => {
    const first = await createUser(db)
    const second = await createUser(db)

    await insert({ userId: first.id, brandName: '루미에르', slug: 'lumiere' })

    const error = await refusal(
      insert({ userId: second.id, brandName: '루미에르', slug: 'lumiere-2' }),
    )

    expect(error.code).toBe(UNIQUE_VIOLATION)
    expect(error.constraint).toBe('Seller_brandName_key')
  })

  it('refuses it whatever the two stores’ statuses are', async () => {
    // The index is not partial, unlike `User_googleSub_active_key`. A rejected
    // application keeps holding its brand name, which is deliberate: releasing
    // it would let a rival take the name of a store that is about to re-apply.
    const first = await createUser(db)
    const second = await createUser(db)

    await insert({ userId: first.id, brandName: '아틀리에', slug: 'atelier', status: 'REJECTED' })

    const error = await refusal(
      insert({ userId: second.id, brandName: '아틀리에', slug: 'atelier-2', status: 'ACTIVE' }),
    )

    expect(error.constraint).toBe('Seller_brandName_key')
  })

  it('allows two stores with different brand names', async () => {
    const first = await createUser(db)
    const second = await createUser(db)

    await insert({ userId: first.id, brandName: '루미에르', slug: 'lumiere' })
    await insert({ userId: second.id, brandName: '아틀리에', slug: 'atelier' })

    const { count } = await db.one<{ count: number }>('SELECT count(*)::int AS count FROM "Seller"')

    expect(count).toBe(2)
  })

  it('treats brand names differing only in case as different names', async () => {
    // The index is on the raw column, so `Lumiere` and `lumiere` are two names.
    // Recorded here because it is a decision, not an accident: making it
    // case-insensitive is an index change and therefore a schema task
    // (TASK-0108 9장, 2026-09-04).
    const first = await createUser(db)
    const second = await createUser(db)

    await insert({ userId: first.id, brandName: 'Lumiere', slug: 'lumiere-upper' })
    await insert({ userId: second.id, brandName: 'lumiere', slug: 'lumiere-lower' })

    const { count } = await db.one<{ count: number }>('SELECT count(*)::int AS count FROM "Seller"')

    expect(count).toBe(2)
  })
})

describe('Seller_slug_key — 스토어 주소도 하나뿐이다', () => {
  it('refuses a second store with the same slug', async () => {
    const first = await createUser(db)
    const second = await createUser(db)

    await insert({ userId: first.id, brandName: '루미에르', slug: 'lumiere' })

    const error = await refusal(
      insert({ userId: second.id, brandName: '아틀리에', slug: 'lumiere' }),
    )

    expect(error.code).toBe(UNIQUE_VIOLATION)
    expect(error.constraint).toBe('Seller_slug_key')
  })
})

describe('Seller_userId_key — 계정마다 스토어 하나', () => {
  it('refuses a second store for one account', async () => {
    const owner = await createUser(db)

    await createSeller(db, { userId: owner.id })

    const error = await refusal(
      insert({ userId: owner.id, brandName: '두번째', slug: 'second-store' }),
    )

    expect(error.code).toBe(UNIQUE_VIOLATION)
    expect(error.constraint).toBe('Seller_userId_key')
  })
})

describe('UserRole_userId_role_key — 승인이 두 번 와도 역할은 한 행', () => {
  it('refuses granting SELLER_OWNER twice to one account', async () => {
    const owner = await createUser(db)

    await db.execute(
      `INSERT INTO "UserRole" ("id", "userId", "role") VALUES ($1, $2, 'SELLER_OWNER'::"Role")`,
      [randomUUID(), owner.id],
    )

    // The constraint `SellerService.grantOwnerRole`'s `skipDuplicates` relies
    // on. Without it, the second of two concurrent approvals would surface a
    // database error as a 500 (요구사항 비기능 2).
    const error = await refusal(
      db.execute(
        `INSERT INTO "UserRole" ("id", "userId", "role") VALUES ($1, $2, 'SELLER_OWNER'::"Role")`,
        [randomUUID(), owner.id],
      ),
    )

    expect(error.code).toBe(UNIQUE_VIOLATION)
    expect(error.constraint).toBe('UserRole_userId_role_key')
  })

  it('allows the same account to hold another role', async () => {
    const owner = await createUser(db)

    await db.execute(
      `INSERT INTO "UserRole" ("id", "userId", "role") VALUES ($1, $2, 'SELLER_OWNER'::"Role")`,
      [randomUUID(), owner.id],
    )
    await db.execute(
      `INSERT INTO "UserRole" ("id", "userId", "role") VALUES ($1, $2, 'BUYER'::"Role")`,
      [randomUUID(), owner.id],
    )

    const { count } = await db.one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "UserRole" WHERE "userId" = $1',
      [owner.id],
    )

    expect(count).toBe(2)
  })
})
