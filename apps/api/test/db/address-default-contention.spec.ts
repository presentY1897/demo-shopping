import { randomUUID } from 'node:crypto'

import type { PoolClient } from 'pg'
import { DatabaseError } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'

import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createAddress, createUser } from '../support/factories.js'

/**
 * Gate A7 and gate S5 for the default address, and the negative control that
 * says why the index is what does the work (TASK-0111 F3b · F3c).
 *
 * **What races.** Two "make this one the default" requests for the same account.
 * Each clears whatever default exists, each finds none, and each writes one.
 * Nothing here is a balance or a stock level — what is at stake is an
 * **invariant on a set of rows**: an account has exactly one default address,
 * and the moment it can be violated is the moment two requests overlap.
 *
 * **Why an index rather than a check.** There is nothing to lock: when no
 * default exists yet, the row both writers are about to conflict over does not
 * exist as a *default* on either side. `Address_userId_default_key` is a partial
 * unique index (`WHERE "isDefault"`) which puts only the default row in the
 * index, so an account keeps as many ordinary addresses as it likes while a
 * second live default is refused (`erd.md` 1장).
 *
 * **Why the interleaving is arranged and not hoped for.** Both writers must have
 * cleared before either sets; otherwise the second simply waits on the first's
 * row lock, finds nothing left to clear, and the specification proves nothing
 * about simultaneity. {@link barrier} pins that down (QUALITY-GATES A7).
 *
 * `AddressService` is what turns the losing write into a 409; that half is
 * proved over HTTP in `test/api/me-addresses.spec.ts` (F3b). This file proves
 * the thing that 409 depends on.
 */

const db = useDatabase()

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'
const INDEX = 'Address_userId_default_key'

/** The read the service does before it decides anything. */
async function currentDefault(connection: PoolClient, userId: string): Promise<string | null> {
  const { rows } = await connection.query<{ id: string }>(
    'SELECT "id" FROM "Address" WHERE "userId" = $1 AND "isDefault"',
    [userId],
  )

  return rows[0]?.id ?? null
}

/** The two statements the transaction runs: clear, then set. */
async function promote(connection: PoolClient, userId: string, id: string): Promise<void> {
  await connection.query('BEGIN')
  try {
    await connection.query(
      'UPDATE "Address" SET "isDefault" = false WHERE "userId" = $1 AND "isDefault"',
      [userId],
    )
    await connection.query('UPDATE "Address" SET "isDefault" = true WHERE "id" = $1', [id])
    await connection.query('COMMIT')
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  }
}

function defaultCount(userId: string): Promise<number> {
  return db
    .one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "Address" WHERE "userId" = $1 AND "isDefault"',
      [userId],
    )
    .then((row) => row.count)
}

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

describe('A7 — 같은 계정의 배송지 둘을 동시에 기본으로 지정', () => {
  it('둘이 동시에 지정하면 하나만 남고 나머지는 23505 로 거절된다', async () => {
    const user = await createUser(db)
    const first = await createAddress(db, { userId: user.id })
    const second = await createAddress(db, { userId: user.id })
    const gate = barrier(2)

    const results = await concurrently(2, async (index) =>
      db.withConnection(async (connection) => {
        // Everyone reads first, and finds no default…
        expect(await currentDefault(connection, user.id)).toBeNull()
        // …and nobody writes until both have read.
        await gate.arrive()

        return promote(connection, user.id, index === 0 ? first.id : second.id)
      }),
    )

    expect(fulfilled(results)).toHaveLength(1)
    expect(rejected(results)).toHaveLength(1)

    const loser = rejected(results)[0] as { code?: string; constraint?: string }
    expect(loser.code).toBe(UNIQUE_VIOLATION)
    expect(loser.constraint).toBe(INDEX)

    expect(await defaultCount(user.id)).toBe(1)
  })

  it('다섯이 동시에 와도 기본은 하나다', async () => {
    const user = await createUser(db)
    const addresses = await Promise.all(
      Array.from({ length: 5 }, () => createAddress(db, { userId: user.id })),
    )
    const gate = barrier(5)

    const results = await concurrently(5, async (index) =>
      db.withConnection(async (connection) => {
        expect(await currentDefault(connection, user.id)).toBeNull()
        await gate.arrive()

        return promote(connection, user.id, addresses[index]?.id ?? '')
      }),
    )

    expect(fulfilled(results)).toHaveLength(1)
    expect(await defaultCount(user.id)).toBe(1)
  })

  it('다른 계정끼리는 서로를 막지 않는다', async () => {
    // The index is per account. If it were not partial *and* per `userId`, two
    // unrelated people saving an address at the same moment would collide.
    const [one, two] = [await createUser(db), await createUser(db)]
    const mine = await createAddress(db, { userId: one.id })
    const theirs = await createAddress(db, { userId: two.id })
    const gate = barrier(2)

    const results = await concurrently(2, async (index) =>
      db.withConnection(async (connection) => {
        await gate.arrive()

        return index === 0
          ? promote(connection, one.id, mine.id)
          : promote(connection, two.id, theirs.id)
      }),
    )

    expect(rejected(results)).toHaveLength(0)
    expect(await defaultCount(one.id)).toBe(1)
    expect(await defaultCount(two.id)).toBe(1)
  })
})

describe('S5 — 인덱스가 실제로 거부한다 (F3c)', () => {
  it('두 번째 기본 배송지를 INSERT 로 밀어 넣을 수 없다', async () => {
    const user = await createUser(db)
    await createAddress(db, { userId: user.id, isDefault: true })

    const error = await refusal(createAddress(db, { userId: user.id, isDefault: true }))

    expect(error.code).toBe(UNIQUE_VIOLATION)
    expect(error.constraint).toBe(INDEX)
  })

  it('UPDATE 로 승격시키는 것도 마찬가지로 거부된다', async () => {
    // The shape the service actually uses. An index that refused inserts and
    // let updates through would be invisible to a check that only inserts.
    const user = await createUser(db)
    await createAddress(db, { userId: user.id, isDefault: true })
    const spare = await createAddress(db, { userId: user.id })

    const error = await refusal(
      db.execute('UPDATE "Address" SET "isDefault" = true WHERE "id" = $1', [spare.id]),
    )

    expect(error.code).toBe(UNIQUE_VIOLATION)
    expect(error.constraint).toBe(INDEX)
  })

  it('해제 후 지정은 한 트랜잭션 안에서 통과한다', async () => {
    // The half a violation test cannot show: the order the service uses is
    // actually allowed. A predicate written backwards would fail here.
    const user = await createUser(db)
    const previous = await createAddress(db, { userId: user.id, isDefault: true })
    const next = await createAddress(db, { userId: user.id })

    await db.withConnection((connection) => promote(connection, user.id, next.id))

    expect(await defaultCount(user.id)).toBe(1)
    const { isDefault } = await db.one<{ isDefault: boolean }>(
      'SELECT "isDefault" FROM "Address" WHERE "id" = $1',
      [previous.id],
    )
    expect(isDefault).toBe(false)
  })
})

/**
 * The negative control: the same choreography with no partial unique index.
 *
 * A scratch table rather than the shipped one, for the reason TASK-0028 needed
 * one — the damage here *is* the missing constraint, so it cannot be reproduced
 * on a table that has it. What this shows is that "확인 후 갱신", which is what
 * the service does on the happy path, is not by itself a defence: both writers
 * pass their check and both rows end up default.
 *
 * If this control ever went green, the cases above would be proving nothing
 * about the index and everything about two calls that failed to overlap.
 */
describe('A7 — 음성 대조군 (부분 유니크 인덱스 없음)', () => {
  beforeAll(async () => {
    await db.query('DROP TABLE IF EXISTS "unindexed_address"')
    await db.query(
      `CREATE TABLE "unindexed_address" (
         "id" uuid PRIMARY KEY,
         "userId" uuid NOT NULL,
         "isDefault" boolean NOT NULL DEFAULT false
       )`,
    )
  })

  it('확인 후 갱신만으로는 한 계정에 기본이 둘 생긴다', async () => {
    const userId = randomUUID()
    const ids = [randomUUID(), randomUUID()]

    for (const id of ids) {
      await db.execute('INSERT INTO "unindexed_address" ("id", "userId") VALUES ($1, $2)', [
        id,
        userId,
      ])
    }

    const gate = barrier(2)
    const results = await concurrently(2, async (index) =>
      db.withConnection(async (connection) => {
        const { rows } = await connection.query(
          'SELECT "id" FROM "unindexed_address" WHERE "userId" = $1 AND "isDefault"',
          [userId],
        )
        expect(rows).toHaveLength(0)
        await gate.arrive()

        await connection.query('BEGIN')
        await connection.query(
          'UPDATE "unindexed_address" SET "isDefault" = false WHERE "userId" = $1 AND "isDefault"',
          [userId],
        )
        await connection.query(
          'UPDATE "unindexed_address" SET "isDefault" = true WHERE "id" = $1',
          [ids[index]],
        )
        await connection.query('COMMIT')
      }),
    )

    expect(rejected(results)).toHaveLength(0)

    const { count } = await db.one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "unindexed_address" WHERE "userId" = $1 AND "isDefault"',
      [userId],
    )
    // Two defaults, one account. Checkout would preselect whichever the planner
    // returned first, and nothing anywhere would report it.
    expect(count).toBe(2)
  })
})
